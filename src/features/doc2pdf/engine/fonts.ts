/**
 * 字型與量測：
 * - 中文與一般文字：思源黑體（Noto Sans TC）400／700，嵌入時只取用到的字（子集）。
 * - 程式碼：PDF 標準字型 Courier（只支援 WinAnsi），遇到其他字逐字退回思源黑體。
 * - 學術主題的拉丁字：Times（有真正的斜體）；中文仍用思源黑體。
 * - 斜體：思源黑體沒有斜體，用傾斜矩陣模擬。
 */
import { StandardFontEmbedder, StandardFonts } from 'pdf-lib'

export type FontKey =
  | 'sans'
  | 'sansBold'
  | 'serif'
  | 'serifBold'
  | 'serifItalic'
  | 'serifBoldItalic'
  | 'mono'
  | 'monoBold'

export const STANDARD_FONT: Partial<Record<FontKey, StandardFonts>> = {
  serif: StandardFonts.TimesRoman,
  serifBold: StandardFonts.TimesRomanBold,
  serifItalic: StandardFonts.TimesRomanItalic,
  serifBoldItalic: StandardFonts.TimesRomanBoldItalic,
  mono: StandardFonts.Courier,
  monoBold: StandardFonts.CourierBold,
}

/** 排版引擎需要的量測介面（測試可以換成假的） */
export interface Measurer {
  /** 單一字元在 1 pt 字級下的前進寬度（pt） */
  advance(font: FontKey, ch: string): number
  /** 字型是否能畫出這個字 */
  has(font: FontKey, cp: number): boolean
}

/** 用到的 fontkit 介面（避免依賴完整型別） */
export interface GlyphSource {
  unitsPerEm: number
  glyphForCodePoint(cp: number): { advanceWidth: number; id: number }
  hasGlyphForCodePoint(cp: number): boolean
}

export function createMeasurer(regular: GlyphSource, bold: GlyphSource): Measurer {
  const caches = new Map<FontKey, Map<string, number>>()
  const std = new Map<FontKey, StandardFontEmbedder>()
  const stdFor = (k: FontKey) => {
    let e = std.get(k)
    if (!e) {
      e = StandardFontEmbedder.for(STANDARD_FONT[k]! as unknown as Parameters<typeof StandardFontEmbedder.for>[0])
      std.set(k, e)
    }
    return e
  }
  const noto = (k: FontKey) => (k === 'sansBold' ? bold : regular)
  return {
    advance(font, ch) {
      let c = caches.get(font)
      if (!c) {
        c = new Map()
        caches.set(font, c)
      }
      let w = c.get(ch)
      if (w === undefined) {
        if (STANDARD_FONT[font]) {
          const e = stdFor(font)
          w = e.encoding.canEncodeUnicodeCodePoint(ch.codePointAt(0)!) ? e.widthOfTextAtSize(ch, 1) : 0
        } else {
          const f = noto(font)
          w = f.glyphForCodePoint(ch.codePointAt(0)!).advanceWidth / f.unitsPerEm
        }
        c.set(ch, w)
      }
      return w
    },
    has(font, cp) {
      if (STANDARD_FONT[font]) {
        // 控制字元與 C1 範圍不畫
        if (cp < 0x20) return false
        return stdFor(font).encoding.canEncodeUnicodeCodePoint(cp)
      }
      return noto(font).hasGlyphForCodePoint(cp)
    },
  }
}

export type FontFamily = 'sans' | 'serif' | 'mono'

export interface FontChoice {
  primary: FontKey
  fallback: FontKey
  /** 用傾斜矩陣模擬斜體（思源黑體沒有斜體） */
  skewPrimary: boolean
  skewFallback: boolean
}

/** 依字體家族、粗細、斜體選出主要字型與退回字型 */
export function chooseFont(family: FontFamily, bold: boolean, italic: boolean): FontChoice {
  const sans: FontKey = bold ? 'sansBold' : 'sans'
  if (family === 'serif') {
    const primary: FontKey = bold ? (italic ? 'serifBoldItalic' : 'serifBold') : italic ? 'serifItalic' : 'serif'
    return { primary, fallback: sans, skewPrimary: false, skewFallback: italic }
  }
  if (family === 'mono') {
    return { primary: bold ? 'monoBold' : 'mono', fallback: sans, skewPrimary: italic, skewFallback: italic }
  }
  return { primary: sans, fallback: sans, skewPrimary: italic, skewFallback: italic }
}

/** 沒有任何字型能畫的字（例如表情符號）改成這個 */
export const MISSING_GLYPH = '□'
