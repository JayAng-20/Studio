// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { zlibSync, unzlibSync } from 'fflate'
import {
  alignEven,
  buildAnimatedWebp,
  buildApng,
  changedRect,
  crc32,
  cropRgba,
  extractWebpPayload,
  filterScanlines,
} from '@/features/gif/containers'

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))

/** 逐一列出 PNG 區塊類型並驗證 CRC */
function pngChunks(b: Uint8Array) {
  const out: string[] = []
  let p = 8
  while (p < b.length) {
    const len = (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]
    const type = ascii(b, p + 4, 4)
    const crc = ((b[p + 8 + len] << 24) | (b[p + 9 + len] << 16) | (b[p + 10 + len] << 8) | b[p + 11 + len]) >>> 0
    expect(crc32(b, p + 4, p + 8 + len)).toBe(crc)
    out.push(type)
    p += 12 + len
  }
  return out
}

/** 反向套用濾波，驗證 filterScanlines 可還原 */
function unfilter(data: Uint8Array, w: number, h: number, bpp: number) {
  const stride = w * bpp
  const out = new Uint8Array(stride * h)
  for (let y = 0; y < h; y++) {
    const f = data[y * (stride + 1)]
    for (let i = 0; i < stride; i++) {
      const raw = data[y * (stride + 1) + 1 + i]
      const left = i >= bpp ? out[y * stride + i - bpp] : 0
      const up = y ? out[(y - 1) * stride + i] : 0
      const ul = y && i >= bpp ? out[(y - 1) * stride + i - bpp] : 0
      let pred = 0
      if (f === 1) pred = left
      else if (f === 2) pred = up
      else if (f === 3) pred = (left + up) >> 1
      else if (f === 4) {
        const p = left + up - ul
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - ul)
        pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul
      }
      out[y * stride + i] = (raw + pred) & 255
    }
  }
  return out
}

describe('CRC-32', () => {
  it('標準測試向量', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('PNG 濾波', () => {
  it('濾波後可還原原始像素（RGBA 與 RGB）', () => {
    const w = 13
    const h = 7
    const px = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < px.length; i++) px[i] = (i * 37 + (i >> 5) * 11) & 255
    for (const ct of [6, 2] as const) {
      const bpp = ct === 6 ? 4 : 3
      const back = unfilter(filterScanlines(px, w, h, ct), w, h, bpp)
      for (let p = 0; p < w * h; p++)
        for (let c = 0; c < bpp; c++) expect(back[p * bpp + c]).toBe(px[p * 4 + c])
    }
  })
})

describe('APNG', () => {
  it('區塊順序正確、CRC 正確、序號連續', () => {
    const w = 4
    const h = 3
    const px = new Uint8ClampedArray(w * h * 4).fill(200)
    const data = zlibSync(filterScanlines(px, w, h, 2))
    const bytes = buildApng(
      w,
      h,
      0,
      [
        { x: 0, y: 0, width: w, height: h, delayNum: 10, delayDen: 100, data },
        { x: 1, y: 1, width: 2, height: 1, delayNum: 20, delayDen: 100, data: zlibSync(filterScanlines(px.subarray(0, 8), 2, 1, 2)) },
      ],
      2,
    )
    expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(pngChunks(bytes)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND'])
    // IDAT 可解壓
    expect(unzlibSync(data).length).toBe((w * 3 + 1) * h)
  })
})

describe('Animated WebP', () => {
  /** 造一個最小的「靜態 WebP」：RIFF + VP8L（內容不需可解碼，只測封裝） */
  function fakeStill(alpha: boolean) {
    const payload = new Uint8Array([0x2f, 0, 0, 0, alpha ? 0x10 : 0, 1, 2])
    const size = payload.length
    const b = new Uint8Array(12 + 8 + size + (size & 1))
    b.set(new TextEncoder().encode('RIFF'), 0)
    b.set(new TextEncoder().encode('WEBP'), 8)
    b.set(new TextEncoder().encode('VP8L'), 12)
    b[16] = size
    b.set(payload, 20)
    return b
  }

  it('取出影像區塊並判斷 alpha', () => {
    const p = extractWebpPayload(fakeStill(true))
    expect(ascii(p.chunks, 0, 4)).toBe('VP8L')
    expect(p.hasAlpha).toBe(true)
    expect(extractWebpPayload(fakeStill(false)).hasAlpha).toBe(false)
  })

  it('封裝 VP8X／ANIM／ANMF，RIFF 長度正確', () => {
    const p = extractWebpPayload(fakeStill(false))
    const out = buildAnimatedWebp(100, 50, 0, [
      { x: 0, y: 0, width: 100, height: 50, durationMs: 100, payload: p },
      { x: 10, y: 4, width: 20, height: 10, durationMs: 50, payload: p },
    ])
    expect(ascii(out, 0, 4)).toBe('RIFF')
    expect(ascii(out, 8, 4)).toBe('WEBP')
    expect(ascii(out, 12, 4)).toBe('VP8X')
    expect(out[20] & 0x02).toBe(0x02)
    const riff = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24)
    expect(riff).toBe(out.length - 8)
    expect(ascii(out, 30, 4)).toBe('ANIM')
    expect(ascii(out, 44, 4)).toBe('ANMF')
    // 第一格寬高 - 1（24-bit）
    expect(out[52 + 6] | (out[52 + 7] << 8)).toBe(99)
  })
})

describe('子矩形', () => {
  it('找出變化區域；相同影格回傳 null', () => {
    const w = 10
    const h = 6
    const a = new Uint8ClampedArray(w * h * 4)
    const b = a.slice()
    expect(changedRect(a, b, w, h)).toBeNull()
    b[(2 * w + 3) * 4] = 9
    b[(4 * w + 7) * 4 + 2] = 9
    expect(changedRect(a, b, w, h)).toEqual({ x: 3, y: 2, w: 5, h: 3 })
  })
  it('裁切與偶數對齊', () => {
    const w = 4
    const src = new Uint8ClampedArray(w * 2 * 4).map((_, i) => i)
    const c = cropRgba(src, w, { x: 1, y: 1, w: 2, h: 1 })
    expect(Array.from(c)).toEqual([20, 21, 22, 23, 24, 25, 26, 27])
    expect(alignEven({ x: 3, y: 5, w: 4, h: 2 }, 100, 100)).toEqual({ x: 2, y: 4, w: 5, h: 3 })
  })
})
