// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { computeOutputSize, DEFAULT_RESIZE, fitDimension, fitPixels, resizeScale, stepDownPlan, type ResizeSpec } from '@/features/convert/lib/resize'

const spec = (p: Partial<ResizeSpec>): ResizeSpec => ({ ...DEFAULT_RESIZE, ...p })
const L = { width: 4032, height: 3024 }
const P = { width: 3024, height: 4032 }

describe('縮放尺寸計算', () => {
  it('不變', () => {
    expect(computeOutputSize(L, spec({ mode: 'none' }))).toEqual({ ...L, scaled: false })
  })

  it('依寬度（保持比例，寬度精確）', () => {
    expect(computeOutputSize(L, spec({ mode: 'width', width: 1920 }))).toEqual({ width: 1920, height: 1440, scaled: true })
    expect(computeOutputSize({ width: 1000, height: 333 }, spec({ mode: 'width', width: 500 }))).toMatchObject({ width: 500, height: 167 })
  })

  it('依高度', () => {
    expect(computeOutputSize(L, spec({ mode: 'height', height: 1080 }))).toMatchObject({ width: 1440, height: 1080 })
  })

  it('依長邊（橫向與直向）', () => {
    expect(computeOutputSize(L, spec({ mode: 'long', long: 2048 }))).toMatchObject({ width: 2048, height: 1536 })
    expect(computeOutputSize(P, spec({ mode: 'long', long: 2048 }))).toMatchObject({ width: 1536, height: 2048 })
  })

  it('百分比', () => {
    expect(computeOutputSize(L, spec({ mode: 'percent', percent: 50 }))).toMatchObject({ width: 2016, height: 1512 })
    expect(computeOutputSize(L, spec({ mode: 'percent', percent: 33 }))).toMatchObject({ width: 1331, height: 998 })
  })

  it('預設不放大；允許放大時才放大', () => {
    const small = { width: 800, height: 600 }
    expect(computeOutputSize(small, spec({ mode: 'width', width: 1920 }))).toEqual({ ...small, scaled: false })
    expect(computeOutputSize(small, spec({ mode: 'percent', percent: 200 }))).toEqual({ ...small, scaled: false })
    expect(computeOutputSize(small, spec({ mode: 'width', width: 1920, upscale: true }))).toMatchObject({ width: 1920, height: 1440 })
    expect(computeOutputSize(small, spec({ mode: 'percent', percent: 200, upscale: true }))).toMatchObject({ width: 1600, height: 1200 })
  })

  it('極端比例最小 1 px；無效值視為不縮放', () => {
    expect(computeOutputSize({ width: 10000, height: 10 }, spec({ mode: 'width', width: 100 }))).toMatchObject({ width: 100, height: 1 })
    expect(resizeScale(L, spec({ mode: 'width', width: 0 }))).toBe(1)
    expect(resizeScale({ width: 0, height: 0 }, spec({ mode: 'width', width: 10 }))).toBe(1)
  })

  it('大圖保護：限制總像素', () => {
    const r = fitPixels({ width: 20000, height: 10000 }, 100_000_000)
    expect(r.limited).toBe(true)
    expect(r.width * r.height).toBeLessThanOrEqual(100_000_000)
    expect(r.width / r.height).toBeCloseTo(2, 2)
    expect(fitPixels(L, 100_000_000)).toEqual({ ...L, limited: false })
  })

  it('限制最長邊', () => {
    expect(fitDimension({ width: 30000, height: 15000 }, 16384)).toEqual({ width: 16384, height: 8192, limited: true })
    expect(fitDimension(L, 16384).limited).toBe(false)
  })

  it('分段縮小：每次最多一半，最後一步為目標尺寸', () => {
    const plan = stepDownPlan({ width: 4000, height: 3000 }, { width: 400, height: 300 })
    expect(plan.at(-1)).toEqual({ width: 400, height: 300 })
    expect(plan.length).toBeGreaterThan(1)
    let prev = { width: 4000, height: 3000 }
    for (const s of plan) {
      expect(s.width).toBeGreaterThanOrEqual(Math.floor(prev.width / 2))
      prev = s
    }
    expect(stepDownPlan({ width: 100, height: 100 }, { width: 300, height: 300 })).toEqual([{ width: 300, height: 300 }])
    expect(stepDownPlan({ width: 100, height: 100 }, { width: 80, height: 80 })).toEqual([{ width: 80, height: 80 }])
  })
})
