/** 頁碼文字格式與編號計畫（純函式，可單元測試） */

export type PageNumberFormat = 'plain' | 'slash' | 'zh' | 'en'

export const PAGE_NUMBER_FORMATS: PageNumberFormat[] = ['plain', 'slash', 'zh', 'en']

/** 依格式產生頁碼文字：1、1 / N、第 1 頁、Page 1 */
export function formatPageNumber(format: PageNumberFormat, n: number, total: number): string {
  switch (format) {
    case 'plain':
      return String(n)
    case 'slash':
      return `${n} / ${total}`
    case 'zh':
      return `第 ${n} 頁`
    case 'en':
      return `Page ${n}`
  }
}

export interface NumberingOptions {
  /** 起始值（第一個被編號的頁面顯示的數字） */
  start: number
  /** 首頁不編號（封面） */
  skipFirst: boolean
}

/**
 * 每一頁要顯示的頁碼（null 表示不編號）。
 * 總數 N = 起始值 + 被編號的頁數 − 1，讓「1 / N」的 N 與最後一頁的數字一致。
 */
export function numberingPlan(pageCount: number, opts: NumberingOptions): Array<number | null> {
  const start = Number.isFinite(opts.start) ? Math.floor(opts.start) : 1
  return Array.from({ length: pageCount }, (_, i) => {
    if (opts.skipFirst && i === 0) return null
    return start + i - (opts.skipFirst ? 1 : 0)
  })
}

/** 「1 / N」中的 N */
export function numberingTotal(pageCount: number, opts: NumberingOptions): number {
  const numbered = opts.skipFirst ? Math.max(0, pageCount - 1) : pageCount
  return Math.floor(opts.start) + numbered - 1
}

/** 產生每一頁的頁碼文字（null 表示不編號） */
export function pageNumberLabels(
  pageCount: number,
  format: PageNumberFormat,
  opts: NumberingOptions,
): Array<string | null> {
  const total = numberingTotal(pageCount, opts)
  return numberingPlan(pageCount, opts).map((n) =>
    n === null ? null : formatPageNumber(format, n, total),
  )
}
