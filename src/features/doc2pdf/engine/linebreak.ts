/**
 * 斷行引擎：
 * - 中日韓文字逐字可斷；拉丁文以單字為單位，在空白處斷行；超過一行寬的長字（網址）逐字切開。
 * - 避頭尾：「，。、；：？！）」』》〉」等不可在行首（黏到前一個字），「（「『《〈」等不可在行尾（黏到後一個字）。
 * - 依字元選字型（主要字型不支援時退回思源黑體），量測寬度後貪婪填行；可左右對齊。
 */
import { chooseFont, MISSING_GLYPH, type FontFamily, type FontKey, type Measurer } from './fonts'
import { NO_LINE_END, NO_LINE_START, isCJK } from './text'
import type { RGB } from './themes'

export interface TextStyle {
  family: FontFamily
  bold: boolean
  italic: boolean
  size: number
  color: RGB
  underline?: boolean
  strike?: boolean
  /** 行內程式碼底色 */
  codeBg?: RGB
  /** 外部連結（URI）或文件內目的地（標題 id） */
  uri?: string
  dest?: string
}

export interface Span {
  text: string
  style: number
}

export interface Piece {
  text: string
  /** 水平縮放（%）：等寬程式碼的 Courier 用 */
  hs?: number
  font: FontKey
  size: number
  skew: boolean
  style: number
  width: number
}

export interface PlacedPiece extends Piece {
  x: number
}

export interface LineBox {
  pieces: PlacedPiece[]
  /** 內容寬度（不含行尾空白） */
  width: number
  /** 這行最大的字級（決定行高） */
  size: number
  /** 以硬換行結束 */
  hard: boolean
}

interface Ch {
  ch: string
  style: number
}

interface Atom {
  kind: 'word' | 'cjk' | 'space' | 'break'
  chars: Ch[]
  pieces: Piece[]
  width: number
}

export interface BreakOptions {
  width: number
  /** 第一行的可用寬度（首行縮排） */
  firstWidth?: number
  justify?: boolean
}

export interface BreakResult {
  lines: LineBox[]
  /** 無法顯示、以 □ 代替的字數 */
  missing: number
}

const EPS = 0.01

/** 行內程式碼左右的留白字元（私用區），寬度 PAD_EM 倍字級，不輸出 */
export const PAD = '\ue000'
export const PAD_EM = 0.24

export class LineBreaker {
  missing = 0
  private measurer: Measurer
  private styles: TextStyle[]
  constructor(measurer: Measurer, styles: TextStyle[]) {
    this.measurer = measurer
    this.styles = styles
  }

  /** 拆成斷行單位（含避頭尾黏合） */
  atomize(spans: Span[]): Atom[] {
    const atoms: Atom[] = []
    let cur: Atom | null = null
    let glueNext = false
    const close = () => {
      if (cur) atoms.push(cur)
      cur = null
    }
    for (const span of spans) {
      const list = Array.from(span.text)
      for (let k = 0; k < list.length; k++) {
        const raw = list[k]
        const c: Ch = { ch: raw, style: span.style }
        if (raw === '\r') continue
        if (raw === '\n') {
          close()
          glueNext = false
          atoms.push({ kind: 'break', chars: [], pieces: [], width: 0 })
          continue
        }
        if (raw === ' ' || raw === '\t') {
          close()
          glueNext = false
          const last = atoms[atoms.length - 1]
          // 連續空白合併成一個（Tab 視為兩個空白）
          if (last?.kind === 'space') {
            if (raw === '\t') last.chars.push({ ch: ' ', style: span.style })
            continue
          }
          atoms.push({
            kind: 'space',
            chars: raw === '\t' ? [{ ch: ' ', style: span.style }, { ch: ' ', style: span.style }] : [c],
            pieces: [],
            width: 0,
          })
          continue
        }
        const cp = raw.codePointAt(0)!
        if (raw === PAD) {
          // 行內程式碼的留白：開頭的黏到後一個字、結尾的黏到前一個字
          if (k === 0) {
            close()
            cur = { kind: 'word', chars: [c], pieces: [], width: 0 }
            glueNext = true
          } else if (cur) (cur as Atom).chars.push(c)
          else {
            const last = atoms[atoms.length - 1]
            if (last && (last.kind === 'word' || last.kind === 'cjk')) last.chars.push(c)
            else atoms.push({ kind: 'word', chars: [c], pieces: [], width: 0 })
          }
          continue
        }
        if (glueNext && cur) {
          ;(cur as Atom).chars.push(c)
          glueNext = NO_LINE_END.has(raw)
          if (!glueNext && isCJK(cp)) {
            ;(cur as Atom).kind = 'cjk'
            close()
          }
          continue
        }
        if (NO_LINE_START.has(raw)) {
          if (cur) {
            ;(cur as Atom).chars.push(c)
          } else {
            const last = atoms[atoms.length - 1]
            if (last && (last.kind === 'word' || last.kind === 'cjk')) last.chars.push(c)
            else atoms.push({ kind: isCJK(cp) ? 'cjk' : 'word', chars: [c], pieces: [], width: 0 })
          }
          continue
        }
        if (NO_LINE_END.has(raw)) {
          close()
          cur = { kind: 'word', chars: [c], pieces: [], width: 0 }
          glueNext = true
          continue
        }
        if (isCJK(cp) || raw === '\u3000') {
          close()
          atoms.push({ kind: 'cjk', chars: [c], pieces: [], width: 0 })
          continue
        }
        if (cur && (cur as Atom).kind === 'word') (cur as Atom).chars.push(c)
        else {
          close()
          cur = { kind: 'word', chars: [c], pieces: [], width: 0 }
        }
      }
    }
    close()
    for (const a of atoms) this.measureAtom(a)
    return atoms
  }

  /** 依字元選字型、合併成片段並量寬 */
  private measureAtom(a: Atom) {
    a.pieces = this.piecesOf(a.chars)
    a.width = a.pieces.reduce((s, p) => s + p.width, 0)
  }

  piecesOf(chars: Ch[]): Piece[] {
    const out: Piece[] = []
    const m = this.measurer
    for (const { ch, style } of chars) {
      const st = this.styles[style]
      const choice = chooseFont(st.family, st.bold, st.italic)
      const cp = ch.codePointAt(0)!
      let font: FontKey
      let skew: boolean
      let text = ch
      let w: number | undefined
      if (ch === PAD) {
        // 行內程式碼左右留白：只佔寬度、不輸出文字
        font = choice.primary
        skew = false
        w = PAD_EM * st.size
      } else if (m.has(choice.primary, cp)) {
        font = choice.primary
        skew = choice.skewPrimary
      } else {
        font = choice.fallback
        skew = choice.skewFallback
        if (!m.has(font, cp)) {
          // 變體選擇符、零寬字元直接略過；其他以 □ 代替
          if ((cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d || cp === 0x200b || cp === 0xfeff) continue
          this.missing++
          text = MISSING_GLYPH
        }
      }
      w ??= m.advance(font, text) * st.size
      const last = out[out.length - 1]
      if (last && last.font === font && last.size === st.size && last.skew === skew && last.style === style) {
        last.text += text
        last.width += w
      } else out.push({ text, font, size: st.size, skew, style, width: w })
    }
    return out
  }

  /** 最小寬度（最寬的不可斷單位）與自然寬度（不斷行時最長一行），表格欄寬計算用 */
  measure(spans: Span[]): { min: number; max: number } {
    const atoms = this.atomize(spans)
    let min = 0
    let max = 0
    let line = 0
    for (const a of atoms) {
      if (a.kind === 'break') {
        max = Math.max(max, line)
        line = 0
        continue
      }
      if (a.kind !== 'space') min = Math.max(min, a.width)
      line += a.width
    }
    max = Math.max(max, line)
    return { min, max }
  }

  break(spans: Span[], opts: BreakOptions): BreakResult {
    const before = this.missing
    const atoms = this.atomize(spans)
    const lines = this.fill(atoms, opts)
    return { lines, missing: this.missing - before }
  }

  private fill(atoms: Atom[], opts: BreakOptions): LineBox[] {
    const lines: LineBox[] = []
    let cur: Atom[] = []
    let w = 0
    let avail = opts.firstWidth ?? opts.width
    const finish = (hard: boolean) => {
      while (cur.length && cur[cur.length - 1].kind === 'space') {
        w -= cur[cur.length - 1].width
        cur.pop()
      }
      lines.push(this.place(cur, w, avail, hard, opts.justify ?? false))
      cur = []
      w = 0
      avail = opts.width
    }
    for (const a of atoms) {
      if (a.kind === 'break') {
        finish(true)
        continue
      }
      if (a.kind === 'space') {
        if (!cur.length) continue
        cur.push(a)
        w += a.width
        continue
      }
      if (w + a.width <= avail + EPS) {
        cur.push(a)
        w += a.width
        continue
      }
      if (cur.some((x) => x.kind !== 'space')) finish(false)
      else {
        cur = []
        w = 0
      }
      if (a.width <= avail + EPS) {
        cur.push(a)
        w = a.width
        continue
      }
      // 超長單位：逐字切開
      for (const chunk of this.splitAtom(a, avail)) {
        if (w + chunk.width > avail + EPS && cur.length) finish(false)
        cur.push(chunk)
        w += chunk.width
      }
    }
    if (cur.length || !lines.length) finish(true)
    // 最後一行視為硬換行（不左右對齊）
    lines[lines.length - 1].hard = true
    return lines
  }

  private splitAtom(a: Atom, avail: number): Atom[] {
    const out: Atom[] = []
    let chars: Ch[] = []
    let widths: number[] = []
    let width = 0
    for (const c of a.chars) {
      const p = this.piecesOf([c])
      const cw = p.reduce((s, x) => s + x.width, 0)
      if (width + cw > avail + EPS && chars.length) {
        // 網址、路徑：優先在 / - _ ? & = . 之後斷開（位置在後半段才採用）
        let cut = chars.length
        for (let k = chars.length - 1; k >= chars.length * 0.5; k--) {
          if ('/-_?&=.#'.includes(chars[k].ch)) {
            cut = k + 1
            break
          }
        }
        // 避頭尾：切點不能讓下一段以句讀開頭、或這一段以開括號結尾
        let ok = cut
        const nextCh = (k: number) => (k < chars.length ? chars[k].ch : c.ch)
        while (ok > 0 && (NO_LINE_START.has(nextCh(ok)) || NO_LINE_END.has(chars[ok - 1].ch))) ok--
        if (ok === 0) {
          // 找不到合法切點：標點懸掛（允許稍微超出行寬），否則只好照原位置切
          if (width + cw <= avail + cw * 2) {
            chars.push(c)
            widths.push(cw)
            width += cw
            continue
          }
        } else cut = ok
        out.push(this.atomOf(chars.slice(0, cut)))
        chars = chars.slice(cut)
        widths = widths.slice(cut)
        width = widths.reduce((s, v) => s + v, 0)
      }
      chars.push(c)
      widths.push(cw)
      width += cw
    }
    if (chars.length) out.push(this.atomOf(chars))
    return out
  }

  private atomOf(chars: Ch[]): Atom {
    const a: Atom = { kind: 'word', chars, pieces: [], width: 0 }
    this.measureAtom(a)
    return a
  }

  private place(atoms: Atom[], width: number, avail: number, hard: boolean, justify: boolean): LineBox {
    const pieces: PlacedPiece[] = []
    let size = 0
    for (const a of atoms) for (const p of a.pieces) size = Math.max(size, p.size)
    // 左右對齊：把剩餘寬度平均分到單位之間（剩太多時不對齊，避免字距過大）
    let gap = 0
    if (justify && !hard && atoms.length > 1) {
      const extra = avail - width
      if (extra > 0 && extra < avail * 0.2) gap = extra / (atoms.length - 1)
    }
    let x = 0
    for (let i = 0; i < atoms.length; i++) {
      const a = atoms[i]
      for (const p of a.pieces) {
        const last = pieces[pieces.length - 1]
        // 沒有額外間距時，相鄰同樣式的片段合併（PDF 內文字較完整，複製時也比較好）
        if (
          gap === 0 &&
          last &&
          last.font === p.font &&
          last.size === p.size &&
          last.skew === p.skew &&
          last.style === p.style &&
          Math.abs(last.x + last.width - x) < EPS
        ) {
          last.text += p.text
          last.width += p.width
        } else pieces.push({ ...p, x })
        x += p.width
      }
      if (i < atoms.length - 1) x += gap
    }
    return { pieces, width: gap ? avail : width, size, hard }
  }
}
