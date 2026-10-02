/**
 * 純文字（.txt）→ 內部文件模型：用啟發式自動辨識結構。
 * - 標題：Markdown 式 #、setext 底線（=== / ---）、「第一章／第1節／第一部」、「壹、」「一、」「（一）」、
 *   「1.」「1.1」「1.1.1」編號、全大寫短行、前後空行包夾且沒有句末標點的短行（文件裡有長段落時才啟用）、第一行的文件標題。
 * - 清單：- * + • · ● ○ ■ 、1. 1) (1) a) ①…，依縮排巢狀；[ ] [x] 任務清單。
 * - 表格：| 分隔、Tab 分隔、或以 2 個以上空白對齊的多行。
 * - 程式碼：``` 圍欄，或縮排 4 格的區塊（看起來像程式碼才算；整份都縮排的小說體不算）。
 * - 段落：判斷硬換行（每行固定寬度）還是一行一段，中文行與行之間接起來不加空白。
 * 「保持原樣」模式：整份等寬、保留所有空白與換行，不辨識結構。
 */
import {
  createSlugger,
  runsText,
  type Align,
  type Block,
  type DocModel,
  type HeadingBlock,
  type ListBlock,
  type ListItem,
  type Run,
  type TableCell,
} from './model'
import { SENTENCE_END, displayWidth } from './text'
import { splitExt } from '@/lib/filename'

export interface TxtOptions {
  /** 保持原樣：等寬、不辨識結構 */
  raw?: boolean
  idPrefix?: string
}

type HeadingKind =
  | 'md1'
  | 'md2'
  | 'md3'
  | 'md4'
  | 'md5'
  | 'md6'
  | 'title'
  | 'setext1'
  | 'part'
  | 'chapter'
  | 'setext2'
  | 'section'
  | 'cnUpper'
  | 'cnEnum'
  | 'cnParen'
  | 'num1'
  | 'num2'
  | 'num3'
  | 'caps'
  | 'isolated'

/** 標題種類的階層順序：出現在文件中的種類依此順序分配 H1、H2… */
const KIND_ORDER: HeadingKind[] = [
  'md1',
  'md2',
  'md3',
  'md4',
  'md5',
  'md6',
  'title',
  'setext1',
  'part',
  'chapter',
  'setext2',
  'section',
  'cnUpper',
  'cnEnum',
  'cnParen',
  'num1',
  'num2',
  'num3',
  'caps',
  'isolated',
]

const CN_NUM = '一二三四五六七八九十百千零〇两兩'
const DIGITS = '0-9０-９'
const RE_PART = new RegExp(`^第\\s*[${CN_NUM}${DIGITS}]+\\s*[部篇卷集冊册編编]`)
const RE_CHAPTER = new RegExp(`^第\\s*[${CN_NUM}${DIGITS}]+\\s*[章回]`)
const RE_SECTION = new RegExp(`^第\\s*[${CN_NUM}${DIGITS}]+\\s*[節节]`)
const RE_CN_UPPER = /^[壹貳參肆伍陸柒捌玖拾]+\s*[、．.]\s*\S/
const RE_CN_ENUM = new RegExp(`^[${CN_NUM}]+\\s*[、．]\\s*\\S`)
const RE_CN_PAREN = new RegExp(`^[（(][${CN_NUM}]+[）)]\\s*\\S`)
const RE_NUM3 = /^\d{1,2}\.\d{1,2}\.\d{1,2}\.?\s+\S/
const RE_NUM2 = /^\d{1,2}\.\d{1,2}\.?\s+\S/
const RE_NUM1 = /^\d{1,2}\s*[.、．]\s*\S/
const RE_MD = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const RE_FENCE = /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/
const RE_HR = /^\s*(?:([-=*_~─━═＊])\s*\1(?:\s*\1)+|(?:\*\s*){3,})\s*$/
const RE_SETEXT1 = /^\s*={3,}\s*$/
const RE_SETEXT2 = /^\s*-{3,}\s*$/
const RE_LIST =
  /^([ \t\u3000]*)([-*+•·‧●○■□▪◦–]|\d{1,3}[.)、]|[(（]\d{1,3}[)）]|[a-zA-Z][)]|[①-⑳])[ \t\u3000]+(.*)$/
const RE_TASK = /^\[([ xX])\]\s+(.*)$/
const RE_URL =
  /(https?:\/\/[^\s<>"'，。、；：）」』》]+[^\s<>"'，。、；：）」』》.,;:!?)\]])|([\w.+-]+@[\w-]+\.[\w.-]+\w)/g

const isBlank = (s: string | undefined) => s === undefined || !s.trim()
const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/
/** 中文為主的行（中日韓字超過三成） */
function isCjkLine(l: string) {
  const t = l.replace(/\s/g, '')
  const n = (t.match(new RegExp(CJK_RE.source, 'g')) ?? []).length
  return t.length > 0 && n / t.length > 0.3
}
const leadingWidth = (s: string) => displayWidth(/^[ \t\u3000]*/.exec(s)![0], 4)

/** 一行是否「短」：可能是標題 */
function isShort(line: string, limit = 50) {
  return displayWidth(line.trim()) <= limit
}

/** 判斷一行屬於哪種標題（不含 setext、isolated、title：那些要看上下文） */
function headingKindOf(line: string): HeadingKind | null {
  const t = line.trim()
  if (!t) return null
  const md = RE_MD.exec(t)
  if (md) return `md${md[1].length}` as HeadingKind
  if (!isShort(t, 60)) return null
  if (RE_PART.test(t)) return 'part'
  if (RE_CHAPTER.test(t)) return 'chapter'
  if (RE_SECTION.test(t)) return 'section'
  const noEndPunct = !/[。．！!？?；;，,：:]$/.test(t)
  if (!noEndPunct || !isShort(t, 44)) return null
  if (RE_CN_UPPER.test(t)) return 'cnUpper'
  if (RE_CN_ENUM.test(t)) return 'cnEnum'
  if (RE_CN_PAREN.test(t)) return 'cnParen'
  if (RE_NUM3.test(t)) return 'num3'
  if (RE_NUM2.test(t)) return 'num2'
  if (RE_NUM1.test(t)) return 'num1'
  return null
}

/** 全大寫短行（英文章節標題常見寫法） */
function isCapsLine(t: string) {
  const letters = t.replace(/[^A-Za-z]/g, '')
  return (
    letters.length >= 3 &&
    letters === letters.toUpperCase() &&
    /^[A-Z0-9][A-Z0-9 \-:&'’,/()]+$/.test(t) &&
    t.length <= 60 &&
    !/[.!?,;]$/.test(t)
  )
}

function linkify(text: string): Run[] {
  const out: Run[] = []
  let last = 0
  for (const m of text.matchAll(RE_URL)) {
    const i = m.index!
    if (i > last) out.push({ text: text.slice(last, i) })
    const v = m[0]
    out.push({ text: v, link: m[1] ? v : `mailto:${v}` })
    last = i + v.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

interface PendingHeading {
  kind: HeadingKind
  text: string
}

type Draft = Block | { type: 'pendingHeading'; h: PendingHeading }

export function parseTxt(text: string, name: string, opts: TxtOptions = {}): DocModel {
  const prefix = opts.idPrefix ?? 'h'
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\f/g, '\n')
  if (opts.raw) {
    return {
      name,
      kind: 'txt',
      title: splitExt(name).base,
      blocks: normalized.trim()
        ? [{ type: 'code', text: normalized.replace(/\n+$/, ''), plain: true }]
        : [],
    }
  }
  const lines = normalized.split('\n')
  const p = new TxtParser(lines)
  const drafts = p.parse()
  // 分配標題層級：出現的種類依 KIND_ORDER 排序後依序給 H1、H2…
  const kinds = new Set<HeadingKind>()
  for (const d of drafts) if (d.type === 'pendingHeading') kinds.add(d.h.kind)
  const present = KIND_ORDER.filter((k) => kinds.has(k))
  const mdLevels = present.filter((k) => k.startsWith('md'))
  const levelOf = (k: HeadingKind): HeadingBlock['level'] => {
    if (k.startsWith('md') && mdLevels.length === present.length)
      return Number(k.slice(2)) as HeadingBlock['level']
    return Math.min(6, present.indexOf(k) + 1) as HeadingBlock['level']
  }
  const slug = createSlugger()
  let n = 0
  const blocks: Block[] = drafts.map((d) => {
    if (d.type !== 'pendingHeading') return d
    const t = d.h.text
    return {
      type: 'heading',
      level: levelOf(d.h.kind),
      runs: linkify(t),
      id: `${prefix}${n++}`,
      slug: slug(t),
    }
  })
  const first = blocks.find((b): b is HeadingBlock => b.type === 'heading' && b.level === 1)
  return {
    name,
    kind: 'txt',
    title: first ? runsText(first.runs) : splitExt(name).base,
    blocks,
  }
}

class TxtParser {
  private lines: string[]
  /** 大多數非空行都縮排（小說體）：縮排是段落縮排，不是程式碼 */
  private indentedProse: boolean
  /** 換行寬度估計（90 百分位的行寬；中文行與其他行分開） */
  private wrapCjk: number
  private wrapLat: number
  private wrapOf(line: string) {
    return isCjkLine(line) ? this.wrapCjk : this.wrapLat
  }
  /** 是否每行固定寬度硬換行 */
  private hardWrapped: boolean
  /** 文件裡有長段落：「前後空行的短行」才可能是標題 */
  private hasLongParagraphs: boolean

  constructor(lines: string[]) {
    this.lines = lines
    const nonBlank = lines.filter((l) => l.trim())
    // 小說體：「像文章的行」（含中文或以句末標點結尾）大多縮排
    const prose = nonBlank.filter((l) => CJK_RE.test(l) || SENTENCE_END.test(l.trim()))
    const indented = prose.filter((l) => /^([ ]{2,}|\t|\u3000)/.test(l)).length
    this.indentedProse = prose.length > 0 && indented / prose.length > 0.5
    // 換行寬度：中文為主的行與其他行分開估計（兩者的硬換行寬度不同）
    const pct = (ws: number[]) => {
      const s = [...ws].sort((a, b) => a - b)
      return s.length ? s[Math.floor((s.length - 1) * 0.9)] : 80
    }
    const cjkW: number[] = []
    const latW: number[] = []
    for (const l of nonBlank) (isCjkLine(l) ? cjkW : latW).push(displayWidth(l.trim()))
    this.wrapCjk = pct(cjkW)
    this.wrapLat = pct(latW)
    // 硬換行：多行的群組中，大部分行接近同一個寬度
    let inGroup = 0
    let nearWrap = 0
    for (let i = 0; i < lines.length; i++) {
      if (isBlank(lines[i]) || isBlank(lines[i + 1])) continue
      inGroup++
      if (displayWidth(lines[i].trim()) >= this.wrapOf(lines[i]) * 0.8) nearWrap++
    }
    this.hardWrapped =
      Math.max(this.wrapCjk, this.wrapLat) <= 110 && inGroup >= 2 && nearWrap / inGroup >= 0.5
    // 長段落：寬度 > 60 的行，或連續多行的段落
    let groups = 0
    let long = 0
    let cur = 0
    let curW = 0
    const endGroup = () => {
      if (cur) {
        groups++
        if (cur >= 2 || curW > 60) long++
      }
      cur = 0
      curW = 0
    }
    for (const l of lines) {
      if (!l.trim()) endGroup()
      else {
        cur++
        curW = Math.max(curW, displayWidth(l.trim()))
      }
    }
    endGroup()
    this.hasLongParagraphs = groups > 0 && long / groups >= 0.3
  }

  parse(): Draft[] {
    const out: Draft[] = []
    const L = this.lines
    let i = 0
    let sawContent = false
    while (i < L.length) {
      const line = L[i]
      if (isBlank(line)) {
        i++
        continue
      }
      const prevBlank = i === 0 || isBlank(L[i - 1])
      const nextLine = L[i + 1]
      const t = line.trim()

      // 圍欄程式碼
      const fence = RE_FENCE.exec(line)
      if (fence) {
        const close = fence[1]
        let j = i + 1
        const body: string[] = []
        while (j < L.length && !L[j].trim().startsWith(close)) body.push(L[j++])
        out.push({ type: 'code', text: body.join('\n'), lang: fence[2] || undefined })
        i = j + 1
        sawContent = true
        continue
      }

      // setext 標題：文字行下面接 === 或 ---
      if (nextLine !== undefined && isShort(t, 80) && !RE_HR.test(line) && !RE_LIST.test(line)) {
        if (RE_SETEXT1.test(nextLine) || (RE_SETEXT2.test(nextLine) && prevBlank)) {
          out.push({
            type: 'pendingHeading',
            h: { kind: RE_SETEXT1.test(nextLine) ? 'setext1' : 'setext2', text: t },
          })
          i += 2
          sawContent = true
          continue
        }
      }

      // 水平線
      if (RE_HR.test(line)) {
        out.push({ type: 'hr' })
        i++
        continue
      }

      // 明確樣式的標題
      const kind = headingKindOf(line)
      if (kind) {
        const isNumbered = kind === 'num1'
        // 「1. xxx」若下一行緊接著也是編號，或本身前後都沒有空行，比較像清單
        let nn = i + 1
        while (nn < L.length && isBlank(L[nn])) nn++
        const nextIsSibling =
          nn < L.length &&
          /^\s*\d{1,3}[.)、]\s/.test(L[nn]) &&
          !headingKindOf(L[nn])?.startsWith('num2')
        if (!isNumbered || (prevBlank && !nextIsSibling)) {
          const md = RE_MD.exec(t)
          out.push({ type: 'pendingHeading', h: { kind, text: md ? md[2] : t } })
          i++
          sawContent = true
          continue
        }
      }

      // 表格
      const table = this.tryTable(i)
      if (table) {
        out.push(table.block)
        i = table.next
        sawContent = true
        continue
      }

      // 清單
      if (RE_LIST.test(line)) {
        const list = this.collectList(i)
        out.push(list.block)
        i = list.next
        sawContent = true
        continue
      }

      // 縮排程式碼
      const code = this.tryIndentedCode(i)
      if (code) {
        out.push(code.block)
        i = code.next
        sawContent = true
        continue
      }

      const nextBlank = isBlank(nextLine)
      const standalone = prevBlank && nextBlank
      const looksTitle =
        standalone && isShort(t, 50) && !SENTENCE_END.test(t) && !/[，,：:]$/.test(t)
      // 第一行文件標題
      if (!sawContent && looksTitle && this.hasLongParagraphs) {
        out.push({ type: 'pendingHeading', h: { kind: 'title', text: t } })
        i++
        sawContent = true
        continue
      }
      // 全大寫短行
      if (standalone && isCapsLine(t)) {
        out.push({ type: 'pendingHeading', h: { kind: 'caps', text: t } })
        i++
        sawContent = true
        continue
      }
      // 前後空行包夾、沒有句末標點的短行
      if (looksTitle && this.hasLongParagraphs && isShort(t, 40) && !/^[([（「『"'“]/.test(t)) {
        out.push({ type: 'pendingHeading', h: { kind: 'isolated', text: t } })
        i++
        sawContent = true
        continue
      }

      // 段落
      const para = this.collectParagraphs(i)
      out.push(...para.blocks)
      i = para.next
      sawContent = true
    }
    return out
  }

  /** 從 i 開始的這一行之後，是否開始另一種結構（段落要在這裡停下） */
  private startsStructure(j: number): boolean {
    const l = this.lines[j]
    if (isBlank(l)) return true
    if (RE_FENCE.test(l) || RE_HR.test(l)) return true
    if (RE_MD.test(l.trim())) return true
    const k = headingKindOf(l)
    if (k && k !== 'num1' && k !== 'cnEnum' && k !== 'cnParen') return true
    if (RE_LIST.test(l) && !/^[ \t\u3000]{2,}/.test(l)) return true
    return false
  }

  private collectParagraphs(start: number): { blocks: Block[]; next: number } {
    const L = this.lines
    const group: string[] = [L[start]]
    let j = start + 1
    while (j < L.length && !this.startsStructure(j)) {
      if (this.tryTable(j)) break
      group.push(L[j])
      j++
    }
    const blocks: Block[] = []
    let text = ''
    let indent = false
    const flush = () => {
      if (text.trim())
        blocks.push({ type: 'paragraph', runs: linkify(text.trim()), indent: indent || undefined })
      text = ''
    }
    for (let k = 0; k < group.length; k++) {
      const raw = group[k]
      const line = raw.trim()
      const lineIndented = /^([ ]{2,}|\t|\u3000)/.test(raw)
      if (k === 0) {
        text = line
        indent = lineIndented && this.indentedProse
        continue
      }
      const prev = group[k - 1].trim()
      const prevW = displayWidth(prev)
      const prevShort = prevW < this.wrapOf(prev) * 0.7
      const prevEnds = SENTENCE_END.test(prev)
      if (lineIndented) {
        flush()
        text = line
        indent = this.indentedProse
      } else if (!this.hardWrapped) {
        // 一行一段的文字：句末就分段，否則保留換行
        if (prevEnds) {
          flush()
          text = line
          indent = false
        } else text += '\n' + line
      } else if (prevShort && prevEnds) {
        flush()
        text = line
        indent = false
      } else if (prevShort) {
        text += '\n' + line
      } else {
        text += joiner(prev, line) + line
      }
    }
    flush()
    return { blocks, next: j }
  }

  private tryIndentedCode(start: number): { block: Block; next: number } | null {
    if (this.indentedProse) return null
    const L = this.lines
    const isCodeLine = (l: string) => /^( {4}|\t)/.test(l)
    if (!isCodeLine(L[start])) return null
    if (start > 0 && !isBlank(L[start - 1])) return null
    let j = start
    const body: string[] = []
    while (
      j < L.length &&
      (isCodeLine(L[j]) || (isBlank(L[j]) && j + 1 < L.length && isCodeLine(L[j + 1])))
    ) {
      body.push(L[j].replace(/^( {4}|\t)/, ''))
      j++
    }
    const text = body.join('\n')
    const chars = text.replace(/\s/g, '')
    const cjk = (chars.match(/[\u3000-鿿＀-￯]/g) ?? []).length
    const symbols = (chars.match(/[{}()[\];=<>/\\*#$_|&]/g) ?? []).length
    const codey = chars.length > 0 && symbols / chars.length >= 0.04
    if (!(cjk / Math.max(1, chars.length) < 0.3 && (codey || body.length >= 3))) return null
    return { block: { type: 'code', text }, next: j }
  }

  /** 表格：| 分隔、Tab 分隔、或以 2 個以上空白對齊 */
  tryTable(start: number): { block: Block; next: number } | null {
    return this.tryPipeTable(start) ?? this.tryTabTable(start) ?? this.trySpaceTable(start)
  }

  private tryPipeTable(start: number): { block: Block; next: number } | null {
    const L = this.lines
    const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
    const split = (l: string) => {
      let s = l.trim()
      if (s.startsWith('|')) s = s.slice(1)
      if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
      return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
    }
    if (!L[start]?.includes('|')) return null
    const first = split(L[start])
    if (first.length < 2) return null
    const rows: string[][] = [first]
    let align: (Align | null)[] = first.map(() => null)
    let hasSep = false
    let j = start + 1
    while (j < L.length && L[j].includes('|') && !isBlank(L[j])) {
      if (SEP.test(L[j])) {
        if (rows.length === 1 && !hasSep) {
          hasSep = true
          align = split(L[j]).map((c) =>
            c.startsWith(':') && c.endsWith(':')
              ? 'center'
              : c.endsWith(':')
                ? 'right'
                : c.startsWith(':')
                  ? 'left'
                  : null,
          )
        }
        j++
        continue
      }
      const cells = split(L[j])
      if (Math.abs(cells.length - first.length) > 1) break
      rows.push(cells)
      j++
    }
    if (rows.length < 2) return null
    return { block: makeTable(rows, hasSep || looksLikeHeader(rows) ? 1 : 0, align), next: j }
  }

  private tryTabTable(start: number): { block: Block; next: number } | null {
    const L = this.lines
    if (!L[start]?.includes('\t') || /^\t/.test(L[start])) return null
    const split = (l: string) =>
      l
        .trim()
        .split(/\t+/)
        .map((c) => c.trim())
    const n = split(L[start]).length
    if (n < 2) return null
    const rows: string[][] = []
    let j = start
    while (j < L.length && L[j].includes('\t') && !isBlank(L[j])) {
      const cells = split(L[j])
      if (cells.length !== n && Math.abs(cells.length - n) > 1) break
      rows.push(cells)
      j++
    }
    if (rows.length < 2) return null
    return { block: makeTable(rows, looksLikeHeader(rows) ? 1 : 0, []), next: j }
  }

  private trySpaceTable(start: number): { block: Block; next: number } | null {
    const L = this.lines
    // 切出欄位與每欄的起訖顯示位置
    const split = (l: string) => {
      const cells: { text: string; start: number; end: number }[] = []
      const re = /\S+(?: \S+)*/g
      for (const m of l.matchAll(re)) {
        const s = displayWidth(l.slice(0, m.index!))
        cells.push({ text: m[0], start: s, end: s + displayWidth(m[0]) })
      }
      return cells
    }
    if (!/\S {2,}\S/.test(L[start] ?? '')) return null
    const first = split(L[start])
    if (first.length < 2) return null
    const rows = [first]
    let j = start + 1
    while (j < L.length && !isBlank(L[j]) && /\S {2,}\S/.test(L[j])) {
      const cells = split(L[j])
      if (cells.length !== first.length) break
      rows.push(cells)
      j++
    }
    if (rows.length < 2) return null
    // 每一欄的起點或終點要對齊（±1 格），而且欄位要短（排除兩個空白分句的散文）
    for (let c = 0; c < first.length; c++) {
      const starts = rows.map((r) => r[c].start)
      const ends = rows.map((r) => r[c].end)
      const aligned = (v: number[]) => Math.max(...v) - Math.min(...v) <= 1
      if (c > 0 && !aligned(starts) && !aligned(ends)) return null
    }
    const cellsFlat = rows.flat()
    const avg = cellsFlat.reduce((s, c) => s + displayWidth(c.text), 0) / cellsFlat.length
    if (avg > 24) return null
    // 欄位多半以句點結尾：是用兩個空白分句的散文
    if (cellsFlat.filter((c) => /[.。!?！？]$/.test(c.text)).length >= cellsFlat.length / 2)
      return null
    return {
      block: makeTable(
        rows.map((r) => r.map((c) => c.text)),
        looksLikeHeader(rows.map((r) => r.map((c) => c.text))) ? 1 : 0,
        [],
      ),
      next: j,
    }
  }

  /** 清單：收集連續的項目（含續行與空行分隔的鬆散清單），依縮排建立巢狀 */
  private collectList(start: number): { block: ListBlock; next: number } {
    const L = this.lines
    interface Flat {
      indent: number
      marker: string
      text: string
    }
    const flat: Flat[] = []
    let j = start
    const baseIndent = leadingWidth(L[start])
    const baseOrdered = isOrderedMarker(RE_LIST.exec(L[start])![2])
    while (j < L.length) {
      const l = L[j]
      if (isBlank(l)) {
        // 空行後接著同一份清單的項目（鬆散清單）
        const k = j + 1
        const m2 = RE_LIST.exec(L[k] ?? '')
        if (
          k < L.length &&
          m2 &&
          leadingWidth(L[k]) >= baseIndent &&
          isOrderedMarker(m2[2]) === baseOrdered
        ) {
          j = k
          continue
        }
        break
      }
      const m = RE_LIST.exec(l)
      // 同一層換了另一種清單（項目符號 ↔ 編號）就是新的清單
      if (m && leadingWidth(l) === baseIndent && isOrderedMarker(m[2]) !== baseOrdered) break
      if (m && leadingWidth(l) >= baseIndent) {
        flat.push({ indent: leadingWidth(l), marker: m[2], text: m[3].trim() })
        j++
        continue
      }
      // 續行：比項目符號縮排更深，或沒有縮排但緊接在項目後（硬換行的長項目）
      const last = flat[flat.length - 1]
      if (
        last &&
        (leadingWidth(l) > last.indent || (!this.startsStructure(j) && !headingKindOf(l)))
      ) {
        last.text += joiner(last.text, l.trim()) + l.trim()
        j++
        continue
      }
      break
    }
    return { block: buildList(flat, 0, flat.length), next: j }
  }
}

/** 兩行接在一起時要不要加空白：中日韓字之間不加 */
function joiner(prev: string, next: string): string {
  const a = prev.slice(-1)
  const b = next.slice(0, 1)
  const cjk = /[⺀-鿿가-힯豈-﫿＀-￯]/
  if (cjk.test(a) || cjk.test(b)) return ''
  return ' '
}

const isOrderedMarker = (m: string) => /^(\d|[(（]\d|[a-zA-Z]\)|[①-⑳])/.test(m)

function markerNumber(m: string): number {
  const d = /\d+/.exec(m)
  if (d) return parseInt(d[0], 10)
  const c = m.codePointAt(0)!
  if (c >= 0x2460 && c <= 0x2473) return c - 0x2460 + 1
  if (/^[a-z]/.test(m)) return m.charCodeAt(0) - 96
  if (/^[A-Z]/.test(m)) return m.charCodeAt(0) - 64
  return 1
}

function buildList(
  flat: { indent: number; marker: string; text: string }[],
  from: number,
  to: number,
): ListBlock {
  const base = flat[from]
  const ordered = isOrderedMarker(base.marker)
  const items: ListItem[] = []
  let k = from
  while (k < to) {
    const cur = flat[k]
    // 子項目：縮排比目前項目深的連續項目
    let end = k + 1
    while (end < to && flat[end].indent > cur.indent) end++
    const task = RE_TASK.exec(cur.text)
    const blocks: Block[] = [{ type: 'paragraph', runs: linkify(task ? task[2] : cur.text) }]
    if (end > k + 1) blocks.push(buildList(flat, k + 1, end))
    const keepMarker = ordered && !/^\d+[.)]$/.test(cur.marker) ? cur.marker : undefined
    items.push({ task: task ? task[1] !== ' ' : null, blocks, marker: keepMarker })
    k = end
  }
  return { type: 'list', ordered, start: ordered ? markerNumber(base.marker) : 1, items }
}

const NUMERIC = /^[-+]?[$€£¥＄￥]?\s?[\d,.]+\s?(%|％|元|萬|億|k|K|M|B)?$/

/** 第一列是否像表頭：其他列有數字而第一列沒有，或第一列全部是短文字 */
function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false
  const first = rows[0]
  const firstNumeric = first.filter((c) => NUMERIC.test(c)).length
  const restNumeric = rows.slice(1).some((r) => r.some((c) => NUMERIC.test(c)))
  if (restNumeric && firstNumeric === 0) return true
  return first.every((c) => c && displayWidth(c) <= 24) && firstNumeric === 0
}

function makeTable(rows: string[][], headerRows: number, align: (Align | null)[]): Block {
  const cols = Math.max(...rows.map((r) => r.length))
  const normalized = rows.map((r) => {
    const out = [...r]
    while (out.length < cols) out.push('')
    return out.slice(0, cols)
  })
  const al: (Align | null)[] = []
  for (let c = 0; c < cols; c++) {
    if (align[c]) {
      al.push(align[c])
      continue
    }
    const body = normalized
      .slice(headerRows)
      .map((r) => r[c])
      .filter(Boolean)
    al.push(
      body.length && body.filter((v) => NUMERIC.test(v)).length / body.length >= 0.7
        ? 'right'
        : null,
    )
  }
  const cells: TableCell[][] = normalized.map((r) => r.map((c) => ({ runs: c ? linkify(c) : [] })))
  return { type: 'table', rows: cells, headerRows, align: al }
}
