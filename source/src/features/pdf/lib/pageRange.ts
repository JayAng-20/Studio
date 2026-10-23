/**
 * 頁範圍解析器：語法 `1-3,5,8-`（1 起算）。
 * - 分隔：半形逗號、全形逗號「，」、頓號「、」、分號；分隔符旁可有空白
 * - 範圍：`a-b`、`a-`（到最後一頁）、`-b`（從第 1 頁）；連字號可用 - – — ~ ～ －
 * - 全形數字會自動正規化
 * 錯誤以代碼回傳（由介面翻譯），並附上出錯的片段與位置，讓使用者知道哪裡要改。
 */

export type PageRangeErrorCode =
  | 'empty' // 沒有輸入任何頁碼
  | 'syntax' // 看不懂的片段（例如 "abc"、"1-2-3"）
  | 'zero' // 頁碼從 1 開始
  | 'outOfRange' // 超過總頁數
  | 'reversed' // 起始頁大於結束頁
  | 'emptyItem' // 兩個逗號之間沒有內容（例如 "1,,3"）
  | 'noPages' // 文件沒有任何頁面

export interface PageRangeError {
  code: PageRangeErrorCode
  /** 出錯的片段（原文） */
  token?: string
  /** 片段在原字串中的起始位置 */
  index?: number
  /** 總頁數（outOfRange 時提供） */
  max?: number
}

/** 一個範圍（1 起算，含頭尾） */
export interface PageSpan {
  start: number
  end: number
}

export type PageRangeResult =
  { ok: true; spans: PageSpan[]; pages: number[] } | { ok: false; error: PageRangeError }

const DASH = /[-–—~～－‐]/
const SEP = /[,，、;；]/

/** 全形轉半形（數字、連字號、逗號） */
function normalize(s: string): string {
  return s.normalize('NFKC')
}

/**
 * 解析頁範圍。pages 依輸入順序展開（可能重複，由呼叫端決定是否去重）；
 * spans 保留每個以逗號分隔的群組，用於「每個範圍一份」的分割。
 */
export function parsePageRange(input: string, pageCount: number): PageRangeResult {
  if (!Number.isInteger(pageCount) || pageCount < 1)
    return { ok: false, error: { code: 'noPages' } }
  const raw = input ?? ''
  if (!raw.trim()) return { ok: false, error: { code: 'empty' } }

  // 以原字串切分，保留每個片段的位置（正規化不改變長度以外的情況，用正規化後字串切分即可）
  const text = normalize(raw)
  const spans: PageSpan[] = []
  let cursor = 0
  const parts: Array<{ token: string; index: number }> = []
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || SEP.test(text[i])) {
      parts.push({ token: text.slice(cursor, i), index: cursor })
      cursor = i + 1
    }
  }
  // 允許結尾多一個逗號（"1-3,"），但不允許中間空項目
  if (parts.length > 1 && !parts[parts.length - 1].token.trim()) parts.pop()

  for (const { token, index } of parts) {
    const trimmed = token.trim()
    const at = index + (token.length - token.trimStart().length)
    if (!trimmed) return { ok: false, error: { code: 'emptyItem', index } }
    const span = parseToken(trimmed, pageCount)
    if ('code' in span) return { ok: false, error: { ...span, token: trimmed, index: at } }
    spans.push(span)
  }
  const pages: number[] = []
  for (const s of spans) for (let p = s.start; p <= s.end; p++) pages.push(p)
  return { ok: true, spans, pages }
}

function parseToken(
  token: string,
  pageCount: number,
): PageSpan | { code: PageRangeErrorCode; max?: number } {
  const compact = token.replace(/\s+/g, '')
  // 單一頁碼
  if (/^\d+$/.test(compact)) {
    const n = Number(compact)
    return checkPage(n, pageCount) ?? { start: n, end: n }
  }
  const m = compact.match(new RegExp(`^(\\d*)${DASH.source}(\\d*)$`))
  if (!m) return { code: 'syntax' }
  const [, a, b] = m
  if (!a && !b) return { code: 'syntax' }
  const start = a ? Number(a) : 1
  const end = b ? Number(b) : pageCount
  const e1 = checkPage(start, pageCount)
  if (e1) return e1
  const e2 = checkPage(end, pageCount)
  if (e2) return e2
  if (start > end) return { code: 'reversed' }
  return { start, end }
}

function checkPage(n: number, pageCount: number) {
  if (!Number.isSafeInteger(n)) return { code: 'outOfRange' as const, max: pageCount }
  if (n < 1) return { code: 'zero' as const }
  if (n > pageCount) return { code: 'outOfRange' as const, max: pageCount }
  return null
}

/**
 * 把頁碼清單壓縮成範圍字串：[1,2,3,5,8,9,10] → "1-3,5,8-10"。
 * 依輸入順序壓縮連續遞增的段落（不排序，保留使用者的順序）。
 */
export function formatPageRange(pages: number[]): string {
  const out: string[] = []
  let i = 0
  while (i < pages.length) {
    let j = i
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++
    out.push(j > i ? `${pages[i]}-${pages[j]}` : String(pages[i]))
    i = j + 1
  }
  return out.join(',')
}

/** 每 N 頁一組（最後一組可能不足 N 頁） */
export function chunkPages(pageCount: number, size: number): PageSpan[] {
  const n = Math.max(1, Math.floor(size))
  const out: PageSpan[] = []
  for (let s = 1; s <= pageCount; s += n)
    out.push({ start: s, end: Math.min(pageCount, s + n - 1) })
  return out
}

/** 範圍 → 0 起算頁碼 */
export const spanToIndices = (s: PageSpan) =>
  Array.from({ length: s.end - s.start + 1 }, (_, i) => s.start - 1 + i)
