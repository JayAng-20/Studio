// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applyChromaKey,
  bayerSpread,
  createNearest,
  hexToRgb,
  indexPixels,
  rgbToHex,
  samplePixels,
  type Palette,
} from '@/features/gif/dither'

/** 產生水平灰階漸層 */
function gradient(w: number, h: number) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const v = Math.round((x / (w - 1)) * 255)
      px[o] = px[o + 1] = px[o + 2] = v
      px[o + 3] = 255
    }
  return px
}

const BW: Palette = [
  [0, 0, 0],
  [255, 255, 255],
]

const meanOf = (idx: Uint8Array, pal: Palette) =>
  Array.from(idx).reduce((a, i) => a + pal[i][0], 0) / idx.length

describe('最近色', () => {
  it('找到最接近的顏色並略過保留格', () => {
    const pal: Palette = [
      [0, 0, 0],
      [250, 10, 10],
      [255, 0, 0],
    ]
    expect(createNearest(pal)(240, 0, 0)).toBe(2)
    expect(createNearest(pal, 2)(240, 0, 0)).toBe(1)
  })
})

describe('抖色', () => {
  const w = 64
  const h = 16
  const src = gradient(w, h)
  const srcMean =
    Array.from({ length: w * h }, (_, p) => src[p * 4]).reduce((a, b) => a + b, 0) / (w * h)

  it('none：只有兩種顏色時呈硬邊（左半黑、右半白）', () => {
    const idx = indexPixels(src, w, h, BW, 'none')
    expect(idx[0]).toBe(0)
    expect(idx[w - 1]).toBe(1)
    // 同一列只會切換一次
    let switches = 0
    for (let x = 1; x < w; x++) if (idx[x] !== idx[x - 1]) switches++
    expect(switches).toBe(1)
  })

  it('Floyd–Steinberg 保留平均亮度（誤差擴散）', () => {
    const idx = indexPixels(src, w, h, BW, 'fs')
    expect(Math.abs(meanOf(idx, BW) - srcMean)).toBeLessThan(6)
    // 中間灰應該混合黑白
    const mid = Array.from(idx.subarray(w * 8 + 28, w * 8 + 36))
    expect(new Set(mid).size).toBe(2)
  })

  it('Bayer 排序式抖色：結果可重現、平均亮度接近原圖', () => {
    const a = indexPixels(src, w, h, BW, 'bayer')
    const b = indexPixels(src, w, h, BW, 'bayer')
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(Math.abs(meanOf(a, BW) - srcMean)).toBeLessThan(40)
    expect(bayerSpread(2)).toBeGreaterThan(bayerSpread(256))
  })

  it('索引都在調色盤範圍內', () => {
    const pal: Palette = [
      [0, 0, 0],
      [128, 128, 128],
      [255, 255, 255],
    ]
    for (const mode of ['none', 'fs', 'bayer'] as const) {
      const idx = indexPixels(src, w, h, pal, mode)
      expect(Math.max(...idx)).toBeLessThan(pal.length)
    }
  })

  it('透明像素寫入透明格，不會被一般像素使用', () => {
    const px = gradient(8, 2)
    px[3] = 0 // 第一個像素透明
    const pal: Palette = [...BW, [0, 0, 0]]
    for (const mode of ['none', 'fs', 'bayer'] as const) {
      const idx = indexPixels(px, 8, 2, pal, mode, { transparentIndex: 2 })
      expect(idx[0]).toBe(2)
      expect(Array.from(idx.subarray(1)).includes(2)).toBe(false)
    }
  })
})

describe('色鍵與工具', () => {
  it('去除接近綠色的像素', () => {
    const px = new Uint8ClampedArray([0, 255, 0, 255, 10, 240, 20, 255, 255, 0, 0, 255])
    const n = applyChromaKey(px, [0, 255, 0], 20)
    expect(n).toBe(2)
    expect(px[3]).toBe(0)
    expect(px[7]).toBe(0)
    expect(px[11]).toBe(255)
  })
  it('色碼轉換', () => {
    expect(hexToRgb('#FF8000')).toEqual([255, 128, 0])
    expect(rgbToHex(255, 128, 0)).toBe('#FF8000')
    expect(hexToRgb('bad')).toEqual([0, 0, 0])
  })
  it('抽樣只取不透明像素、且是獨立緩衝', () => {
    const a = new Uint8ClampedArray([1, 2, 3, 255, 9, 9, 9, 0])
    const s = samplePixels([a], 100)
    expect(Array.from(s)).toEqual([1, 2, 3, 255])
    expect(s.byteOffset).toBe(0)
    expect(s.buffer.byteLength).toBe(4)
  })
})
