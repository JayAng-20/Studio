// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { searchQualityForSize } from '@/lib/convert-targetSize'

/** 假編碼器：大小 = f(品質)，記錄呼叫次數 */
function fake(sizeAt: (q: number) => number) {
  const calls: number[] = []
  const encode = async (q: number) => {
    calls.push(q)
    return { q, size: Math.round(sizeAt(q)) }
  }
  return { encode, calls, sizeOf: (o: { size: number }) => o.size }
}

describe('目標檔案大小：二分搜尋品質（假編碼器）', () => {
  it('單調遞增：找到不超過目標的最高品質', async () => {
    const f = fake((q) => q * 1000)
    const r = await searchQualityForSize(f.encode, f.sizeOf, 50_500, { tolerance: 0 })
    expect(r.met).toBe(true)
    expect(r.quality).toBe(50)
    expect(r.size).toBeLessThanOrEqual(50_500)
    expect(r.output.q).toBe(50)
    expect(r.attempts).toBeLessThanOrEqual(9)
    expect(f.calls.slice(0, 2)).toEqual([100, 1])
  })

  it('最高品質就夠小：只編碼一次', async () => {
    const f = fake((q) => q * 10)
    const r = await searchQualityForSize(f.encode, f.sizeOf, 5000)
    expect(r).toMatchObject({ quality: 100, met: true, attempts: 1 })
    expect(f.calls).toEqual([100])
  })

  it('最低品質仍太大：回報未達成，給最小的結果', async () => {
    const f = fake((q) => 10_000 + q * 100)
    const r = await searchQualityForSize(f.encode, f.sizeOf, 5000)
    expect(r).toMatchObject({ quality: 1, met: false, attempts: 2 })
    expect(r.size).toBe(10_100)
  })

  it('非單調（真實編碼器常見）：結果仍一定不超過目標', async () => {
    const noise = (q: number) => q * 1000 + ((q * 7919) % 13) * 400
    for (const target of [5_000, 23_456, 61_000, 88_888, 99_000]) {
      const f = fake(noise)
      const r = await searchQualityForSize(f.encode, f.sizeOf, target)
      if (r.met) expect(r.size).toBeLessThanOrEqual(target)
      expect(r.attempts).toBeLessThanOrEqual(9)
    }
  })

  it('容許誤差內就提早停止', async () => {
    const f = fake((q) => q * 1000)
    const r = await searchQualityForSize(f.encode, f.sizeOf, 75_000, { tolerance: 0.2 })
    expect(r.met).toBe(true)
    expect(r.size).toBeGreaterThanOrEqual(75_000 * 0.8)
    expect(r.size).toBeLessThanOrEqual(75_000)
    expect(r.attempts).toBeLessThan(6)
  })

  it('嘗試次數上限', async () => {
    const f = fake((q) => q * 1000)
    const r = await searchQualityForSize(f.encode, f.sizeOf, 33_333, {
      maxAttempts: 4,
      tolerance: 0,
    })
    expect(r.attempts).toBe(4)
    expect(r.met).toBe(true)
    expect(r.size).toBeLessThanOrEqual(33_333)
  })

  it('相同品質不重複編碼、回報每次嘗試', async () => {
    const f = fake((q) => q * 1000)
    const onAttempt = vi.fn()
    await searchQualityForSize(f.encode, f.sizeOf, 42_000, { onAttempt, tolerance: 0 })
    expect(new Set(f.calls).size).toBe(f.calls.length)
    expect(onAttempt).toHaveBeenCalledTimes(f.calls.length)
    expect(onAttempt.mock.calls[0][0]).toMatchObject({ attempt: 1, quality: 100, size: 100_000 })
  })

  it('自訂品質範圍', async () => {
    const f = fake((q) => q * 1000)
    const r = await searchQualityForSize(f.encode, f.sizeOf, 70_000, {
      min: 40,
      max: 90,
      tolerance: 0,
    })
    expect(r.quality).toBe(70)
    expect(f.calls.every((q) => q >= 40 && q <= 90)).toBe(true)
  })

  it('取消', async () => {
    const ctl = new AbortController()
    const f = fake((q) => {
      if (q === 1) ctl.abort()
      return q * 1000
    })
    await expect(
      searchQualityForSize(f.encode, f.sizeOf, 50_000, { signal: ctl.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('無效目標', async () => {
    const f = fake((q) => q)
    await expect(searchQualityForSize(f.encode, f.sizeOf, 0)).rejects.toThrow(RangeError)
  })
})
