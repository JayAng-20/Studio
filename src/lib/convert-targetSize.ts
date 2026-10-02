/**
 * 目標檔案大小：以二分搜尋找出「不超過目標大小的最高品質」。
 * 編碼器以參數注入（純函式），方便用假編碼器測試，也可在 Worker 或主執行緒使用。
 *
 * 不變式：回傳 met = true 時，size 一定 ≤ target。
 */

export interface SizeSearchOptions {
  /** 品質下限（含），預設 1 */
  min?: number
  /** 品質上限（含），預設 100 */
  max?: number
  /** 最多嘗試編碼次數（含上下限兩次），預設 9 */
  maxAttempts?: number
  /** 已達到目標的 (1 - tolerance) 以上就提早停止，預設 0.04 */
  tolerance?: number
  signal?: AbortSignal
  /** 每次編碼完成時回報（attempt 從 1 開始） */
  onAttempt?: (info: { attempt: number; quality: number; size: number }) => void
}

export interface SizeSearchResult<T> {
  quality: number
  output: T
  size: number
  /** 是否達到（不超過）目標 */
  met: boolean
  attempts: number
}

export async function searchQualityForSize<T>(
  encode: (quality: number) => Promise<T>,
  sizeOf: (output: T) => number,
  target: number,
  opts: SizeSearchOptions = {},
): Promise<SizeSearchResult<T>> {
  const min = Math.max(1, Math.round(opts.min ?? 1))
  const max = Math.max(min, Math.round(opts.max ?? 100))
  const maxAttempts = Math.max(2, opts.maxAttempts ?? 9)
  const tolerance = opts.tolerance ?? 0.04
  if (!(target > 0)) throw new RangeError('目標大小必須大於 0')

  const cache = new Map<number, { output: T; size: number }>()
  let attempts = 0
  const tryQ = async (q: number) => {
    const hit = cache.get(q)
    if (hit) return hit
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const output = await encode(q)
    const size = sizeOf(output)
    attempts++
    cache.set(q, { output, size })
    opts.onAttempt?.({ attempt: attempts, quality: q, size })
    return { output, size }
  }
  const done = (q: number, met: boolean): SizeSearchResult<T> => {
    const r = cache.get(q)!
    return { quality: q, output: r.output, size: r.size, met, attempts }
  }

  // 1. 最高品質就已經夠小
  const top = await tryQ(max)
  if (top.size <= target) return done(max, true)
  // 2. 最低品質仍然太大：回報無法達成，給出最小的結果
  if (max === min) return done(max, false)
  const bottom = await tryQ(min)
  if (bottom.size > target) return done(min, false)

  // 3. 二分搜尋：lo 一定符合、hi 一定超過
  let lo = min
  let hi = max
  while (hi - lo > 1 && attempts < maxAttempts) {
    const mid = Math.round((lo + hi) / 2)
    const r = await tryQ(mid)
    if (r.size <= target) {
      lo = mid
      if (r.size >= target * (1 - tolerance)) break
    } else hi = mid
  }
  return done(lo, true)
}
