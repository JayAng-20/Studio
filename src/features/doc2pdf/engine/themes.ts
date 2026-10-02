/**
 * 排版主題：三套真的不同的樣式（字體搭配、標題處理、表格樣式、段落對齊、配色）。
 * 顏色用 0–1 的 RGB，直接給 pdf-lib。
 */

export type RGB = readonly [number, number, number]

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export type ThemeId = 'clean' | 'academic' | 'modern'
export type Family = 'sans' | 'serif'
export type TableStyle = 'grid' | 'booktabs' | 'band'

export interface Theme {
  id: ThemeId
  /** 內文字體（serif：拉丁字用 Times，中文仍用思源黑體） */
  body: Family
  heading: Family
  /** H1–H6 相對內文的字級倍率 */
  headingScale: [number, number, number, number, number, number]
  /** 標題下方細線（依層級） */
  headingRule: [boolean, boolean, boolean, boolean, boolean, boolean]
  /** H1 置中 */
  h1Center: boolean
  /** 標題自動編號（1、1.1、1.1.1） */
  numbering: boolean
  /** H1 前的彩色色塊（現代主題） */
  h1Band: boolean
  justify: boolean
  /** 中文段落首行縮排兩字 */
  cjkIndent: boolean
  /** 段落間距（倍率 × 內文字級） */
  paraGap: number
  table: TableStyle
  colors: {
    text: RGB
    muted: RGB
    heading: RGB
    accent: RGB
    link: RGB
    rule: RGB
    codeBg: RGB
    codeBorder: RGB | null
    inlineCodeBg: RGB
    quoteBar: RGB
    quoteText: RGB
    tableBorder: RGB
    tableHeaderBg: RGB | null
    tableHeaderText: RGB
    tableStripe: RGB | null
    placeholderBg: RGB
  }
}

export const THEMES: Record<ThemeId, Theme> = {
  clean: {
    id: 'clean',
    body: 'sans',
    heading: 'sans',
    headingScale: [2.0, 1.55, 1.28, 1.12, 1.0, 0.92],
    headingRule: [true, true, false, false, false, false],
    h1Center: false,
    numbering: false,
    h1Band: false,
    justify: false,
    cjkIndent: false,
    paraGap: 0.75,
    table: 'grid',
    colors: {
      text: hex('#1f2430'),
      muted: hex('#5b6474'),
      heading: hex('#111827'),
      accent: hex('#2f6bea'),
      link: hex('#1d5fd8'),
      rule: hex('#d9dde5'),
      codeBg: hex('#f4f6f9'),
      codeBorder: hex('#e3e7ee'),
      inlineCodeBg: hex('#eef1f5'),
      quoteBar: hex('#c9d3e3'),
      quoteText: hex('#4b5568'),
      tableBorder: hex('#cfd5df'),
      tableHeaderBg: hex('#f0f3f7'),
      tableHeaderText: hex('#111827'),
      tableStripe: null,
      placeholderBg: hex('#f6f7f9'),
    },
  },
  academic: {
    id: 'academic',
    body: 'serif',
    heading: 'serif',
    headingScale: [1.7, 1.35, 1.17, 1.05, 1.0, 1.0],
    headingRule: [false, false, false, false, false, false],
    h1Center: true,
    numbering: true,
    h1Band: false,
    justify: true,
    cjkIndent: true,
    paraGap: 0.45,
    table: 'booktabs',
    colors: {
      text: hex('#111111'),
      muted: hex('#555555'),
      heading: hex('#000000'),
      accent: hex('#7a1f1f'),
      link: hex('#1a3f8f'),
      rule: hex('#222222'),
      codeBg: hex('#f5f5f2'),
      codeBorder: hex('#dcdcd4'),
      inlineCodeBg: hex('#efefea'),
      quoteBar: hex('#9a9a92'),
      quoteText: hex('#3a3a3a'),
      tableBorder: hex('#222222'),
      tableHeaderBg: null,
      tableHeaderText: hex('#000000'),
      tableStripe: null,
      placeholderBg: hex('#f5f5f2'),
    },
  },
  modern: {
    id: 'modern',
    body: 'sans',
    heading: 'sans',
    headingScale: [2.2, 1.6, 1.3, 1.12, 1.0, 0.92],
    headingRule: [false, false, false, false, false, false],
    h1Center: false,
    numbering: false,
    h1Band: true,
    justify: false,
    cjkIndent: false,
    paraGap: 0.85,
    table: 'band',
    colors: {
      text: hex('#22262e'),
      muted: hex('#667085'),
      heading: hex('#c2410c'),
      accent: hex('#ea580c'),
      link: hex('#c2410c'),
      rule: hex('#f1d5c4'),
      codeBg: hex('#1f2430'),
      codeBorder: null,
      inlineCodeBg: hex('#fbeee6'),
      quoteBar: hex('#f08a4b'),
      quoteText: hex('#4b5568'),
      tableBorder: hex('#e6e8ec'),
      tableHeaderBg: hex('#ea580c'),
      tableHeaderText: hex('#ffffff'),
      tableStripe: hex('#fbf7f4'),
      placeholderBg: hex('#fbf7f4'),
    },
  },
}

/** 深色程式碼區塊用淺色文字 */
export const codeTextColor = (t: Theme): RGB => (t.colors.codeBg[0] < 0.4 ? hex('#e6e8ee') : t.colors.text)
export const codeMutedColor = (t: Theme): RGB => (t.colors.codeBg[0] < 0.4 ? hex('#9aa3b5') : t.colors.muted)
