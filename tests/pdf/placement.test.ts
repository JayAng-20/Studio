// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  anchorPlacement,
  placementToDraw,
  rotatedBounds,
  tilePlacements,
  visualSize,
  visualToPdf,
} from '@/features/pdf/lib/placement'

const page = { x: 0, y: 0, width: 600, height: 800, rotation: 0 }

describe('擺放幾何', () => {
  it('九宮格：右下角保留邊距', () => {
    const p = anchorPlacement({ w: 600, h: 800 }, { w: 100, h: 20 }, 'br', 24)
    expect(p.cx).toBe(600 - 24 - 50)
    expect(p.cy).toBe(800 - 24 - 10)
  })
  it('旋轉 90° 的外接框交換寬高', () => {
    const b = rotatedBounds({ w: 100, h: 20 }, 90)
    expect(b.w).toBeCloseTo(20)
    expect(b.h).toBeCloseTo(100)
  })
  it('視覺座標轉 PDF：未旋轉時 y 翻轉', () => {
    expect(visualToPdf(page, 10, 20)).toEqual({ x: 10, y: 780 })
  })
  it('頁面 /Rotate 90：視覺左上角對應 PDF 原點', () => {
    const g = { ...page, rotation: 90 }
    expect(visualSize(g)).toEqual({ w: 800, h: 600 })
    expect(visualToPdf(g, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(visualToPdf(g, 800, 600)).toEqual({ x: 600, y: 800 })
  })
  it('/Rotate 180 與 270 的角落', () => {
    expect(visualToPdf({ ...page, rotation: 180 }, 0, 0)).toEqual({ x: 600, y: 0 })
    expect(visualToPdf({ ...page, rotation: 270 }, 0, 0)).toEqual({ x: 600, y: 800 })
  })
  it('裁切框原點偏移', () => {
    expect(visualToPdf({ ...page, x: 50, y: 30 }, 0, 0)).toEqual({ x: 50, y: 830 })
  })
  it('drawImage 參數：圖章中心落在指定位置', () => {
    for (const rotation of [0, 90, 180, 270]) {
      for (const angle of [0, 30, -45]) {
        const g = { ...page, rotation }
        const p = { cx: 200, cy: 300, angle }
        const box = { w: 120, h: 40 }
        const d = placementToDraw(g, p, box)
        const rad = (d.rotate * Math.PI) / 180
        const cx = d.x + (box.w / 2) * Math.cos(rad) - (box.h / 2) * Math.sin(rad)
        const cy = d.y + (box.w / 2) * Math.sin(rad) + (box.h / 2) * Math.cos(rad)
        const want = visualToPdf(g, 200, 300)
        expect(cx).toBeCloseTo(want.x, 6)
        expect(cy).toBeCloseTo(want.y, 6)
      }
    }
  })
  it('平鋪覆蓋整個頁面且有上限', () => {
    const list = tilePlacements({ w: 600, h: 800 }, { w: 100, h: 30 }, 45, 40)
    expect(list.length).toBeGreaterThan(6)
    expect(list.length).toBeLessThanOrEqual(600)
    expect(list.some((p) => p.cx < 100 && p.cy < 100)).toBe(true)
    expect(list.some((p) => p.cx > 500 && p.cy > 700)).toBe(true)
  })
})

import { pdfToVisual, rectToVisual } from '@/features/pdf/lib/placement'
describe('PDF → 視覺座標', () => {
  it('是 visualToPdf 的反函數（各種旋轉）', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const g = { x: 10, y: 20, width: 600, height: 800, rotation }
      const p = visualToPdf(g, 123, 45)
      const v = pdfToVisual(g, p.x, p.y)
      expect(v.x).toBeCloseTo(123)
      expect(v.y).toBeCloseTo(45)
    }
  })
  it('矩形轉換', () => {
    const g = { x: 0, y: 0, width: 600, height: 800, rotation: 0 }
    expect(rectToVisual(g, { x: 100, y: 700, width: 50, height: 20 })).toEqual({
      x: 100,
      y: 80,
      w: 50,
      h: 20,
    })
  })
})
