// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { computePalette, GifAssembler, quantizeFrame } from '@/features/gif/gifCore'

const ascii = (b: Uint8Array, n: number) => String.fromCharCode(...b.subarray(0, n))

function frame(w: number, h: number, shift: number) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      px[o] = (x * 8 + shift) & 255
      px[o + 1] = (y * 8) & 255
      px[o + 2] = 128
      px[o + 3] = 255
    }
  return px
}

/** 數出 GIF 裡的影像描述區塊（0x2C）數量：逐區塊解析 */
function countImages(b: Uint8Array) {
  let p = 6 + 7
  const flags = b[10]
  if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1))
  let images = 0
  while (p < b.length) {
    const t = b[p]
    if (t === 0x3b) return images
    if (t === 0x21) {
      p += 2
      while (b[p]) p += b[p] + 1
      p++
    } else if (t === 0x2c) {
      images++
      const lf = b[p + 9]
      p += 10
      if (lf & 0x80) p += 3 * (1 << ((lf & 7) + 1))
      p++ // LZW 最小碼長
      while (b[p]) p += b[p] + 1
      p++
    } else throw new Error(`unexpected block ${t}`)
  }
  throw new Error('missing trailer')
}

describe('gifenc 輸出', () => {
  it('直接使用 gifenc：以 GIF89a 開頭、以 0x3B 結尾', () => {
    const w = 16
    const h = 8
    const px = frame(w, h, 0)
    const pal = quantize(px, 64)
    const idx = applyPalette(px, pal)
    const g = GIFEncoder()
    g.writeFrame(idx, w, h, { palette: pal, delay: 100 })
    g.finish()
    const bytes = g.bytes()
    expect(ascii(bytes, 6)).toBe('GIF89a')
    expect(bytes[bytes.length - 1]).toBe(0x3b)
    // 邏輯畫面寬高（little-endian）
    expect(bytes[6] | (bytes[7] << 8)).toBe(w)
    expect(bytes[8] | (bytes[9] << 8)).toBe(h)
  })

  it('組裝器：每格調色盤、FS 抖色，可正確解析出所有影格', () => {
    const w = 24
    const h = 12
    const asm = new GifAssembler({
      width: w,
      height: h,
      repeat: 0,
      global: null,
      diff: false,
      tolerance: 0,
      transparent: false,
    })
    for (let i = 0; i < 4; i++) {
      const q = quantizeFrame(frame(w, h, i * 30), w, h, 32, 'fs', null, false)
      asm.add(q.index, q.palette, q.transparentIndex, 10)
    }
    const bytes = asm.finish()
    expect(ascii(bytes, 6)).toBe('GIF89a')
    expect(countImages(bytes)).toBe(4)
    expect(asm.frameSizes.every((s) => s > 0)).toBe(true)
    // NETSCAPE2.0 迴圈擴充
    expect(new TextDecoder().decode(bytes).includes('NETSCAPE2.0')).toBe(true)
  })

  it('組裝器：全域調色盤＋差異最佳化，相同影格會合併', () => {
    const w = 20
    const h = 10
    const a = frame(w, h, 0)
    const b = frame(w, h, 50)
    const pal = computePalette(new Uint8Array(a.buffer.slice(0)), 64, true)
    expect(pal.length).toBeLessThanOrEqual(64)
    const asm = new GifAssembler({
      width: w,
      height: h,
      repeat: -1,
      global: pal,
      diff: true,
      tolerance: 0,
      transparent: false,
    })
    const frames = [a, a, a, b]
    for (const f of frames) {
      const q = quantizeFrame(f, w, h, 64, 'bayer', pal, true)
      asm.add(q.index, q.palette, q.transparentIndex, 10)
    }
    const bytes = asm.finish()
    expect(ascii(bytes, 6)).toBe('GIF89a')
    // 三張相同的 a 合併成一格
    expect(countImages(bytes)).toBe(2)
    expect(asm.frameSizes[1]).toBe(0)
    expect(asm.frameSizes[2]).toBe(0)
    // 只播一次：不寫 NETSCAPE 擴充
    expect(new TextDecoder().decode(bytes).includes('NETSCAPE2.0')).toBe(false)
  })

  it('真透明：GCE 帶透明旗標與「清除」處置', () => {
    const w = 8
    const h = 4
    const px = frame(w, h, 0)
    for (let i = 0; i < 8; i++) px[i * 4 + 3] = 0
    const q = quantizeFrame(px, w, h, 16, 'none', null, true)
    expect(q.transparentIndex).toBe(q.palette.length - 1)
    const asm = new GifAssembler({ width: w, height: h, repeat: 0, global: null, diff: false, tolerance: 0, transparent: true })
    asm.add(q.index, q.palette, q.transparentIndex, 10)
    const bytes = asm.finish()
    const gce = bytes.findIndex((v, i) => v === 0x21 && bytes[i + 1] === 0xf9)
    expect(gce).toBeGreaterThan(0)
    const packed = bytes[gce + 3]
    expect(packed & 1).toBe(1)
    expect((packed >> 2) & 7).toBe(2)
    expect(bytes[gce + 6]).toBe(q.transparentIndex)
  })
})
