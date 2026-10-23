// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { searchQuality } from '@/lib/tools-quality-search'

/** 假編碼器：大小隨品質單調遞增（類似 JPEG 曲線） */
const fake = (scale = 1000) => {
  const calls: number[] = []
  const encode = async (q: number) => {
    calls.push(q)
    return { size: Math.round(scale * (20 + q * q * 0.05)), q }
  }
  return { encode, calls }
}
const sizeOf = (r: { size: number }) => r.size

describe('目標大小搜尋', () => {
  it('找到不超過目標的最高品質', async () => {
    const { encode } = fake()
    const target = 300_000
    const r = await searchQuality(encode, sizeOf, target)
    expect(r.reached).toBe(true)
    expect(r.size).toBeLessThanOrEqual(target)
    // 品質再高 1 就會超過
    const next = (await encode(r.quality + 1)).size
    expect(next).toBeGreaterThan(target)
  })

  it('編碼次數有上限（≤ 9 次）', async () => {
    const { encode, calls } = fake()
    const r = await searchQuality(encode, sizeOf, 250_000)
    expect(r.attempts).toBeLessThanOrEqual(9)
    expect(calls.length).toBe(r.attempts)
    // 不重複編碼同一個品質
    expect(new Set(calls).size).toBe(calls.length)
  })

  it('最高品質就符合時直接回傳，只編碼一次', async () => {
    const { encode, calls } = fake(1)
    const r = await searchQuality(encode, sizeOf, 10_000_000)
    expect(r.quality).toBe(95)
    expect(calls).toEqual([95])
  })

  it('最低品質仍太大：回傳最小結果並標示未達成', async () => {
    const { encode } = fake(1000)
    const r = await searchQuality(encode, sizeOf, 1000)
    expect(r.reached).toBe(false)
    expect(r.quality).toBe(5)
  })

  it('編碼結果不單調時，仍回傳符合目標的結果', async () => {
    // 在 60 附近有個突起
    const encode = async (q: number) => ({ size: q === 60 ? 999_999 : q * 1000 })
    const r = await searchQuality(encode, sizeOf, 70_000)
    expect(r.reached).toBe(true)
    expect(r.size).toBeLessThanOrEqual(70_000)
  })

  it('可以取消', async () => {
    const ctrl = new AbortController()
    const encode = async (q: number) => {
      ctrl.abort()
      return { size: q * 10_000 }
    }
    await expect(searchQuality(encode, sizeOf, 100_000, { signal: ctrl.signal })).rejects.toThrow()
  })
})
