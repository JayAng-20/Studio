/**
 * 排版引擎：區塊 → 流動項目（FlowItem，一行文字／一列表格／一張圖）→ 分頁。
 * - 項目可設定「與下一項不分開」（標題、段落頭兩行與尾兩行：孤行／寡行控制）。
 * - 程式碼底色框、引用色條是「容器」：分頁後依每頁的範圍各畫一段。
 * - 表格跨頁時自動重複表頭。
 * 座標：x 為頁面左緣起算、y 為項目頂端起算（向下為正），單位 pt。
 */
import type { FontKey, Measurer } from './fonts'
import { LineBreaker, PAD, PAD_EM, type LineBox, type Span, type TextStyle } from './linebreak'
import { COURIER_ADVANCE, layoutMono } from './mono'
import type {
  Align,
  Block,
  DocModel,
  ImageBlock,
  ImageData,
  ListBlock,
  Run,
  TableBlock,
} from './model'
import { collectHeadings, runsText } from './model'

/** 標題文字開頭已有的編號：第一章、一、（一）、1.、1.1、Chapter 1、I.、A. */
const MANUAL_NUMBER =
  /^(第\s*[一二三四五六七八九十百千零〇两兩\d０-９]+\s*[章節节部篇卷回集]|[一二三四五六七八九十壹貳參肆伍陸柒捌玖拾]+\s*[、．.]|[（(][一二三四五六七八九十\d]+[）)]|\d+(\.\d+)*[.、．)]?\s|(chapter|part|section)\s+\w+|[IVXLC]+\.\s|[A-Z]\.\s)/i
import { hasCJK } from './text'
import { codeMutedColor, codeTextColor, type RGB, type Theme } from './themes'

/* ---------- 繪圖指令 ---------- */

export type Op =
  | {
      t: 'text'
      x: number
      y: number
      text: string
      font: FontKey
      size: number
      color: RGB
      skew: boolean
      /** 水平縮放（%） */
      hs?: number
    }
  | {
      t: 'rect'
      x: number
      y: number
      w: number
      h: number
      fill?: RGB
      stroke?: RGB
      lw?: number
      r?: number
      dash?: number[]
    }
  | {
      t: 'line'
      x1: number
      y1: number
      x2: number
      y2: number
      color: RGB
      w: number
      dash?: number[]
      round?: boolean
    }
  | { t: 'circle'; x: number; y: number; r: number; fill?: RGB; stroke?: RGB; lw?: number }
  | { t: 'image'; x: number; y: number; w: number; h: number; image: ImageData }
  | { t: 'link'; x: number; y: number; w: number; h: number; uri?: string; dest?: string }

export interface Container {
  kind: 'bg' | 'bar'
  x: number
  w: number
  pad: number
  fill: RGB
  stroke?: RGB
  r?: number
}

export interface FlowItem {
  h: number
  /** 項目前的間距（在頁首時省略） */
  before: number
  keepNext?: boolean
  breakBefore?: boolean
  containers?: number[]
  table?: { id: number; header: boolean }
  ops: Op[]
  anchors?: string[]
  /** 頁首右側顯示的章節名稱（H1） */
  section?: string
}

export interface PageSetup {
  width: number
  height: number
  margin: { top: number; right: number; bottom: number; left: number }
}

export interface Labels {
  imageExternal: string
  imageNotFound: string
  imageUnsupported: string
  imageLabel: string
}

export interface FlowOptions {
  page: PageSetup
  baseSize: number
  lineHeight: number
  theme: Theme
  labels: Labels
}

/** 一份文件排版的共同狀態（樣式表、容器、量測） */
export class FlowContext {
  readonly styles: TextStyle[] = []
  private styleKeys = new Map<string, number>()
  readonly containers: Container[] = []
  readonly breaker: LineBreaker
  readonly measurer: Measurer
  readonly o: FlowOptions
  private tableId = 0
  constructor(measurer: Measurer, o: FlowOptions) {
    this.measurer = measurer
    this.o = o
    this.breaker = new LineBreaker(measurer, this.styles)
  }
  get missing() {
    return this.breaker.missing
  }
  addMissing(n: number) {
    this.breaker.missing += n
  }
  style(s: TextStyle): number {
    const key = JSON.stringify(s)
    let i = this.styleKeys.get(key)
    if (i === undefined) {
      i = this.styles.length
      this.styles.push(s)
      this.styleKeys.set(key, i)
    }
    return i
  }
  container(c: Container): number {
    this.containers.push(c)
    return this.containers.length - 1
  }
  nextTableId() {
    return this.tableId++
  }
  get contentWidth() {
    const p = this.o.page
    return p.width - p.margin.left - p.margin.right
  }
  get contentHeight() {
    const p = this.o.page
    return p.height - p.margin.top - p.margin.bottom
  }
}

interface BlockCtx {
  x: number
  width: number
  containers: number[]
  color?: RGB
  /** 文件內錨點：slug → 標題 id */
  slugs: Map<string, string>
  /** 清單巢狀深度 */
  listDepth: number
  /** 是否為緊湊清單項目內 */
  tight?: boolean
}

/* ---------- 文字行 → 項目 ---------- */

/** em 框：基線在 em 框頂端往下 0.88 em（思源黑體的表意字框） */
const ASC = 0.88

interface TextItemOptions {
  lineHeight: number
  /** 這段文字的基準字級（行內有更大的字時，行高依比例放大） */
  size: number
  before: number
  justify?: boolean
  firstIndent?: number
  align?: Align
  /** 段落行的孤行／寡行控制 */
  orphans?: boolean
  keepAll?: boolean
}

function linkTarget(run: Run, slugs: Map<string, string>): { uri?: string; dest?: string } {
  if (!run.link) return {}
  const l = run.link.trim()
  if (l.startsWith('#')) {
    let slug = l.slice(1)
    try {
      slug = decodeURIComponent(slug)
    } catch {
      // 保留原字串
    }
    const dest = slugs.get(slug.toLowerCase())
    return dest ? { dest } : {}
  }
  if (/^(https?:|mailto:|ftp:|tel:)/i.test(l)) return { uri: l }
  if (/^www\./i.test(l)) return { uri: `https://${l}` }
  // 相對路徑的連結：PDF 中無法開啟，不建立連結
  return {}
}

export function runsToSpans(
  fc: FlowContext,
  runs: Run[],
  base: { family: 'sans' | 'serif'; bold: boolean; size: number; color: RGB },
  slugs: Map<string, string>,
): Span[] {
  const th = fc.o.theme
  const spans: Span[] = []
  for (const r of runs) {
    const link = linkTarget(r, slugs)
    const isLink = !!(link.uri || link.dest)
    const size = base.size * (r.scale ?? 1) * (r.code ? 0.9 : 1)
    const style = fc.style({
      family: r.code ? 'mono' : base.family,
      bold: base.bold || !!r.b,
      italic: !!r.i,
      size,
      color: isLink ? th.colors.link : base.color,
      underline: !!r.u || isLink,
      strike: !!r.s,
      ...(r.code && { codeBg: th.colors.inlineCodeBg }),
      ...link,
    })
    const text = r.code ? `${PAD}${r.text}${PAD}` : r.text
    spans.push({ text, style })
  }
  return spans
}

/** 把一行的片段轉成繪圖指令（文字、底線、刪除線、行內程式碼底色、連結區域） */
export function lineOps(
  fc: FlowContext,
  line: LineBox,
  x0: number,
  lineH: number,
): { ops: Op[]; baseline: number } {
  const ops: Op[] = []
  const size = line.size || fc.o.baseSize
  const top = (lineH - size) / 2
  const baseline = top + size * ASC
  const deco: Op[] = []
  const links: Op[] = []
  for (const p of line.pieces) {
    const st = fc.styles[p.style]
    const x = x0 + p.x
    const pBase = top + size * ASC
    if (st.codeBg) {
      deco.push({
        t: 'rect',
        x: x,
        y: pBase - p.size * 0.98,
        w: p.width,
        h: p.size * 1.32,
        fill: st.codeBg,
        r: Math.min(2.5, p.size * 0.2),
      })
    }
    const visible = p.text.split(PAD).join('')
    if (visible) {
      // 行內程式碼開頭的留白：文字往右移
      let leadPads = 0
      while (p.text[leadPads] === PAD) leadPads++
      ops.push({
        t: 'text',
        x: x + leadPads * PAD_EM * p.size,
        y: pBase,
        text: visible,
        font: p.font,
        size: p.size,
        color: st.color,
        skew: p.skew,
        ...(p.hs && { hs: p.hs }),
      })
    }
    if (st.underline) {
      const uy = pBase + p.size * 0.13
      ops.push({
        t: 'line',
        x1: x,
        y1: uy,
        x2: x + p.width,
        y2: uy,
        color: st.color,
        w: Math.max(0.5, p.size * 0.055),
      })
    }
    if (st.strike) {
      const sy = pBase - p.size * 0.32
      ops.push({
        t: 'line',
        x1: x,
        y1: sy,
        x2: x + p.width,
        y2: sy,
        color: st.color,
        w: Math.max(0.5, p.size * 0.06),
      })
    }
    if (st.uri || st.dest) {
      const last = links[links.length - 1]
      const r = { x, y: pBase - p.size * 0.95, w: p.width, h: p.size * 1.25 }
      if (
        last &&
        last.t === 'link' &&
        last.uri === st.uri &&
        last.dest === st.dest &&
        Math.abs(last.x + last.w - x) < 1.5
      ) {
        last.w = x + p.width - last.x
      } else links.push({ t: 'link', ...r, uri: st.uri, dest: st.dest })
    }
  }
  return { ops: [...deco, ...ops, ...links], baseline }
}

/** 文字區塊 → 每行一個項目 */
function textItems(
  fc: FlowContext,
  spans: Span[],
  ctx: BlockCtx,
  o: TextItemOptions,
): { items: FlowItem[]; baselines: number[] } {
  const firstIndent = o.firstIndent ?? 0
  const { lines } = fc.breaker.break(spans, {
    width: ctx.width,
    firstWidth: ctx.width - firstIndent,
    justify: o.justify && o.align !== 'center' && o.align !== 'right',
  })
  const items: FlowItem[] = []
  const baselines: number[] = []
  lines.forEach((line, i) => {
    const size = line.size || fc.o.baseSize
    const lineH = o.lineHeight * Math.max(1, size / o.size)
    let x = ctx.x + (i === 0 ? firstIndent : 0)
    const avail = ctx.width - (i === 0 ? firstIndent : 0)
    if (o.align === 'center') x += (avail - line.width) / 2
    else if (o.align === 'right') x += avail - line.width
    const { ops, baseline } = lineOps(fc, line, x, lineH)
    baselines.push(baseline)
    items.push({ h: lineH, before: i === 0 ? o.before : 0, ops, containers: ctx.containers })
  })
  // 孤行／寡行：段落前兩行、後兩行不分開
  const n = items.length
  if (o.keepAll) items.forEach((it, i) => i < n - 1 && (it.keepNext = true))
  else if (o.orphans && n >= 2) {
    items[0].keepNext = true
    if (n >= 3) items[n - 2].keepNext = true
  }
  return { items, baselines }
}

/* ---------- 區塊 ---------- */

export interface LayoutResult {
  items: FlowItem[]
}

interface Counters {
  numbers: number[]
  /** 自動編號從哪一級開始（只有一個 H1 時，H1 當文件標題不編號） */
  numberFrom: number
}

export class DocLayout {
  private fc: FlowContext
  private numbers: Counters
  private autoNumber: boolean
  /** 標題 id → 自動編號（目錄顯示用） */
  readonly headingNumbers = new Map<string, string>()
  constructor(fc: FlowContext, doc: DocModel) {
    this.fc = fc
    const hs = collectHeadings(doc)
    const minLevel = hs.length ? Math.min(...hs.map((h) => h.level)) : 1
    const tops = hs.filter((h) => h.level === minLevel).length
    // 標題本身已經有編號（第一章、一、1.1…）的文件不再自動編號
    const manual = hs.filter((h) => MANUAL_NUMBER.test(h.text)).length
    this.autoNumber = hs.length > 0 && manual / hs.length < 0.4
    this.numbers = { numbers: [0, 0, 0, 0, 0, 0], numberFrom: tops <= 1 ? minLevel + 1 : minLevel }
  }

  private get th() {
    return this.fc.o.theme
  }
  private get base() {
    return this.fc.o.baseSize
  }
  private get lh() {
    return this.fc.o.baseSize * this.fc.o.lineHeight
  }

  layout(doc: DocModel): FlowItem[] {
    const slugs = new Map<string, string>()
    const collect = (bs: Block[]) => {
      for (const b of bs) {
        if (b.type === 'heading') slugs.set(b.slug.toLowerCase(), b.id)
        else if (b.type === 'quote') collect(b.blocks)
        else if (b.type === 'list') b.items.forEach((it) => collect(it.blocks))
      }
    }
    collect(doc.blocks)
    const ctx: BlockCtx = {
      x: this.fc.o.page.margin.left,
      width: this.fc.contentWidth,
      containers: [],
      slugs,
      listDepth: 0,
    }
    return this.blocks(doc.blocks, ctx)
  }

  private blocks(blocks: Block[], ctx: BlockCtx): FlowItem[] {
    const out: FlowItem[] = []
    let pendingBreak = false
    let prevAfter = 0
    let prevType: Block['type'] | null = null
    for (const b of blocks) {
      if (b.type === 'pageBreak') {
        pendingBreak = true
        continue
      }
      const { items, before, after } = this.block(b, ctx, prevType)
      if (!items.length) continue
      // 間距合併：取前一區塊之後與這一區塊之前的較大值
      items[0].before = Math.max(before, prevAfter) + (items[0].before - before)
      if (!out.length) items[0].before = before
      if (pendingBreak) {
        items[0].breakBefore = true
        pendingBreak = false
      }
      out.push(...items)
      prevAfter = after
      prevType = b.type
    }
    return out
  }

  private bodyBase(ctx: BlockCtx) {
    return {
      family: this.th.body,
      bold: false,
      size: this.base,
      color: ctx.color ?? this.th.colors.text,
    }
  }

  private block(
    b: Block,
    ctx: BlockCtx,
    prevType: Block['type'] | null,
  ): { items: FlowItem[]; before: number; after: number } {
    const gap = this.base * this.th.paraGap
    switch (b.type) {
      case 'heading':
        return this.heading(b, ctx)
      case 'paragraph': {
        const spans = runsToSpans(this.fc, b.runs, this.bodyBase(ctx), ctx.slugs)
        const cjk = hasCJK(runsText(b.runs))
        const indent =
          (b.indent ||
            (this.th.cjkIndent &&
              cjk &&
              prevType === 'paragraph' &&
              ctx.listDepth === 0 &&
              !ctx.tight &&
              !ctx.color)) &&
          !b.align
            ? this.base * 2
            : 0
        const before = ctx.tight ? this.base * 0.2 : gap
        const { items } = textItems(this.fc, spans, ctx, {
          lineHeight: this.lh,
          size: this.base,
          before,
          justify: this.th.justify || b.align === 'justify',
          firstIndent: indent,
          align: b.align,
          orphans: true,
        })
        return { items, before, after: before }
      }
      case 'code':
        return this.code(b.text, b.lang, !!b.plain, ctx)
      case 'quote': {
        const bar = this.fc.container({
          kind: 'bar',
          x: ctx.x,
          w: 3,
          pad: 2,
          fill: this.th.colors.quoteBar,
          r: 1.5,
        })
        const inner: BlockCtx = {
          ...ctx,
          x: ctx.x + 14,
          width: ctx.width - 14,
          containers: [...ctx.containers, bar],
          color: this.th.colors.quoteText,
        }
        const items = this.blocks(b.blocks, inner)
        return { items, before: gap, after: gap }
      }
      case 'list':
        return this.list(b, ctx)
      case 'table':
        return this.table(b, ctx)
      case 'image':
        return this.image(b, ctx)
      case 'hr': {
        const h = this.base * 1.4
        return {
          items: [
            {
              h,
              before: gap,
              ops: [
                {
                  t: 'line',
                  x1: ctx.x,
                  y1: h / 2,
                  x2: ctx.x + ctx.width,
                  y2: h / 2,
                  color: this.th.colors.rule,
                  w: 0.75,
                },
              ],
              containers: ctx.containers,
            },
          ],
          before: gap,
          after: gap,
        }
      }
      case 'pageBreak':
        return { items: [], before: 0, after: 0 }
    }
  }

  /* ----- 標題 ----- */

  headingNumber(id: string, level: number): string {
    if (
      !this.th.numbering ||
      !this.autoNumber ||
      level < this.numbers.numberFrom ||
      level > this.numbers.numberFrom + 2
    )
      return ''
    const idx = level - this.numbers.numberFrom
    const n = this.numbers.numbers
    n[idx]++
    for (let k = idx + 1; k < n.length; k++) n[k] = 0
    const label = n
      .slice(0, idx + 1)
      .map((v) => v || 1)
      .join('.')
    this.headingNumbers.set(id, label)
    return label
  }

  private heading(b: Extract<Block, { type: 'heading' }>, ctx: BlockCtx) {
    const th = this.th
    const lvl = b.level
    const size = this.base * th.headingScale[lvl - 1]
    const num = this.headingNumber(b.id, lvl)
    const runs: Run[] = num ? [{ text: `${num}\u2002` }, ...b.runs] : b.runs
    const color = lvl >= 5 ? (ctx.color ?? th.colors.text) : th.colors.heading
    const spans = runsToSpans(
      this.fc,
      runs,
      { family: th.heading, bold: lvl <= 4 || lvl === 5, size, color },
      ctx.slugs,
    )
    const before = lvl === 1 ? size * 0.9 : lvl === 2 ? size * 1.0 : size * 0.95
    const after = lvl <= 2 ? size * 0.55 : size * 0.45
    const modernBar = th.h1Band && lvl === 2 && ctx.listDepth === 0
    const inner: BlockCtx = modernBar ? { ...ctx, x: ctx.x + 11, width: ctx.width - 11 } : ctx
    const align: Align | undefined = th.h1Center && lvl === 1 ? 'center' : b.align
    const { items } = textItems(this.fc, spans, inner, {
      lineHeight: size * 1.32,
      size,
      before,
      align,
      keepAll: true,
    })
    if (!items.length) return { items, before, after }
    items[0].anchors = [b.id]
    if (lvl === 1) items[0].section = runsText(b.runs).trim()
    for (const it of items) it.keepNext = true
    const last = items[items.length - 1]
    if (th.headingRule[lvl - 1] && ctx.listDepth === 0) {
      last.h += size * 0.28
      last.ops.push({
        t: 'line',
        x1: ctx.x,
        y1: last.h,
        x2: ctx.x + ctx.width,
        y2: last.h,
        color: th.colors.rule,
        w: lvl === 1 ? 1 : 0.7,
      })
      last.h += 1
    }
    if (th.h1Band && lvl === 1) {
      last.h += size * 0.22
      last.ops.push({
        t: 'rect',
        x: align === 'center' ? ctx.x + ctx.width / 2 - 22 : ctx.x,
        y: last.h,
        w: 44,
        h: 3.2,
        fill: th.colors.accent,
        r: 1.6,
      })
      last.h += 3.2
    }
    if (modernBar) {
      const total = items.reduce((s, it) => s + it.h, 0)
      items[0].ops.push({
        t: 'rect',
        x: ctx.x,
        y: size * 0.18,
        w: 3.5,
        h: total - size * 0.36,
        fill: th.colors.accent,
        r: 1.75,
      })
    }
    return { items, before, after }
  }

  /* ----- 程式碼 ----- */

  private code(text: string, lang: string | undefined, plain: boolean, ctx: BlockCtx) {
    const th = this.th
    const size = plain ? this.base * 0.92 : this.base * 0.86
    const lineH = size * (plain ? 1.5 : 1.45)
    const padX = plain ? 0 : 10
    const style = this.fc.style({
      family: 'mono',
      bold: false,
      italic: false,
      size,
      color: plain ? (ctx.color ?? th.colors.text) : codeTextColor(th),
    })
    const { lines, missing } = layoutMono(text, this.fc.measurer, {
      size,
      width: ctx.width - padX * 2,
      style,
      tabSize: plain ? 8 : 4,
    })
    this.fc.addMissing(missing)
    const containers = [...ctx.containers]
    if (!plain) {
      containers.push(
        this.fc.container({
          kind: 'bg',
          x: ctx.x,
          w: ctx.width,
          pad: 8,
          fill: th.colors.codeBg,
          stroke: th.colors.codeBorder ?? undefined,
          r: 5,
        }),
      )
    }
    const gap = this.base * th.paraGap
    const items: FlowItem[] = lines.map((line, i) => {
      const { ops } = lineOps(this.fc, line, ctx.x + padX, lineH)
      return { h: lineH, before: i === 0 ? gap : 0, ops, containers }
    })
    if (items.length >= 2) items[0].keepNext = true
    if (items.length >= 3) items[items.length - 2].keepNext = true
    // 語言標籤：放在底色框右上角的留白裡
    if (lang && !plain && items.length) {
      const ls = Math.max(6.5, size * 0.72)
      const label = lang.toUpperCase().slice(0, 16)
      const w = label.length * COURIER_ADVANCE * ls
      items[0].ops.push({
        t: 'text',
        x: ctx.x + ctx.width - 8 - w,
        y: -8 + 1.5 + ls * ASC,
        text: label,
        font: 'mono',
        size: ls,
        color: codeMutedColor(th),
        skew: false,
      })
    }
    return { items, before: gap, after: gap }
  }

  /* ----- 清單 ----- */

  private list(b: ListBlock, ctx: BlockCtx) {
    const th = this.th
    const size = this.base
    const color = ctx.color ?? th.colors.text
    const depth = ctx.listDepth
    const tight = b.items.every((it) => it.blocks.length <= 2)
    // 標記欄寬：有序清單依最寬的編號
    const markerStyle = this.fc.style({ family: th.body, bold: false, italic: false, size, color })
    const markers = b.items.map((it, i) => it.marker ?? (b.ordered ? `${b.start + i}.` : ''))
    let gutter = size * 1.5
    const hasTask = b.items.some((it) => it.task !== null)
    if (b.ordered || markers.some(Boolean)) {
      const widest = Math.max(
        ...markers.map((m) => this.fc.breaker.measure([{ text: m, style: markerStyle }]).max),
      )
      gutter = Math.max(gutter, widest + size * 0.55)
    }
    if (hasTask) gutter = Math.max(gutter, size * 1.6)
    const items: FlowItem[] = []
    const gap = this.base * th.paraGap
    b.items.forEach((it, i) => {
      const inner: BlockCtx = {
        ...ctx,
        x: ctx.x + gutter,
        width: ctx.width - gutter,
        listDepth: depth + 1,
        tight,
      }
      const sub = this.blocks(it.blocks, inner)
      if (!sub.length) sub.push({ h: this.lh, before: 0, ops: [], containers: ctx.containers })
      sub[0].before = i === 0 ? 0 : tight ? size * 0.22 : gap * 0.6
      // 標記與第一行基線對齊
      const first = sub[0]
      const firstText = first.ops.find((o) => o.t === 'text') as
        Extract<Op, { t: 'text' }> | undefined
      const baseline = firstText ? firstText.y : this.lh / 2 + size * 0.35
      const mx = ctx.x
      if (it.task !== null) {
        const s = size * 0.82
        const bx = mx + 1
        const by = baseline - s * 0.86
        first.ops.push({
          t: 'rect',
          x: bx,
          y: by,
          w: s,
          h: s,
          stroke: it.task ? th.colors.accent : th.colors.muted,
          lw: 0.9,
          r: s * 0.18,
          fill: it.task ? th.colors.accent : undefined,
        })
        if (it.task) {
          first.ops.push(
            {
              t: 'line',
              x1: bx + s * 0.22,
              y1: by + s * 0.52,
              x2: bx + s * 0.42,
              y2: by + s * 0.72,
              color: [1, 1, 1],
              w: 1.2,
              round: true,
            },
            {
              t: 'line',
              x1: bx + s * 0.42,
              y1: by + s * 0.72,
              x2: bx + s * 0.8,
              y2: by + s * 0.3,
              color: [1, 1, 1],
              w: 1.2,
              round: true,
            },
          )
        }
      } else if (markers[i]) {
        const m = markers[i]
        const w = this.fc.breaker.measure([{ text: m, style: markerStyle }]).max
        const line = this.fc.breaker.break([{ text: m, style: markerStyle }], { width: gutter * 2 })
          .lines[0]
        // 編號靠右對齊在標記欄
        const ops = lineOps(this.fc, line, mx + gutter - size * 0.45 - w, this.lh).ops
        const dy = baseline - lineOps(this.fc, line, 0, this.lh).baseline
        for (const o of ops) if (o.t === 'text') first.ops.push({ ...o, y: o.y + dy })
      } else {
        // 項目符號：實心圓、空心圓、方塊（依層級）
        const cx = mx + gutter * 0.42
        const cy = baseline - size * 0.33
        const r = size * 0.16
        const kind = depth % 3
        const bulletColor = th.id === 'modern' ? th.colors.accent : color
        if (kind === 0) first.ops.push({ t: 'circle', x: cx, y: cy, r, fill: bulletColor })
        else if (kind === 1)
          first.ops.push({ t: 'circle', x: cx, y: cy, r: r * 0.95, stroke: bulletColor, lw: 0.8 })
        else
          first.ops.push({
            t: 'rect',
            x: cx - r * 0.9,
            y: cy - r * 0.9,
            w: r * 1.8,
            h: r * 1.8,
            fill: bulletColor,
          })
      }
      items.push(...sub)
    })
    const before = depth > 0 ? size * 0.22 : gap
    return { items, before, after: before }
  }

  /* ----- 表格 ----- */

  private table(b: TableBlock, ctx: BlockCtx) {
    const th = this.th
    const fc = this.fc
    const size = this.base * (b.rows[0]?.length > 5 ? 0.88 : 0.94)
    const lineH = size * 1.45
    const padX = 6
    const padY = th.table === 'booktabs' ? 4 : 4.5
    const cols = Math.max(1, ...b.rows.map((r) => r.length))
    const color = ctx.color ?? th.colors.text
    const spansOf = (r: number, c: number) => {
      const cell = b.rows[r][c]
      const header = r < b.headerRows
      return runsToSpans(
        fc,
        cell?.runs ?? [],
        {
          family: th.body,
          bold: header,
          size,
          color: header ? th.colors.tableHeaderText : color,
        },
        ctx.slugs,
      )
    }
    // 欄寬：依內容計算（最小寬＝最寬的不可斷單位，自然寬＝不斷行的寬度）
    const minW = new Array<number>(cols).fill(size * 1.2)
    const maxW = new Array<number>(cols).fill(size * 1.2)
    for (let r = 0; r < b.rows.length; r++) {
      for (let c = 0; c < cols; c++) {
        const m = fc.breaker.measure(spansOf(r, c))
        minW[c] = Math.max(minW[c], Math.min(m.min, ctx.width * 0.4) + padX * 2)
        maxW[c] = Math.max(maxW[c], m.max + padX * 2 + 0.5)
      }
    }
    const avail = ctx.width
    const sumMax = maxW.reduce((a, v) => a + v, 0)
    const sumMin = minW.reduce((a, v) => a + v, 0)
    let widths: number[]
    if (sumMax <= avail) {
      // 內容放得下：接近整頁寬時撐滿，否則保持自然寬度
      const k = sumMax > avail * 0.6 ? avail / sumMax : 1
      widths = maxW.map((w) => w * k)
    } else if (sumMin >= avail) {
      widths = minW.map((w) => (w * avail) / sumMin)
    } else {
      const extra = avail - sumMin
      const flex = maxW.map((w, i) => w - minW[i])
      const sumFlex = flex.reduce((a, v) => a + v, 0) || 1
      widths = minW.map((w, i) => w + (extra * flex[i]) / sumFlex)
    }
    const tableW = widths.reduce((a, v) => a + v, 0)
    const xs = [ctx.x]
    for (const w of widths) xs.push(xs[xs.length - 1] + w)
    const id = fc.nextTableId()
    const items: FlowItem[] = []
    const border = th.colors.tableBorder
    const gap = this.base * th.paraGap + 2
    const nRows = b.rows.length
    for (let r = 0; r < nRows; r++) {
      const header = r < b.headerRows
      const cellLines: { lines: LineBox[]; align: Align | null }[] = []
      for (let c = 0; c < cols; c++) {
        const { lines } = fc.breaker.break(spansOf(r, c), {
          width: Math.max(4, widths[c] - padX * 2),
        })
        cellLines.push({ lines, align: b.rows[r][c]?.align ?? b.align[c] ?? null })
      }
      const rowH = Math.max(...cellLines.map((cl) => cl.lines.length)) * lineH + padY * 2
      // 單列超過一頁高時，切成多段（極少見）
      const maxH = fc.contentHeight * 0.9
      const chunks = Math.max(1, Math.ceil(rowH / maxH))
      const linesPerChunk = Math.max(1, Math.floor((maxH - padY * 2) / lineH))
      for (let k = 0; k < chunks; k++) {
        const ops: Op[] = []
        const from = k * linesPerChunk
        const to = chunks === 1 ? Infinity : from + linesPerChunk
        const nLines = Math.max(
          1,
          ...cellLines.map((cl) => Math.max(0, Math.min(cl.lines.length, to) - from)),
        )
        const h = (chunks === 1 ? rowH - padY * 2 : nLines * lineH) + padY * 2
        // 底色
        if (header && th.colors.tableHeaderBg)
          ops.push({ t: 'rect', x: ctx.x, y: 0, w: tableW, h, fill: th.colors.tableHeaderBg })
        else if (!header && th.colors.tableStripe && (r - b.headerRows) % 2 === 1)
          ops.push({ t: 'rect', x: ctx.x, y: 0, w: tableW, h, fill: th.colors.tableStripe })
        // 文字
        for (let c = 0; c < cols; c++) {
          const cl = cellLines[c]
          cl.lines.slice(from, to === Infinity ? undefined : to).forEach((line, li) => {
            const inner = widths[c] - padX * 2
            let x = xs[c] + padX
            if (cl.align === 'center') x += (inner - line.width) / 2
            else if (cl.align === 'right') x += inner - line.width
            const lo = lineOps(fc, line, x, lineH).ops
            for (const o of lo) ops.push(shiftOp(o, padY + li * lineH))
          })
        }
        // 框線
        if (th.table === 'grid') {
          ops.push({
            t: 'line',
            x1: ctx.x,
            y1: 0,
            x2: ctx.x + tableW,
            y2: 0,
            color: border,
            w: 0.6,
          })
          ops.push({
            t: 'line',
            x1: ctx.x,
            y1: h,
            x2: ctx.x + tableW,
            y2: h,
            color: border,
            w: 0.6,
          })
          for (const x of xs)
            ops.push({ t: 'line', x1: x, y1: 0, x2: x, y2: h, color: border, w: 0.6 })
        } else if (th.table === 'booktabs') {
          if (r === 0 && k === 0)
            ops.push({
              t: 'line',
              x1: ctx.x,
              y1: 0,
              x2: ctx.x + tableW,
              y2: 0,
              color: border,
              w: 1.1,
            })
          if (header && r === b.headerRows - 1)
            ops.push({
              t: 'line',
              x1: ctx.x,
              y1: h,
              x2: ctx.x + tableW,
              y2: h,
              color: border,
              w: 0.6,
            })
          if (r === nRows - 1 && k === chunks - 1)
            ops.push({
              t: 'line',
              x1: ctx.x,
              y1: h,
              x2: ctx.x + tableW,
              y2: h,
              color: border,
              w: 1.1,
            })
        } else {
          if (!header)
            ops.push({
              t: 'line',
              x1: ctx.x,
              y1: h,
              x2: ctx.x + tableW,
              y2: h,
              color: border,
              w: 0.6,
            })
        }
        items.push({
          h,
          before: r === 0 && k === 0 ? gap : 0,
          ops,
          containers: ctx.containers,
          table: { id, header },
          keepNext: header || k < chunks - 1,
        })
      }
    }
    // 表頭後至少跟著一列；只有兩列的小表格不分開
    if (nRows <= 3) items.forEach((it, i) => i < items.length - 1 && (it.keepNext = true))
    return { items, before: gap, after: gap }
  }

  /* ----- 圖片 ----- */

  private image(b: ImageBlock, ctx: BlockCtx) {
    const th = this.th
    const gap = this.base * th.paraGap + 2
    const fc = this.fc
    if (b.data) {
      const d = b.data
      // 96 dpi → pt；不超過內容寬度與頁高 85%
      const natural = b.widthHint ?? d.width * 0.75
      let w = Math.min(ctx.width, natural)
      let h = (w * d.height) / d.width
      const maxH = fc.contentHeight * 0.85
      if (h > maxH) {
        h = maxH
        w = (h * d.width) / d.height
      }
      const x = ctx.x + (ctx.width - w) / 2
      const items: FlowItem[] = [
        {
          h,
          before: gap,
          ops: [{ t: 'image', x, y: 0, w, h, image: d }],
          containers: ctx.containers,
        },
      ]
      const caption = b.title || ''
      if (caption) {
        const style = fc.style({
          family: th.body,
          bold: false,
          italic: false,
          size: this.base * 0.85,
          color: th.colors.muted,
        })
        const { items: cap } = textItems(fc, [{ text: caption, style }], ctx, {
          lineHeight: this.base * 0.85 * 1.5,
          size: this.base * 0.85,
          before: 4,
          align: 'center',
          keepAll: true,
        })
        items[0].keepNext = true
        items.push(...cap)
      }
      return { items, before: gap, after: gap }
    }
    // 無法嵌入：替代文字框
    const note =
      b.missing === 'external'
        ? fc.o.labels.imageExternal
        : b.missing === 'unsupported'
          ? fc.o.labels.imageUnsupported
          : fc.o.labels.imageNotFound
    const pad = 10
    const inner: BlockCtx = { ...ctx, x: ctx.x + pad + 22, width: ctx.width - pad * 2 - 22 }
    const titleStyle = fc.style({
      family: th.body,
      bold: true,
      italic: false,
      size: this.base * 0.92,
      color: th.colors.text,
    })
    const noteStyle = fc.style({
      family: th.body,
      bold: false,
      italic: false,
      size: this.base * 0.8,
      color: th.colors.muted,
    })
    const t1 = textItems(
      fc,
      [{ text: b.alt || fc.o.labels.imageLabel, style: titleStyle }],
      inner,
      {
        lineHeight: this.base * 0.92 * 1.45,
        size: this.base * 0.92,
        before: 0,
      },
    ).items
    const src = b.src.length > 160 ? `${b.src.slice(0, 157)}…` : b.src
    const t2 = textItems(fc, [{ text: src ? `${note}\n${src}` : note, style: noteStyle }], inner, {
      lineHeight: this.base * 0.8 * 1.45,
      size: this.base * 0.8,
      before: 0,
    }).items
    const ops: Op[] = []
    let y = pad
    for (const it of [...t1, ...t2]) {
      for (const o of it.ops) ops.push(shiftOp(o, y))
      y += it.h
    }
    const h = y + pad
    // 圖示：小相框
    const ix = ctx.x + pad + 2
    const iy = pad + 2
    const placeholder: Op[] = [
      {
        t: 'rect',
        x: ctx.x,
        y: 0,
        w: ctx.width,
        h,
        fill: th.colors.placeholderBg,
        stroke: th.colors.rule,
        lw: 0.8,
        r: 4,
        dash: [3, 2],
      },
      { t: 'rect', x: ix, y: iy, w: 14, h: 11, stroke: th.colors.muted, lw: 0.9, r: 1.5 },
      { t: 'circle', x: ix + 4, y: iy + 3.6, r: 1.3, fill: th.colors.muted },
      {
        t: 'line',
        x1: ix + 2,
        y1: iy + 9,
        x2: ix + 6.5,
        y2: iy + 5.5,
        color: th.colors.muted,
        w: 0.9,
        round: true,
      },
      {
        t: 'line',
        x1: ix + 6.5,
        y1: iy + 5.5,
        x2: ix + 12,
        y2: iy + 9,
        color: th.colors.muted,
        w: 0.9,
        round: true,
      },
    ]
    return {
      items: [{ h, before: gap, ops: [...placeholder, ...ops], containers: ctx.containers }],
      before: gap,
      after: gap,
    }
  }
}

export function shiftOp(o: Op, dy: number, dx = 0): Op {
  switch (o.t) {
    case 'line':
      return { ...o, x1: o.x1 + dx, x2: o.x2 + dx, y1: o.y1 + dy, y2: o.y2 + dy }
    default:
      return { ...o, x: o.x + dx, y: o.y + dy }
  }
}

/* ---------- 分頁 ---------- */

export interface Placement {
  item: FlowItem
  y: number
  /** 項目索引；重複的表頭為 -1 */
  index: number
}

export interface PageFlow {
  placements: Placement[]
}

/**
 * 分頁：貪婪放置；放不下時往回找最近一個允許分頁的位置（keepNext 鏈的開頭），
 * 新頁的第一個項目若是表格的資料列，先放重複的表頭。
 */
export function paginate(items: FlowItem[], fc: FlowContext): PageFlow[] {
  const top = fc.o.page.margin.top
  const bottom = fc.o.page.height - fc.o.page.margin.bottom
  const pages: PageFlow[] = []
  const pad = (it: FlowItem) => (it.containers ?? []).reduce((s, c) => s + fc.containers[c].pad, 0)
  // 容器的第一個／最後一個成員要額外留出內距
  const firstOf = new Map<number, number>()
  const lastOf = new Map<number, number>()
  items.forEach((it, i) => {
    for (const c of it.containers ?? []) {
      if (!firstOf.has(c)) firstOf.set(c, i)
      lastOf.set(c, i)
    }
  })
  const startPad = (i: number) =>
    (items[i].containers ?? []).reduce(
      (s, c) => s + (firstOf.get(c) === i ? fc.containers[c].pad : 0),
      0,
    )
  const endPad = (i: number) =>
    (items[i].containers ?? []).reduce(
      (s, c) => s + (lastOf.get(c) === i ? fc.containers[c].pad : 0),
      0,
    )
  const headers = new Map<number, FlowItem[]>()
  for (const it of items)
    if (it.table?.header) headers.set(it.table.id, [...(headers.get(it.table.id) ?? []), it])

  let page: PageFlow = { placements: [] }
  let y = top
  /** 本頁第一個真正項目的索引（-1：還沒有） */
  let firstReal = -1
  const newPage = (at: number) => {
    pages.push(page)
    page = { placements: [] }
    y = top
    firstReal = -1
    const it = items[at]
    if (it?.table && !it.table.header) {
      const hs = headers.get(it.table.id)
      if (hs) {
        y += pad(it)
        for (const h of hs) {
          page.placements.push({ item: h, y, index: -1 })
          y += h.h
        }
      }
    }
  }
  let i = 0
  while (i < items.length) {
    const it = items[i]
    const atTop = firstReal === -1
    if (it.breakBefore && !atTop) {
      newPage(i)
      continue
    }
    const space = atTop ? (page.placements.length ? 0 : pad(it)) : it.before + startPad(i)
    const need = space + it.h + pad(it)
    if (atTop || y + need <= bottom + 0.01) {
      y += space
      page.placements.push({ item: it, y, index: i })
      if (atTop) firstReal = i
      y += it.h + endPad(i)
      i++
      continue
    }
    // 放不下：往回找分頁點（keepNext 鏈的開頭）；整頁都是同一條鏈時就在這裡斷開
    let b = i
    while (b > firstReal && items[b - 1].keepNext) b--
    if (b <= firstReal) b = i
    if (b < i) page.placements = page.placements.filter((p) => p.index < b)
    newPage(b)
    i = b
  }
  if (page.placements.length || !pages.length) pages.push(page)
  return pages
}
