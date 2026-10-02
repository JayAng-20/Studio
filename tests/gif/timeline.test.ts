// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applyOrder,
  buildImageTimeline,
  buildVideoTimeline,
  countFrames,
  defaultRange,
  frameDelays,
  outputStartTimes,
  repeatField,
  sampleTimes,
  snapThreshold,
  snapToSecond,
  totalDuration,
} from '@/features/gif/timeline'

describe('frameDelays', () => {
  it('10 fps → 每格 10 cs', () => {
    expect(frameDelays(5, 10)).toEqual([10, 10, 10, 10, 10])
  })
  it('24 fps 以累積修正讓總長正確', () => {
    const d = frameDelays(24, 24)
    expect(d.reduce((a, b) => a + b, 0)).toBe(100)
    expect(new Set(d)).toEqual(new Set([4, 5]))
  })
  it('30 fps 總長正確', () => {
    expect(frameDelays(30, 30).reduce((a, b) => a + b, 0)).toBe(100)
  })
  it('延遲不低於 2 cs', () => {
    expect(Math.min(...frameDelays(10, 90))).toBeGreaterThanOrEqual(2)
  })
  it('0 格或無效 fps 回傳空陣列', () => {
    expect(frameDelays(0, 10)).toEqual([])
    expect(frameDelays(3, 0)).toEqual([])
  })
})

describe('sampleTimes', () => {
  it('區間 1–3 秒、10 fps → 20 格，從起點開始', () => {
    const t = sampleTimes(1, 3, 10, 1)
    expect(t).toHaveLength(20)
    expect(t[0]).toBe(1)
    expect(t[1]).toBe(1.1)
    expect(t[19]).toBe(2.9)
  })
  it('速度 2 倍時取樣間隔加倍、影格減半', () => {
    const t = sampleTimes(0, 2, 10, 2)
    expect(t).toHaveLength(10)
    expect(t[1]).toBe(0.2)
  })
  it('速度 0.5 倍時影格加倍', () => {
    expect(sampleTimes(0, 1, 10, 0.5)).toHaveLength(20)
  })
  it('非整除區間無條件進位', () => {
    expect(sampleTimes(0, 2.05, 10, 1)).toHaveLength(21)
  })
  it('起訖顛倒時自動交換；零長度至少一格', () => {
    expect(sampleTimes(3, 1, 10, 1)[0]).toBe(1)
    expect(sampleTimes(2, 2, 10, 1)).toEqual([2])
  })
  it('沒有浮點尾數', () => {
    for (const t of sampleTimes(0, 3, 30, 1)) expect(String(t).length).toBeLessThan(8)
  })
})

describe('applyOrder', () => {
  it('倒放', () => {
    expect(applyOrder([0, 1, 2, 3], true, false)).toEqual([3, 2, 1, 0])
  })
  it('來回不重複兩端點', () => {
    expect(applyOrder([0, 1, 2, 3], false, true)).toEqual([0, 1, 2, 3, 2, 1])
  })
  it('倒放＋來回', () => {
    expect(applyOrder([0, 1, 2, 3], true, true)).toEqual([3, 2, 1, 0, 1, 2])
  })
  it('少於 3 格時來回不變', () => {
    expect(applyOrder([0, 1], false, true)).toEqual([0, 1])
  })
  it('不修改原陣列', () => {
    const a = [0, 1, 2]
    applyOrder(a, true, true)
    expect(a).toEqual([0, 1, 2])
  })
})

describe('buildVideoTimeline', () => {
  const base = { start: 0, end: 1, fps: 10, speed: 1, reverse: false, pingpong: false }
  it('時間戳與延遲', () => {
    const tl = buildVideoTimeline(base)
    expect(tl).toHaveLength(10)
    expect(tl.map((f) => f.t)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
    expect(tl.every((f) => f.delayCs === 10)).toBe(true)
  })
  it('倒放', () => {
    const tl = buildVideoTimeline({ ...base, reverse: true })
    expect(tl[0].t).toBe(0.9)
    expect(tl[9].t).toBe(0)
  })
  it('來回：長度 2n-2，輸出總長隨之增加', () => {
    const tl = buildVideoTimeline({ ...base, pingpong: true })
    expect(tl).toHaveLength(18)
    expect(tl[9].t).toBe(0.9)
    expect(tl[10].t).toBe(0.8)
    expect(tl[17].t).toBe(0.1)
    expect(totalDuration(tl.map((f) => f.delayCs))).toBeCloseTo(1.8)
  })
  it('速度 2 倍：來源 2 秒變成輸出 1 秒', () => {
    const tl = buildVideoTimeline({ ...base, end: 2, speed: 2 })
    expect(tl).toHaveLength(10)
    expect(totalDuration(tl.map((f) => f.delayCs))).toBeCloseTo(1)
    expect(tl[9].t).toBe(1.8)
  })
  it('countFrames 與實際長度一致', () => {
    for (const o of [
      base,
      { ...base, pingpong: true },
      { ...base, end: 3.33, fps: 24, speed: 1.5 },
      { ...base, start: 2, end: 2, pingpong: true },
    ]) {
      expect(countFrames(o)).toBe(buildVideoTimeline(o).length)
    }
  })
})

describe('buildImageTimeline', () => {
  it('每張停留 1/fps 秒，速度縮短停留時間', () => {
    expect(buildImageTimeline(3, 5, 1, false, false)).toEqual([
      { index: 0, delayCs: 20 },
      { index: 1, delayCs: 20 },
      { index: 2, delayCs: 20 },
    ])
    expect(buildImageTimeline(2, 5, 2, false, false).map((f) => f.delayCs)).toEqual([10, 10])
  })
  it('倒放與來回', () => {
    expect(buildImageTimeline(4, 10, 1, true, true).map((f) => f.index)).toEqual([3, 2, 1, 0, 1, 2])
  })
  it('0 張回傳空陣列', () => {
    expect(buildImageTimeline(0, 10, 1, false, false)).toEqual([])
  })
})

describe('其他工具', () => {
  it('outputStartTimes', () => {
    expect(outputStartTimes([10, 20, 5])).toEqual([0, 0.1, 0.3])
  })
  it('吸附到整數秒', () => {
    expect(snapToSecond(2.04, 0.05)).toEqual({ value: 2, snapped: 2 })
    expect(snapToSecond(2.3, 0.05)).toEqual({ value: 2.3, snapped: null })
    expect(snapThreshold(1000)).toBeLessThanOrEqual(0.08)
    expect(snapThreshold(1)).toBeGreaterThanOrEqual(0.03)
  })
  it('預設區間：傳入區間優先，否則取前 5 秒', () => {
    expect(defaultRange(30, { start: 4, end: 7.5 })).toEqual([4, 7.5])
    expect(defaultRange(30, null)).toEqual([0, 5])
    expect(defaultRange(3, null)).toEqual([0, 3])
    expect(defaultRange(10, { start: 9, end: 20 })).toEqual([9, 10])
    expect(defaultRange(Infinity, null)).toEqual([0, 5])
  })
  it('迴圈欄位', () => {
    expect(repeatField('infinite')).toBe(0)
    expect(repeatField(1)).toBe(-1)
    expect(repeatField(3)).toBe(2)
  })
})
