// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applyColor,
  effectiveParams,
  gaussianBlur,
  isNeutral,
  mosaic,
} from '@/features/tools/lib/adjust'
import { extractPalette, hexToRgb, toHex, toHsl } from '@/features/tools/lib/color'
import { coverSource, planCollage } from '@/features/tools/lib/collage'
import { defaultAdjust } from '@/features/tools/lib/types'

const solid = (w: number, h: number, rgb: [number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < d.length; i += 4) d.set([...rgb, 255], i)
  return d
}

describe('調整與濾鏡', () => {
  it('全部為 0 且沒有濾鏡時是中性（不需處理像素）', () => {
    expect(isNeutral(effectiveParams(defaultAdjust(), { id: 'none', strength: 100 }))).toBe(true)
    expect(isNeutral(effectiveParams(defaultAdjust(), { id: 'vivid', strength: 0 }))).toBe(true)
    expect(isNeutral(effectiveParams(defaultAdjust(), { id: 'vivid', strength: 50 }))).toBe(false)
  })

  it('灰階 100 讓 RGB 相等；亮度提高讓像素變亮', () => {
    const d = solid(2, 2, [200, 40, 40])
    applyColor(
      d,
      2,
      2,
      effectiveParams({ ...defaultAdjust(), grayscale: 100 }, { id: 'none', strength: 0 }),
    )
    expect(d[0]).toBe(d[1])
    expect(d[1]).toBe(d[2])
    const e = solid(1, 1, [100, 100, 100])
    applyColor(
      e,
      1,
      1,
      effectiveParams({ ...defaultAdjust(), brightness: 50 }, { id: 'none', strength: 0 }),
    )
    expect(e[0]).toBeGreaterThan(100)
  })

  it('色溫：暖色增加紅、減少藍', () => {
    const d = solid(1, 1, [128, 128, 128])
    applyColor(
      d,
      1,
      1,
      effectiveParams({ ...defaultAdjust(), temperature: 100 }, { id: 'none', strength: 0 }),
    )
    expect(d[0]).toBeGreaterThan(128)
    expect(d[2]).toBeLessThan(128)
  })

  it('模糊不改變單色圖，且會抹平邊緣', () => {
    const d = solid(8, 8, [50, 60, 70])
    expect(Array.from(gaussianBlur(d, 8, 8, 2).subarray(0, 4))).toEqual([50, 60, 70, 255])
    const edge = new Uint8ClampedArray(16 * 1 * 4)
    for (let x = 0; x < 16; x++) edge.set(x < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255], x * 4)
    const b = gaussianBlur(edge, 16, 1, 2)
    expect(b[7 * 4]).toBeGreaterThan(0)
    expect(b[8 * 4]).toBeLessThan(255)
  })

  it('馬賽克：每格填入平均色', () => {
    const d = new Uint8ClampedArray(4 * 1 * 4)
    d.set([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 0, 0, 0, 255])
    mosaic(d, 4, 1, 2)
    expect(d[0]).toBe(50)
    expect(d[4]).toBe(50)
    expect(d[8]).toBe(100)
  })
})

describe('顏色', () => {
  it('HEX／RGB／HSL 轉換', () => {
    expect(toHex({ r: 225, g: 29, b: 72 })).toBe('#E11D48')
    expect(hexToRgb('#e11d48')).toEqual({ r: 225, g: 29, b: 72 })
    expect(toHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 })
  })

  it('主色擷取：兩種顏色依佔比排序', () => {
    const w = 10
    const d = new Uint8ClampedArray(w * 10 * 4)
    for (let i = 0; i < w * 10; i++) d.set(i < 70 ? [220, 20, 60, 255] : [20, 120, 220, 255], i * 4)
    const p = extractPalette(d, 4)
    expect(p[0].hex).toBe('#DC143C')
    expect(p[0].ratio).toBeCloseTo(0.7, 1)
    expect(p[1].hex).toBe('#1478DC')
  })
})

describe('拼貼版面', () => {
  it('橫排：所有圖同高、總寬等於輸出寬', () => {
    const p = planCollage('row', [1, 2], 1000, 10)
    expect(p.cells[0].h).toBeCloseTo(p.cells[1].h)
    const last = p.cells[1]
    expect(last.x + last.w + 10).toBeCloseTo(1000)
  })

  it('格狀：最後一列置中', () => {
    const p = planCollage('grid', [1, 1, 1], 1000, 0)
    expect(p.cells).toHaveLength(3)
    expect(p.cells[2].x).toBeCloseTo(250)
  })

  it('填滿時從中央裁切來源', () => {
    expect(coverSource(200, 100, { w: 100, h: 100 })).toEqual({ x: 50, y: 0, w: 100, h: 100 })
  })
})
