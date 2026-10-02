/**
 * 等寬排版（程式碼區塊、「保持原樣」的純文字）：以格為單位，中日韓字佔兩格，
 * 英數用 Courier（剛好 0.6 em），其他字退回思源黑體並置中在自己的格子裡，讓對齊永遠正確。
 * 過長的行自動換行，續行縮排到原本行首的空白位置。
 */
import { MISSING_GLYPH, type FontKey, type Measurer } from './fonts'
import type { LineBox, PlacedPiece } from './linebreak'
import { isWide } from './text'

/** 等寬格寬（em）：中日韓字剛好兩格（1 em）；Courier 原寬 0.6 em，以水平縮放 83.3% 放進格子 */
export const MONO_ADVANCE = 0.5
export const COURIER_ADVANCE = 0.6
export const MONO_SQUEEZE = (MONO_ADVANCE / COURIER_ADVANCE) * 100

export interface MonoOptions {
  size: number
  width: number
  style: number
  bold?: boolean
  tabSize?: number
}

export function layoutMono(
  text: string,
  m: Measurer,
  o: MonoOptions,
): { lines: LineBox[]; missing: number } {
  const cw = MONO_ADVANCE * o.size
  const maxCols = Math.max(8, Math.floor(o.width / cw + 1e-6))
  const tab = o.tabSize ?? 4
  const mono: FontKey = o.bold ? 'monoBold' : 'mono'
  const fallback: FontKey = o.bold ? 'sansBold' : 'sans'
  const lines: LineBox[] = []
  let missing = 0
  for (const rawLine of text.split('\n')) {
    // 展開 Tab
    let line = ''
    let col = 0
    for (const ch of rawLine.replace(/\r$/, '')) {
      if (ch === '\t') {
        const n = tab - (col % tab)
        line += ' '.repeat(n)
        col += n
      } else {
        line += ch
        col += isWide(ch.codePointAt(0)!) ? 2 : 1
      }
    }
    const lead = /^ */.exec(line)![0].length
    const hang = Math.min(lead, Math.floor(maxCols / 3))
    let pieces: PlacedPiece[] = []
    col = 0
    let startCol = 0
    const flush = (hard: boolean) => {
      lines.push({ pieces, width: col * cw, size: o.size, hard })
      pieces = []
    }
    for (const ch of line) {
      const cp = ch.codePointAt(0)!
      const cells = isWide(cp) ? 2 : 1
      if (col + cells > maxCols && col > startCol) {
        flush(false)
        // 續行：縮排到原行首空白
        col = hang
        startCol = hang
      }
      const x = col * cw
      if (cells === 1 && m.has(mono, cp)) {
        const last = pieces[pieces.length - 1]
        if (last && last.font === mono && Math.abs(last.x + last.width - x) < 0.01) {
          last.text += ch
          last.width += cw
        } else
          pieces.push({
            text: ch,
            font: mono,
            size: o.size,
            skew: false,
            style: o.style,
            width: cw,
            x,
            hs: MONO_SQUEEZE,
          })
      } else {
        let t = ch
        if (!m.has(fallback, cp)) {
          if ((cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d || cp === 0x200b || cp === 0xfeff)
            continue
          missing++
          t = MISSING_GLYPH
        }
        const gw = m.advance(fallback, t) * o.size
        const slot = cells * cw
        // 字太寬時縮小以免壓到隔壁格
        const size = gw > slot ? (o.size * slot) / gw : o.size
        const w = Math.min(gw, slot)
        pieces.push({
          text: t,
          font: fallback,
          size,
          skew: false,
          style: o.style,
          width: w,
          x: x + (slot - w) / 2,
        })
      }
      col += cells
    }
    flush(true)
  }
  return { lines, missing }
}
