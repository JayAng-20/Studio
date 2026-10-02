/**
 * RTF 解析器（自寫，不用外部套件）→ 內部文件模型。
 * 支援：群組、控制字、\par \line \tab \page、\b \i \ul \strike \fs \plain、\ql \qc \qr \qj、
 * \uN（含 \ucN 略過替代字元）、\'hh（依 \ansicpg 或字型的 \fcharset 以 TextDecoder 解碼多位元組）、
 * 略過 \fonttbl \colortbl \stylesheet \info 與 \*\ 目的地、表格（\trowd \cellx \cell \row）、
 * 清單（\ls \ilvl＋\listtext）、超連結欄位（HYPERLINK）、PNG／JPEG 圖片（\pict）、
 * 標題（\outlinelevel、樣式名稱 heading N，或「較大字級／粗體的短段落」）。
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
import { hexToBytes, imageInfo } from './images'
import { mergeRuns } from './markdown'
import { SENTENCE_END, displayWidth } from './text'
import { splitExt } from '@/lib/filename'

/** \fcharset → 字碼頁 */
const CHARSET_CP: Record<number, number> = {
  0: 1252,
  77: 10000,
  128: 932,
  129: 949,
  134: 936,
  136: 950,
  161: 1253,
  162: 1254,
  163: 1258,
  177: 1255,
  178: 1256,
  186: 1257,
  204: 1251,
  222: 874,
  238: 1250,
}

/** 字碼頁 → TextDecoder 標籤 */
function cpLabel(cp: number): string {
  switch (cp) {
    case 950:
      return 'big5'
    case 936:
      return 'gbk'
    case 932:
      return 'shift_jis'
    case 949:
      return 'euc-kr'
    case 874:
      return 'windows-874'
    case 10000:
      return 'macintosh'
    default:
      return cp >= 1250 && cp <= 1258 ? `windows-${cp}` : 'windows-1252'
  }
}

const isDbcs = (cp: number) => cp === 950 || cp === 936 || cp === 932 || cp === 949

const decoders = new Map<string, TextDecoder>()
function decodeBytes(bytes: number[], cp: number): string {
  const label = cpLabel(cp)
  let d = decoders.get(label)
  if (!d) {
    try {
      d = new TextDecoder(label)
    } catch {
      d = new TextDecoder('windows-1252')
    }
    decoders.set(label, d)
  }
  return d.decode(new Uint8Array(bytes))
}

type Dest =
  | 'normal'
  | 'skip'
  | 'fonttbl'
  | 'stylesheet'
  | 'pict'
  | 'fldinst'
  | 'listtext'

interface Field {
  instr: string
}

interface State {
  dest: Dest
  b: boolean
  i: boolean
  u: boolean
  s: boolean
  hidden: boolean
  fs: number
  font: number
  uc: number
  link?: string
  field?: Field
  /** 群組剛開始、遇到 \* 的狀態 */
  star: boolean
  /** 群組內第一個控制字是否已出現 */
  first: boolean
  // 段落屬性（RTF 中也隨群組保存）
  align: Align
  outline: number | null
  style: number
  intbl: boolean
  ls: number
  ilvl: number
}

interface RawPara {
  runs: (Run & { fs: number })[]
  align: Align
  outline: number | null
  styleName: string
  styleOutline: number | null
  intbl: boolean
  ls: number
  ilvl: number
  listText: string
}

interface RawRow {
  cells: RawPara[][]
  header: boolean
}

type Item =
  | { k: 'para'; p: RawPara }
  | { k: 'row'; r: RawRow }
  | { k: 'image'; block: Block }
  | { k: 'pageBreak' }

/** 段落屬性控制字（遇到時重設） */
const SKIP_DESTS = new Set([
  'colortbl',
  'info',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'footnote',
  'annotation',
  'object',
  'nonshppict',
  'filetbl',
  'revtbl',
  'listtable',
  'listoverridetable',
  'xe',
  'tc',
  'txe',
  'rxe',
  'atnid',
  'atnauthor',
  'atnref',
  'atntime',
  'template',
  'private',
  'fldtype',
  'datafield',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'rsidtbl',
  'generator',
  'xmlnstbl',
  'mmathPr',
  'pgdsctbl',
])

/** \* 之後仍要處理的目的地 */
const STAR_KEEP = new Set(['fldinst', 'shppict', 'listtext'])

const CHAR_WORDS: Record<string, string> = {
  emdash: '—',
  endash: '–',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  emspace: '\u2003',
  enspace: '\u2002',
  qmspace: '\u2005',
  zwj: '\u200d',
  zwnj: '\u200c',
  ltrmark: '',
  rtlmark: '',
}

export function parseRtf(input: string | Uint8Array, name: string, idPrefix = 'h'): DocModel {
  const src = typeof input === 'string' ? input : latin1(input)
  if (!/^\s*\{\\rtf/.test(src)) throw new RtfError('notRtf')
  const p = new RtfParser(src)
  const items = p.run()
  const blocks = buildBlocks(items, idPrefix)
  const firstH1 = blocks.find((b): b is HeadingBlock => b.type === 'heading' && b.level === 1)
  return { name, kind: 'rtf', title: firstH1 ? runsText(firstH1.runs).trim() : splitExt(name).base, blocks }
}

export class RtfError extends Error {
  code: 'notRtf'
  constructor(code: 'notRtf') {
    super(code)
    this.code = code
  }
}

function latin1(b: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode(...b.subarray(i, i + CH))
  return s
}

const initialState = (): State => ({
  dest: 'normal',
  b: false,
  i: false,
  u: false,
  s: false,
  hidden: false,
  fs: 24,
  font: -1,
  uc: 1,
  star: false,
  first: true,
  align: 'left',
  outline: null,
  style: 0,
  intbl: false,
  ls: 0,
  ilvl: 0,
})

class RtfParser {
  private src: string
  private pos = 0
  private st: State = initialState()
  private stack: State[] = []
  private ansiCp = 1252
  private deff = 0
  private fontCp = new Map<number, number>()
  private styles = new Map<number, { name: string; outline: number | null }>()
  private items: Item[] = []
  // 目前段落
  private runs: (Run & { fs: number })[] = []
  private listText = ''
  // 表格
  private row: RawRow | null = null
  private cell: RawPara[] = []
  private rowHeader = false
  // 待解碼的 \'hh 位元組
  private bytes: number[] = []
  private skip = 0
  // fonttbl／stylesheet 解析暫存
  private curFont = -1
  private curStyle: { num: number; name: string; outline: number | null } | null = null
  private styleDepth = -1
  // \pict
  private pict: { hex: string[]; fmt: 'png' | 'jpg' | null; wgoal: number; hgoal: number } | null = null

  constructor(src: string) {
    this.src = src
  }

  run(): Item[] {
    const s = this.src
    const n = s.length
    while (this.pos < n) {
      const ch = s[this.pos]
      if (ch === '{') {
        this.flushBytes()
        this.stack.push(this.st)
        this.st = { ...this.st, star: false, first: true }
        // 樣式表的每個子群組是一個樣式
        if (this.st.dest === 'stylesheet' && !this.curStyle) {
          this.curStyle = { num: 0, name: '', outline: null }
          this.styleDepth = this.stack.length
        }
        this.skip = 0
        this.pos++
      } else if (ch === '}') {
        this.flushBytes()
        this.endGroup()
        this.pos++
      } else if (ch === '\\') {
        this.control()
      } else if (ch === '\r' || ch === '\n') {
        this.pos++
      } else {
        // 待解碼的位元組先處理（多位元組的尾位元組可能就是這個字元）
        if (this.bytes.length) {
          this.flushBytes(true)
          continue
        }
        // 一般文字：一次讀一段
        let j = this.pos
        while (j < n && s[j] !== '{' && s[j] !== '}' && s[j] !== '\\' && s[j] !== '\r' && s[j] !== '\n') j++
        this.text(s.slice(this.pos, j))
        this.pos = j
      }
    }
    this.flushBytes()
    this.endParagraph()
    this.endTable()
    return this.items
  }

  private endGroup() {
    const closing = this.st
    if (closing.dest === 'pict' && this.pict && (this.stack[this.stack.length - 1]?.dest !== 'pict')) this.finishPict()
    if (this.curStyle && this.stack.length === this.styleDepth) {
      const name = this.curStyle.name.replace(/;\s*$/, '').trim()
      if (name) this.styles.set(this.curStyle.num, { name, outline: this.curStyle.outline })
      this.curStyle = null
      this.styleDepth = -1
    }
    const prev = this.stack.pop()
    if (prev) {
      // 段落屬性在 RTF 實務上跨群組保留（Word 會在群組內外都寫 \pard），所以只還原字元屬性與目的地
      this.st = {
        ...prev,
        align: closing.dest === 'normal' && prev.dest === 'normal' ? closing.align : prev.align,
        outline: closing.dest === 'normal' && prev.dest === 'normal' ? closing.outline : prev.outline,
        style: closing.dest === 'normal' && prev.dest === 'normal' ? closing.style : prev.style,
        intbl: closing.dest === 'normal' && prev.dest === 'normal' ? closing.intbl : prev.intbl,
        ls: closing.dest === 'normal' && prev.dest === 'normal' ? closing.ls : prev.ls,
        ilvl: closing.dest === 'normal' && prev.dest === 'normal' ? closing.ilvl : prev.ilvl,
      }
    }
    this.skip = 0
  }

  private control() {
    const s = this.src
    const next = s[this.pos + 1]
    if (next === undefined) {
      this.pos++
      return
    }
    // \'hh
    if (next === "'") {
      const hex = s.substr(this.pos + 2, 2)
      this.pos += 4
      if (this.skip > 0) {
        this.skip--
        return
      }
      this.bytes.push(parseInt(hex, 16))
      return
    }
    // 控制字
    if (/[a-zA-Z]/.test(next)) {
      let j = this.pos + 1
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++
      const word = s.slice(this.pos + 1, j)
      let param: number | null = null
      const m = /^-?\d+/.exec(s.slice(j, j + 12))
      if (m) {
        param = parseInt(m[0], 10)
        j += m[0].length
      }
      if (s[j] === ' ') j++
      this.pos = j
      if (word === 'bin' && param && param > 0) {
        // 二進位資料：直接略過
        this.pos += param
        return
      }
      this.flushBytes()
      this.word(word, param)
      return
    }
    // 控制符號
    this.pos += 2
    switch (next) {
      case '\\':
      case '{':
      case '}':
        this.text(next)
        break
      case '~':
        this.text('\u00a0')
        break
      case '_':
        this.text('‑')
        break
      case '-':
        break
      case '*':
        this.st.star = true
        break
      case '\n':
      case '\r':
        this.flushBytes()
        this.word('par', null)
        break
      case '\t':
        this.text('\t')
        break
      default:
        break
    }
  }

  private codepage(): number {
    const f = this.st.font >= 0 ? this.st.font : this.deff
    const cp = this.fontCp.get(f)
    return cp && cp !== 1252 ? cp : this.ansiCp
  }

  private flushBytes(lookahead = false) {
    if (!this.bytes.length) return
    const cp = this.codepage()
    // 多位元組編碼：結尾若是孤立的前導位元組，下一個 ASCII 字元就是尾位元組（有些寫入器不跳脫尾位元組）
    if (lookahead && isDbcs(cp) && this.pendingLead(cp)) {
      const nextCh = this.src[this.pos]
      if (nextCh && nextCh !== '\\' && nextCh !== '{' && nextCh !== '}' && nextCh.charCodeAt(0) >= 0x40 && nextCh.charCodeAt(0) < 0x7f) {
        this.bytes.push(nextCh.charCodeAt(0))
        this.pos++
      }
    }
    const text = decodeBytes(this.bytes, cp)
    this.bytes = []
    this.emit(text)
  }

  private pendingLead(cp: number): boolean {
    let i = 0
    const b = this.bytes
    let lead = false
    while (i < b.length) {
      if (b[i] >= 0x81 && b[i] <= 0xfe && !(cp === 932 && b[i] >= 0xa1 && b[i] <= 0xdf)) {
        if (i + 1 >= b.length) {
          lead = true
          break
        }
        i += 2
      } else i++
    }
    return lead
  }

  private text(t: string) {
    if (this.bytes.length) this.flushBytes()
    if (this.skip > 0) {
      const n = Math.min(this.skip, t.length)
      this.skip -= n
      t = t.slice(n)
      if (!t) return
    }
    this.emit(t)
  }

  /** 把文字送到目前目的地 */
  private emit(t: string) {
    const st = this.st
    switch (st.dest) {
      case 'skip':
        return
      case 'fonttbl':
        return
      case 'stylesheet':
        if (this.curStyle) this.curStyle.name += t
        return
      case 'pict':
        this.pict?.hex.push(t)
        return
      case 'fldinst':
        if (st.field) st.field.instr += t
        return
      case 'listtext':
        this.listText += t
        return
    }
    if (st.hidden) return
    const last = this.runs[this.runs.length - 1]
    const style = { b: st.b, i: st.i, u: st.u && !st.link, s: st.s, link: st.link, fs: st.fs }
    if (
      last &&
      !!last.b === style.b &&
      !!last.i === style.i &&
      !!last.u === style.u &&
      !!last.s === style.s &&
      last.link === style.link &&
      last.fs === style.fs
    )
      last.text += t
    else
      this.runs.push({
        text: t,
        fs: style.fs,
        ...(style.b && { b: true }),
        ...(style.i && { i: true }),
        ...(style.u && { u: true }),
        ...(style.s && { s: true }),
        ...(style.link && { link: style.link }),
      })
  }

  private word(w: string, param: number | null) {
    const st = this.st
    const on = param === null || param !== 0
    // 群組第一個控制字決定目的地
    if (st.first) {
      st.first = false
      if (st.star && !STAR_KEEP.has(w)) {
        st.dest = 'skip'
        return
      }
      if (SKIP_DESTS.has(w)) {
        st.dest = 'skip'
        return
      }
    }
    if (st.dest === 'skip') return
    switch (w) {
      case 'rtf':
      case 'ansi':
        return
      case 'ansicpg':
        if (param) this.ansiCp = param
        return
      case 'mac':
        this.ansiCp = 10000
        return
      case 'pc':
        this.ansiCp = 437
        return
      case 'pca':
        this.ansiCp = 850
        return
      case 'deff':
        this.deff = param ?? 0
        return
      case 'fonttbl':
        st.dest = 'fonttbl'
        return
      case 'stylesheet':
        st.dest = 'stylesheet'
        return
      case 'pict':
        st.dest = 'pict'
        this.pict = { hex: [], fmt: null, wgoal: 0, hgoal: 0 }
        return
      case 'shppict':
        return
      case 'fldinst':
        st.dest = 'fldinst'
        return
      case 'field':
        st.field = { instr: '' }
        return
      case 'fldrslt': {
        const url = st.field ? parseHyperlink(st.field.instr) : null
        if (url) st.link = url
        return
      }
      case 'listtext':
      case 'pntext':
        st.dest = 'listtext'
        this.listText = ''
        return
    }
    // 字型表：\fN \fcharsetN \cpgN
    if (st.dest === 'fonttbl') {
      if (w === 'f') this.curFont = param ?? 0
      else if (w === 'fcharset' && param !== null) {
        const cp = CHARSET_CP[param]
        if (cp) this.fontCp.set(this.curFont, cp)
      } else if (w === 'cpg' && param) this.fontCp.set(this.curFont, param)
      return
    }
    if (st.dest === 'stylesheet') {
      if (!this.curStyle) return
      if (w === 's') this.curStyle.num = param ?? 0
      else if (w === 'outlinelevel') this.curStyle.outline = param ?? 0
      return
    }
    if (st.dest === 'pict') {
      if (!this.pict) return
      if (w === 'pngblip') this.pict.fmt = 'png'
      else if (w === 'jpegblip') this.pict.fmt = 'jpg'
      else if (w === 'picwgoal') this.pict.wgoal = param ?? 0
      else if (w === 'pichgoal') this.pict.hgoal = param ?? 0
      return
    }
    if (st.dest === 'fldinst' || st.dest === 'listtext') {
      if (w === 'tab' && st.dest === 'listtext') this.listText += '\t'
      return
    }
    switch (w) {
      // 段落
      case 'par':
      case 'sect':
        if (st.intbl && this.row === null) this.row = { cells: [], header: this.rowHeader }
        this.endParagraph()
        return
      case 'page':
        this.endParagraph()
        this.items.push({ k: 'pageBreak' })
        return
      case 'line':
        this.text('\n')
        return
      case 'tab':
        this.text('\t')
        return
      case 'pard':
        st.align = 'left'
        st.outline = null
        st.style = 0
        st.intbl = false
        st.ls = 0
        st.ilvl = 0
        return
      case 'ql':
        st.align = 'left'
        return
      case 'qc':
        st.align = 'center'
        return
      case 'qr':
        st.align = 'right'
        return
      case 'qj':
        st.align = 'justify'
        return
      case 'outlinelevel':
        st.outline = param ?? 0
        return
      case 's':
        st.style = param ?? 0
        return
      case 'ls':
        st.ls = param ?? 0
        return
      case 'ilvl':
        st.ilvl = param ?? 0
        return
      // 表格
      case 'intbl':
        st.intbl = true
        return
      case 'trowd':
        this.rowHeader = false
        return
      case 'trhdr':
        this.rowHeader = true
        return
      case 'cell':
      case 'nestcell':
        this.endCell()
        return
      case 'row':
      case 'nestrow':
        this.endRow()
        return
      // 字元
      case 'plain':
        st.b = st.i = st.u = st.s = st.hidden = false
        st.fs = 24
        st.font = -1
        return
      case 'b':
        st.b = on
        return
      case 'i':
        st.i = on
        return
      case 'ul':
      case 'uld':
      case 'uldb':
      case 'ulw':
      case 'ulth':
      case 'uldash':
      case 'ulwave':
        st.u = on
        return
      case 'ulnone':
        st.u = false
        return
      case 'strike':
      case 'striked':
        st.s = on
        return
      case 'v':
        st.hidden = on
        return
      case 'fs':
        st.fs = param && param > 0 ? param : 24
        return
      case 'f':
        st.font = param ?? 0
        return
      case 'uc':
        st.uc = Math.max(0, param ?? 1)
        return
      case 'u': {
        let cp = param ?? 0
        if (cp < 0) cp += 65536
        this.emit(String.fromCharCode(cp))
        this.skip = st.uc
        return
      }
    }
    const ch = CHAR_WORDS[w]
    if (ch !== undefined) this.text(ch)
  }

  private snapshot(): RawPara {
    const st = this.st
    const style = this.styles.get(st.style)
    return {
      runs: this.runs,
      align: st.align,
      outline: st.outline,
      styleName: style?.name ?? '',
      styleOutline: style?.outline ?? null,
      intbl: st.intbl,
      ls: st.ls,
      ilvl: st.ilvl,
      listText: this.listText.replace(/[\t ]+$/, '').trim(),
    }
  }

  private endParagraph() {
    const p = this.snapshot()
    this.runs = []
    this.listText = ''
    if (p.intbl) {
      this.cell.push(p)
      return
    }
    this.endTable()
    this.items.push({ k: 'para', p })
  }

  private endCell() {
    const p = this.snapshot()
    this.runs = []
    this.listText = ''
    if (p.runs.length || !this.cell.length) this.cell.push(p)
    if (!this.row) this.row = { cells: [], header: this.rowHeader }
    this.row.cells.push(this.cell)
    this.cell = []
  }

  private endRow() {
    if (this.runs.length) this.endCell()
    if (this.row) {
      this.row.header = this.row.header || this.rowHeader
      this.items.push({ k: 'row', r: this.row })
    }
    this.row = null
    this.cell = []
  }

  private endTable() {
    if (this.row && this.row.cells.length) this.items.push({ k: 'row', r: this.row })
    this.row = null
  }

  private finishPict() {
    const pict = this.pict
    this.pict = null
    if (!pict || !pict.fmt) return
    const bytes = hexToBytes(pict.hex.join(''))
    const info = imageInfo(bytes)
    if (!info) return
    // 圖片前的文字先成為一個段落
    if (this.runs.some((r) => r.text.trim())) this.endParagraph()
    this.items.push({
      k: 'image',
      block: {
        type: 'image',
        src: '',
        alt: '',
        data: { bytes, ...info },
        widthHint: pict.wgoal ? pict.wgoal / 20 : undefined,
      },
    })
  }
}

function parseHyperlink(instr: string): string | null {
  const m = /HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(instr) ?? /HYPERLINK\s+(\S+)/i.exec(instr)
  if (!m) return null
  if (/\\l\s+"/i.test(instr)) return null
  return m[1]
}

/* ---------- 段落 → 區塊 ---------- */

const HEADING_STYLE = /^(heading|標題|标题|überschrift|titre)\s*(\d)$/i

function paraText(p: RawPara) {
  return p.runs.map((r) => r.text).join('')
}

function toRuns(p: RawPara, bodyFs: number, keepScale: boolean): Run[] {
  const runs = p.runs.map(({ fs, ...r }) => {
    const scale = fs / bodyFs
    return keepScale && Math.abs(scale - 1) > 0.08 ? { ...r, scale: Math.max(0.6, Math.min(2.4, scale)) } : r
  })
  // 頭尾空白
  const merged = mergeRuns(runs.map((r) => ({ ...r, text: r.text.replace(/\t/g, '    ') })))
  if (merged.length) {
    merged[0].text = merged[0].text.replace(/^[ \u00a0]+/, '')
    merged[merged.length - 1].text = merged[merged.length - 1].text.replace(/\s+$/, '')
  }
  return merged.filter((r) => r.text)
}

function buildBlocks(items: Item[], idPrefix: string): Block[] {
  // 內文字級：依字數加權最常見的 \fs
  const sizeCount = new Map<number, number>()
  for (const it of items) {
    if (it.k !== 'para') continue
    for (const r of it.p.runs) sizeCount.set(r.fs, (sizeCount.get(r.fs) ?? 0) + r.text.length)
  }
  let bodyFs = 24
  let best = -1
  for (const [fs, n] of sizeCount) if (n > best) [bodyFs, best] = [fs, n]

  // 標題候選
  interface Cand {
    idx: number
    level: number | null
    size: number
    bold: boolean
  }
  const cands: Cand[] = []
  let boldShort = 0
  let paraCount = 0
  items.forEach((it, idx) => {
    if (it.k !== 'para' || it.p.ls || it.p.listText) return
    const p = it.p
    const text = paraText(p).trim()
    if (!text) return
    paraCount++
    const styleLevel = HEADING_STYLE.exec(p.styleName)?.[2]
    if (p.outline !== null && p.outline < 9) return cands.push({ idx, level: p.outline + 1, size: 0, bold: false })
    if (p.styleOutline !== null && p.styleOutline < 9) return cands.push({ idx, level: p.styleOutline + 1, size: 0, bold: false })
    if (styleLevel) return cands.push({ idx, level: Number(styleLevel), size: 0, bold: false })
    if (/^title$|^標題$/i.test(p.styleName)) return cands.push({ idx, level: 1, size: 0, bold: false })
    const visible = p.runs.filter((r) => r.text.trim())
    const maxFs = Math.max(...visible.map((r) => r.fs))
    const allBold = visible.every((r) => r.b)
    const short = displayWidth(text) <= 80 && !text.includes('\n') && !SENTENCE_END.test(text) && !/[，,：:]$/.test(text)
    if (!short) return
    if (maxFs >= bodyFs * 1.15) cands.push({ idx, level: null, size: maxFs, bold: allBold })
    else if (allBold) {
      boldShort++
      cands.push({ idx, level: null, size: bodyFs, bold: true })
    }
  })
  // 粗體短段落太多（例如整份都粗體）時不當標題
  const allowBoldOnly = paraCount > 0 && boldShort / paraCount <= 0.35
  const heuristicSizes = [...new Set(cands.filter((c) => c.level === null && c.size > bodyFs).map((c) => c.size))].sort((a, b) => b - a)
  const explicitMax = Math.max(0, ...cands.filter((c) => c.level !== null).map((c) => c.level!))
  const levelByIdx = new Map<number, number>()
  for (const c of cands) {
    if (c.level !== null) levelByIdx.set(c.idx, Math.min(6, c.level))
    else if (c.size > bodyFs) levelByIdx.set(c.idx, Math.min(6, heuristicSizes.indexOf(c.size) + 1))
    else if (allowBoldOnly) levelByIdx.set(c.idx, Math.min(6, Math.max(heuristicSizes.length + 1, explicitMax ? explicitMax + 1 : 1)))
  }

  const slug = createSlugger()
  let hid = 0
  const out: Block[] = []
  let i = 0
  while (i < items.length) {
    const it = items[i]
    if (it.k === 'pageBreak') {
      out.push({ type: 'pageBreak' })
      i++
      continue
    }
    if (it.k === 'image') {
      out.push(it.block)
      i++
      continue
    }
    if (it.k === 'row') {
      const rows: RawRow[] = []
      while (i < items.length && items[i].k === 'row') rows.push((items[i++] as { k: 'row'; r: RawRow }).r)
      out.push(buildTable(rows, bodyFs))
      continue
    }
    const p = it.p
    const idx = i
    if (p.ls || p.listText) {
      const group: RawPara[] = []
      while (i < items.length) {
        const x = items[i]
        if (x.k !== 'para' || !(x.p.ls || x.p.listText)) break
        group.push(x.p)
        i++
      }
      out.push(buildList(group, bodyFs))
      continue
    }
    i++
    const text = paraText(p)
    if (!text.trim()) continue
    const level = levelByIdx.get(idx)
    if (level) {
      // 標題的字級與粗細交給主題
      const runs = mergeRuns(toRuns(p, bodyFs, false).map(({ b: _b, scale: _s, ...r }) => r))
      const plain = runsText(runs).trim()
      out.push({
        type: 'heading',
        level: level as HeadingBlock['level'],
        runs,
        id: `${idPrefix}${hid++}`,
        slug: slug(plain),
        align: p.align === 'center' || p.align === 'right' ? p.align : undefined,
      })
    } else {
      out.push({ type: 'paragraph', runs: toRuns(p, bodyFs, true), align: p.align === 'left' ? undefined : p.align })
    }
  }
  return out
}

function buildTable(rows: RawRow[], bodyFs: number): Block {
  const cells: TableCell[][] = rows.map((r) =>
    r.cells.map((paras) => {
      const runs: Run[] = []
      paras.forEach((p, k) => {
        if (k > 0) runs.push({ text: '\n' })
        runs.push(...toRuns(p, bodyFs, false))
      })
      const al = paras[0]?.align
      return { runs: mergeRuns(runs), align: al && al !== 'left' && al !== 'justify' ? al : undefined }
    }),
  )
  const cols = Math.max(...cells.map((r) => r.length))
  for (const r of cells) while (r.length < cols) r.push({ runs: [] })
  // 表頭：\trhdr，或第一列全部粗體
  let headerRows = 0
  while (headerRows < rows.length - 1 && rows[headerRows].header) headerRows++
  if (!headerRows && rows.length > 1) {
    const first = rows[0].cells.flat().flatMap((p) => p.runs).filter((r) => r.text.trim())
    if (first.length && first.every((r) => r.b)) headerRows = 1
  }
  // 表頭的粗體交給主題處理
  if (headerRows) for (let r = 0; r < headerRows; r++) for (const c of cells[r]) c.runs = c.runs.map(({ b: _b, ...x }) => x)
  return { type: 'table', rows: cells, headerRows, align: new Array(cols).fill(null) }
}

function buildList(paras: RawPara[], bodyFs: number): ListBlock {
  const ordered = (m: string) => /^[(（]?(\d+|[a-zA-Z]|[ivxIVX]+)[.)）、]/.test(m)
  const flat = paras.map((p) => ({ indent: p.ilvl, marker: p.listText, runs: toRuns(p, bodyFs, true) }))
  const build = (from: number, to: number): ListBlock => {
    const base = flat[from]
    const isOrdered = ordered(base.marker)
    const items: ListItem[] = []
    let k = from
    while (k < to) {
      const cur = flat[k]
      let end = k + 1
      while (end < to && flat[end].indent > cur.indent) end++
      const blocks: Block[] = [{ type: 'paragraph', runs: cur.runs }]
      if (end > k + 1) blocks.push(build(k + 1, end))
      // 沒有任何字母、數字的標記（•、Symbol 字型的符號、無法解碼的位元組）一律當項目符號
      const isBullet = !cur.marker || !/[\p{L}\p{N}]/u.test(cur.marker)
      items.push({ task: null, blocks, marker: isBullet ? undefined : cur.marker })
      k = end
    }
    const startNum = parseInt(/\d+/.exec(base.marker)?.[0] ?? '1', 10)
    return { type: 'list', ordered: isOrdered, start: startNum, items }
  }
  return build(0, flat.length)
}
