/** 批次產生：解析多行文字或 CSV 成「內容＋檔名」清單 */

/** RFC 4180 CSV 解析：支援引號、引號內逗號與換行、"" 跳脫；自動判斷逗號／分號／tab 分隔 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const delim = delimiter ?? detectDelimiter(src)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"' && cell === '') quoted = true
    else if (c === delim) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length - 1] as const)
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

export interface BatchEntry {
  content: string
  /** 使用者指定的檔名（不含副檔名）；空字串表示自動命名 */
  name: string
}

/** 多行文字：一行一筆，空行略過 */
export function parseLines(text: string): BatchEntry[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((content) => ({ content, name: '' }))
}

/**
 * CSV：第一欄是內容，第二欄（可省略）是檔名。
 * header=true 時略過第一列；也會自動略過看起來像標題的第一列（content／內容／url…）。
 */
export function parseCsvEntries(text: string, header = false): BatchEntry[] {
  const rows = parseCsv(text)
  const looksLikeHeader = (r: string[] | undefined) =>
    !!r && /^(content|text|data|url|link|內容|文字|網址|資料)$/i.test((r[0] ?? '').trim())
  const start = header || looksLikeHeader(rows[0]) ? 1 : 0
  return rows
    .slice(start)
    .map((r) => ({ content: (r[0] ?? '').trim(), name: (r[1] ?? '').trim() }))
    .filter((e) => e.content)
}

/** 自動檔名：序號＋內容摘要（去掉協定與不安全字元） */
export function batchFileStem(entry: BatchEntry, index: number, total: number): string {
  const width = Math.max(3, String(total).length)
  const no = String(index + 1).padStart(width, '0')
  if (entry.name) return entry.name
  const slug = entry.content
    .replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, '')
    .replace(/[\s/\\?%*:|"<>.,;=#&]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug ? `qr_${no}_${slug}` : `qr_${no}`
}
