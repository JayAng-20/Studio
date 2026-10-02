/**
 * 目標檔案大小：以二分搜尋找出「大小不超過目標」的最高品質（純函式，編碼器由呼叫端提供）。
 * 品質以整數 1 到 100 搜尋，避免重複編碼幾乎一樣的值；編碼結果不保證單調，
 * 所以全程記住「符合目標的最佳結果」與「最小的結果」。
 */

export interface QualitySearchResult<T> {
  /** 1 到 100 */
  quality: number
  size: number
  result: T
  /** 是否達成目標（否則回傳能做到的最小結果） */
  reached: boolean
  /** 實際編碼次數 */
  attempts: number
}

export interface QualitySearchOptions {
  min?: number
  max?: number
  /** 最多編碼次數（含頭尾兩次） */
  maxAttempts?: number
  signal?: AbortSignal
}

export async function searchQuality<T>(
  encode: (quality: number) => Promise<T>,
  sizeOf: (r: T) => number,
  targetBytes: number,
  opts: QualitySearchOptions = {},
): Promise<QualitySearchResult<T>> {
  const min = Math.max(1, Math.round(opts.min ?? 5))
  const max = Math.min(100, Math.round(opts.max ?? 95))
  const maxAttempts = opts.maxAttempts ?? 9
  const cache = new Map<number, T>()
  let attempts = 0
  const run = async (q: number) => {
    const hit = cache.get(q)
    if (hit !== undefined) return hit
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    attempts++
    const r = await encode(q)
    cache.set(q, r)
    return r
  }

  let best: { q: number; r: T } | null = null
  let smallest: { q: number; r: T } | null = null
  const consider = (q: number, r: T) => {
    const s = sizeOf(r)
    if (!smallest || s < sizeOf(smallest.r)) smallest = { q, r }
    if (s <= targetBytes && (!best || q > best.q)) best = { q, r }
    return s
  }

  // 最高品質就符合：直接用
  const top = await run(max)
  if (consider(max, top) <= targetBytes) {
    return { quality: max, size: sizeOf(top), result: top, reached: true, attempts }
  }
  // 最低品質仍然太大：做不到
  const bottom = await run(min)
  if (consider(min, bottom) > targetBytes) {
    const s = smallest as unknown as { q: number; r: T }
    return { quality: s.q, size: sizeOf(s.r), result: s.r, reached: false, attempts }
  }

  let lo = min // 已知符合
  let hi = max // 已知太大
  while (hi - lo > 1 && attempts < maxAttempts) {
    const mid = Math.round((lo + hi) / 2)
    const r = await run(mid)
    if (consider(mid, r) <= targetBytes) lo = mid
    else hi = mid
  }
  const b = best as unknown as { q: number; r: T }
  return { quality: b.q, size: sizeOf(b.r), result: b.r, reached: true, attempts }
}
