/**
 * 組版：把一或多份文件排成實體頁面，加上封面、目錄、頁首頁尾，並產生書籤樹。
 * 目錄需要兩階段：先排內文得到每個標題所在的內文頁，再排目錄得到目錄頁數，
 * 用「封面頁數＋目錄頁數＋內文頁」換算成實體頁碼後重排目錄；目錄頁數若因此改變就再算一次，直到穩定。
 */
import type { Measurer } from './fonts'
import {
  DocLayout,
  FlowContext,
  lineOps,
  paginate,
  shiftOp,
  type FlowItem,
  type FlowOptions,
  type Op,
  type PageFlow,
} from './layout'
import type { DocModel } from './model'
import { buildEntries, buildOutlineTree, docAnchor, type OutlineNode, type TocEntry } from './toc'

export { buildEntries, buildOutlineTree, docAnchor, type OutlineNode, type TocEntry }

export interface TocOptions {
  enabled: boolean
  position: 'front' | 'end'
  /** 納入目錄的最深層級（1–3） */
  maxLevel: number
  /** 使用者取消勾選的標題 id */
  exclude: string[]
  title: string
}

export interface ComposeOptions extends FlowOptions {
  title: string
  header: boolean
  footer: boolean
  cover: { enabled: boolean; date: string | null; files: string[] }
  toc: TocOptions
  bookmarks: boolean
}

export interface ComposedPage {
  ops: Op[]
  kind: 'cover' | 'toc' | 'content'
}

export interface Dest {
  page: number
  y: number
}

export interface Composed {
  pages: ComposedPage[]
  dests: Map<string, Dest>
  outline: OutlineNode[]
  entries: TocEntry[]
  /** 目錄項目 id → 實體頁碼（1 起算） */
  pageNumbers: Map<string, number>
  tocPages: number
  contentPages: number
  missing: number
}

/** 把一頁的放置結果轉成繪圖指令（先畫容器底色，再畫內容） */
function pageOps(fc: FlowContext, flow: PageFlow, anchorsOut: { id: string; y: number }[]): Op[] {
  const deco: Op[] = []
  const ops: Op[] = []
  const ranges = new Map<number, { top: number; bottom: number }>()
  for (const p of flow.placements) {
    const cs = p.item.containers ?? []
    cs.forEach((c, k) => {
      const inner = cs.slice(k + 1).reduce((s, x) => s + fc.containers[x].pad, 0)
      const top = p.y - inner
      const bottom = p.y + p.item.h + inner
      const r = ranges.get(c)
      if (r) {
        r.top = Math.min(r.top, top)
        r.bottom = Math.max(r.bottom, bottom)
      } else ranges.set(c, { top, bottom })
    })
    for (const o of p.item.ops) ops.push(shiftOp(o, p.y))
    if (p.index >= 0) for (const id of p.item.anchors ?? []) anchorsOut.push({ id, y: p.y })
  }
  // 外層容器先畫
  for (const [c, r] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const ct = fc.containers[c]
    deco.push({
      t: 'rect',
      x: ct.x,
      y: r.top - ct.pad,
      w: ct.w,
      h: r.bottom - r.top + ct.pad * 2,
      fill: ct.fill,
      stroke: ct.stroke,
      lw: ct.stroke ? 0.6 : undefined,
      r: ct.r,
    })
  }
  return [...deco, ...ops]
}

/** 目錄項目 → 流動項目（引導點對齊頁碼、整個項目可點擊） */
function tocItems(fc: FlowContext, o: ComposeOptions, entries: TocEntry[], numbers: Map<string, string>, numW: number): FlowItem[] {
  const th = o.theme
  const base = o.baseSize
  const x0 = o.page.margin.left
  const W = fc.contentWidth
  const items: FlowItem[] = []
  // 標題
  const titleSize = base * th.headingScale[0] * 0.85
  const titleStyle = fc.style({ family: th.heading, bold: true, italic: false, size: titleSize, color: th.colors.heading })
  const tl = fc.breaker.break([{ text: o.toc.title, style: titleStyle }], { width: W }).lines
  tl.forEach((line, i) => {
    const lh = titleSize * 1.35
    const x = th.h1Center ? x0 + (W - line.width) / 2 : x0
    const it: FlowItem = { h: lh, before: 0, ops: lineOps(fc, line, x, lh).ops, keepNext: true }
    if (i === tl.length - 1) {
      if (th.headingRule[0]) {
        it.h += titleSize * 0.3
        it.ops.push({ t: 'line', x1: x0, y1: it.h, x2: x0 + W, y2: it.h, color: th.colors.rule, w: 1 })
      } else if (th.h1Band) {
        it.h += titleSize * 0.22
        it.ops.push({ t: 'rect', x: x0, y: it.h, w: 44, h: 3.2, fill: th.colors.accent, r: 1.6 })
        it.h += 3.2
      }
      it.h += base * 1.2
    }
    items.push(it)
  })
  const maxLevel = Math.max(1, ...entries.map((e) => e.level))
  const lh = base * 1.75
  for (const [k, e] of entries.entries()) {
    const top = e.level === 1
    const size = top ? base : base * 0.95
    const indent = (e.level - 1) * base * 1.5
    const bold = top && maxLevel > 1
    const color = top ? th.colors.heading : th.colors.text
    const style = fc.style({ family: th.body, bold, italic: false, size, color })
    const numStyle = fc.style({ family: th.body, bold, italic: false, size, color: top ? th.colors.heading : th.colors.muted })
    const label = e.number ? `${e.number}\u2002${e.text}` : e.text
    const textW = W - indent - numW - base * 2.2
    const lines = fc.breaker.break([{ text: label, style }], { width: textW }).lines
    const pageStr = numbers.get(e.id) ?? ''
    const numLine = fc.breaker.break([{ text: pageStr, style: numStyle }], { width: numW * 2 }).lines[0]
    const entryItems: FlowItem[] = []
    lines.forEach((line, i) => {
      const { ops, baseline } = lineOps(fc, line, x0 + indent, lh)
      const it: FlowItem = { h: lh, before: i === 0 && k > 0 ? (top && maxLevel > 1 ? base * 0.55 : base * 0.1) : 0, ops }
      if (i === lines.length - 1) {
        // 頁碼靠右；引導點對齊到全域格線，讓上下列的點對齊
        const nx = x0 + W - numLine.width
        it.ops.push(...lineOps(fc, numLine, nx, lh).ops)
        const step = 3.4
        const startX = Math.ceil((x0 + indent + line.width + 6) / step) * step
        const endX = nx - 5
        if (endX - startX > step) {
          it.ops.push({
            t: 'line',
            x1: startX,
            y1: baseline - size * 0.12,
            x2: endX,
            y2: baseline - size * 0.12,
            color: th.colors.muted,
            w: 0.95,
            dash: [0, step],
            round: true,
          })
        }
      }
      if (i < lines.length - 1) it.keepNext = true
      entryItems.push(it)
    })
    // 整個項目可點擊
    const total = entryItems.reduce((s, it) => s + it.h, 0)
    entryItems[0].ops.push({ t: 'link', x: x0 + indent, y: 0, w: W - indent, h: total, dest: e.id })
    items.push(...entryItems)
  }
  return items
}

function truncate(fc: FlowContext, text: string, style: number, width: number): string {
  if (fc.breaker.measure([{ text, style }]).max <= width) return text
  const chars = Array.from(text)
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    const t = chars.slice(0, mid).join('') + '…'
    if (fc.breaker.measure([{ text: t, style }]).max <= width) lo = mid
    else hi = mid - 1
  }
  return chars.slice(0, lo).join('') + '…'
}

/** 頁首（文件標題｜目前章節）與頁尾（n / N） */
function headerFooter(fc: FlowContext, o: ComposeOptions, pageNo: number, total: number, section: string | null): Op[] {
  const ops: Op[] = []
  const th = o.theme
  const { width: PW, height: PH, margin } = o.page
  const x0 = margin.left
  const W = fc.contentWidth
  const size = Math.max(7.5, o.baseSize * 0.72)
  const style = fc.style({ family: th.body, bold: false, italic: false, size, color: th.colors.muted })
  if (o.header) {
    const by = Math.max(margin.top * 0.55, size * 2)
    const half = W / 2 - 8
    const left = truncate(fc, o.title, style, section && section !== o.title ? half : W)
    const l = fc.breaker.break([{ text: left, style }], { width: W }).lines[0]
    ops.push(...lineOps(fc, l, x0, size * 1.4).ops.map((op) => shiftOp(op, by - size)))
    if (section && section !== o.title) {
      const right = truncate(fc, section, style, half)
      const r = fc.breaker.break([{ text: right, style }], { width: W }).lines[0]
      ops.push(...lineOps(fc, r, x0 + W - r.width, size * 1.4).ops.map((op) => shiftOp(op, by - size)))
    }
    ops.push({ t: 'line', x1: x0, y1: by + size * 0.75, x2: x0 + W, y2: by + size * 0.75, color: th.colors.rule, w: 0.5 })
  }
  if (o.footer) {
    const text = `${pageNo} / ${total}`
    const f = fc.breaker.break([{ text, style }], { width: W }).lines[0]
    const fy = PH - Math.max(margin.bottom * 0.5, size * 2.2)
    ops.push(...lineOps(fc, f, (PW - f.width) / 2, size * 1.4).ops.map((op) => shiftOp(op, fy - size * 0.7)))
  }
  return ops
}

function coverOps(fc: FlowContext, o: ComposeOptions): Op[] {
  const th = o.theme
  const { height: PH, margin } = o.page
  const x0 = margin.left
  const W = fc.contentWidth
  const ops: Op[] = []
  const size = o.baseSize * 2.5
  const style = fc.style({ family: th.heading, bold: true, italic: false, size, color: th.colors.heading })
  const lines = fc.breaker.break([{ text: o.title, style }], { width: W * 0.86 }).lines
  const lh = size * 1.3
  let y = PH * 0.34 - (lines.length * lh) / 2
  const centered = th.id !== 'modern'
  for (const line of lines) {
    const x = centered ? x0 + (W - line.width) / 2 : x0
    ops.push(...lineOps(fc, line, x, lh).ops.map((op) => shiftOp(op, y)))
    y += lh
  }
  y += size * 0.4
  if (th.id === 'academic') ops.push({ t: 'line', x1: x0 + W * 0.3, y1: y, x2: x0 + W * 0.7, y2: y, color: th.colors.rule, w: 0.8 })
  else ops.push({ t: 'rect', x: centered ? x0 + W / 2 - 28 : x0, y, w: 56, h: 3.5, fill: th.colors.accent, r: 1.75 })
  y += o.baseSize * 2.2
  const sub = fc.style({ family: th.body, bold: false, italic: false, size: o.baseSize * 1.05, color: th.colors.muted })
  const small = fc.style({ family: th.body, bold: false, italic: false, size: o.baseSize * 0.9, color: th.colors.muted })
  const put = (text: string, st: number, lineH: number) => {
    for (const line of fc.breaker.break([{ text, style: st }], { width: W * 0.8 }).lines) {
      const x = centered ? x0 + (W - line.width) / 2 : x0
      ops.push(...lineOps(fc, line, x, lineH).ops.map((op) => shiftOp(op, y)))
      y += lineH
    }
  }
  if (o.cover.date) put(o.cover.date, sub, o.baseSize * 1.7)
  if (o.cover.files.length > 1) {
    y += o.baseSize
    for (const f of o.cover.files.slice(0, 12)) put(f, small, o.baseSize * 1.45)
    if (o.cover.files.length > 12) put(`… +${o.cover.files.length - 12}`, small, o.baseSize * 1.45)
  }
  return ops
}

/** 頁面頂端目前的章節（頁首右側）：這一頁開始的第一個 H1，否則沿用前一個 */
function sections(flows: PageFlow[]): (string | null)[] {
  let cur: string | null = null
  return flows.map((f) => {
    const first = f.placements.find((p) => p.index >= 0 && p.item.section)
    if (first) cur = first.item.section!
    const out = cur
    // 這頁之後的章節延續到下一頁
    for (const p of f.placements) if (p.index >= 0 && p.item.section) cur = p.item.section
    return out
  })
}

export function composeDocuments(docs: DocModel[], measurer: Measurer, o: ComposeOptions, onProgress?: (p: number) => void): Composed {
  const fc = new FlowContext(measurer, o)
  const items: FlowItem[] = []
  const numbers = new Map<string, string>()
  docs.forEach((doc, i) => {
    const dl = new DocLayout(fc, doc)
    const its = dl.layout(doc)
    if (!its.length) its.push({ h: 0, before: 0, ops: [] })
    its[0].anchors = [...(its[0].anchors ?? []), docAnchor(i)]
    if (i > 0) its[0].breakBefore = true
    items.push(...its)
    for (const [k, v] of dl.headingNumbers) numbers.set(k, v)
    onProgress?.((i + 1) / docs.length)
  })
  const content = paginate(items, fc)

  // 內文頁中的錨點
  const contentAnchors: { id: string; y: number }[][] = []
  const contentOps = content.map((flow) => {
    const a: { id: string; y: number }[] = []
    const ops = pageOps(fc, flow, a)
    contentAnchors.push(a)
    return ops
  })
  const contentDest = new Map<string, Dest>()
  contentAnchors.forEach((as, p) => as.forEach((a) => !contentDest.has(a.id) && contentDest.set(a.id, { page: p, y: a.y })))

  const exclude = new Set(o.toc.exclude)
  const allEntries = buildEntries(docs, numbers).filter((e) => contentDest.has(e.id))
  const entries = allEntries.filter((e) => e.level <= o.toc.maxLevel && !exclude.has(e.id))
  const front = o.cover.enabled ? 1 : 0
  const tocOn = o.toc.enabled && entries.length > 0

  // 兩階段：目錄頁數 T 會影響內文頁碼，反覆計算直到穩定
  let T = 0
  let tocFlows: PageFlow[] = []
  const pageNumbers = new Map<string, number>()
  if (tocOn) {
    for (let iter = 0; iter < 5; iter++) {
      const total = front + T + content.length
      const offset = front + (o.toc.position === 'front' ? T : 0)
      pageNumbers.clear()
      for (const e of entries) pageNumbers.set(e.id, offset + contentDest.get(e.id)!.page + 1)
      // 頁碼欄寬：以總頁數的位數預留
      const digitStyle = fc.style({ family: o.theme.body, bold: true, italic: false, size: o.baseSize, color: o.theme.colors.text })
      const numW = fc.breaker.measure([{ text: '8'.repeat(String(total + 2).length), style: digitStyle }]).max
      const strs = new Map([...pageNumbers].map(([k, v]) => [k, String(v)]))
      tocFlows = paginate(tocItems(fc, o, entries, strs, numW), fc)
      if (tocFlows.length === T) break
      T = tocFlows.length
    }
  } else {
    const offset = front
    for (const e of allEntries) pageNumbers.set(e.id, offset + contentDest.get(e.id)!.page + 1)
  }

  // 依序組成實體頁面
  const pages: ComposedPage[] = []
  const secs = sections(content)
  if (o.cover.enabled) pages.push({ kind: 'cover', ops: coverOps(fc, o) })
  const tocPages = tocFlows.map((f) => ({ kind: 'toc' as const, ops: pageOps(fc, f, []) }))
  if (tocOn && o.toc.position === 'front') pages.push(...tocPages)
  const contentStart = pages.length
  content.forEach((_, i) => pages.push({ kind: 'content', ops: contentOps[i] }))
  if (tocOn && o.toc.position === 'end') pages.push(...tocPages)
  const total = pages.length
  pages.forEach((p, i) => {
    if (p.kind === 'cover') return
    const sec = p.kind === 'content' ? secs[i - contentStart] : o.toc.title
    p.ops.push(...headerFooter(fc, o, i + 1, total, sec))
  })

  const dests = new Map<string, Dest>()
  for (const [id, d] of contentDest) dests.set(id, { page: contentStart + d.page, y: d.y })

  const outlineEntries = o.bookmarks ? allEntries.filter((e) => !exclude.has(e.id) && e.level <= Math.max(o.toc.maxLevel, 3)) : []
  return {
    pages,
    dests,
    outline: buildOutlineTree(outlineEntries),
    entries,
    pageNumbers,
    tocPages: tocOn ? tocFlows.length : 0,
    contentPages: content.length,
    missing: fc.missing,
  }
}
