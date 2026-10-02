// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { GIFEncoder, applyPalette } from 'gifenc'
import { compositeGif, parseGif } from '@/features/convert/lib/gifDecode'
import { extractFrameChunks, muxAnimatedWebp } from '@/features/convert/lib/webpMux'
import { probeBytes } from '@/features/convert/lib/probe'
import { buildWebpExtended, buildWebpLossless } from './fixtures'

const RED = [255, 0, 0]
const GREEN = [0, 200, 0]
const BLUE = [0, 0, 255]

function solid(w: number, h: number, rgb: number[], alpha = 255) {
  const d = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) d.set([...rgb, alpha], i * 4)
  return d
}

describe('GIF 解碼（JS 備援）', () => {
  it('與 gifenc 來回：尺寸、格數、延遲、循環、像素', () => {
    const w = 8
    const h = 6
    const enc = GIFEncoder()
    const palette = [RED, GREEN, BLUE, [255, 255, 255]]
    ;[RED, GREEN, BLUE].forEach((c, i) => {
      const rgba = solid(w, h, c)
      enc.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay: 100 + i * 50, repeat: 0 })
    })
    enc.finish()
    const gif = parseGif(enc.bytes())
    expect(gif).toMatchObject({ width: 8, height: 6, loop: 0 })
    expect(gif.frames.map((f) => f.delay)).toEqual([100, 150, 200])
    const colors = [...compositeGif(gif)].map((f) => [...f.rgba.slice(0, 4)])
    // 生成器會覆寫同一個緩衝區，所以逐格取值
    const seen: number[][] = []
    for (const f of compositeGif(gif)) seen.push([...f.rgba.slice(0, 4)])
    expect(seen).toEqual([
      [...RED, 255],
      [...GREEN, 255],
      [...BLUE, 255],
    ])
    expect(colors.length).toBe(3)
    expect(probeBytes(enc.bytes())).toMatchObject({ format: 'gif', frames: 3, animated: true })
  })

  it('大量色彩與長資料（觸發碼長成長與清除碼）', () => {
    const w = 96
    const h = 96
    const palette: number[][] = []
    for (let i = 0; i < 256; i++) palette.push([i, (i * 7) & 255, (i * 13) & 255])
    const idx = new Uint8Array(w * h)
    let seed = 7
    for (let i = 0; i < idx.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      idx[i] = seed & 255
    }
    const enc = GIFEncoder()
    enc.writeFrame(idx, w, h, { palette })
    enc.writeFrame(idx.map((v) => 255 - v), w, h, { palette })
    enc.finish()
    const gif = parseGif(enc.bytes())
    const frames: Uint8ClampedArray[] = []
    for (const f of compositeGif(gif)) frames.push(f.rgba.slice())
    for (const k of [0, 1, 777, 5000, w * h - 1]) {
      const v = idx[k]
      expect([...frames[0].slice(k * 4, k * 4 + 3)]).toEqual(palette[v])
      expect([...frames[1].slice(k * 4, k * 4 + 3)]).toEqual(palette[255 - v])
    }
  })

  it('透明＋處置方式：不處置時保留上一格，處置為背景時清除', () => {
    const w = 4
    const h = 2
    const palette = [RED, GREEN, [0, 0, 0]]
    const enc = GIFEncoder()
    enc.writeFrame(new Uint8Array(w * h).fill(0), w, h, { palette, dispose: 1 })
    // 第二格：左半透明（索引 2），右半綠色
    const f2 = new Uint8Array([2, 2, 1, 1, 2, 2, 1, 1])
    enc.writeFrame(f2, w, h, { palette, transparent: true, transparentIndex: 2, dispose: 2 })
    enc.writeFrame(new Uint8Array(w * h).fill(2), w, h, { palette, transparent: true, transparentIndex: 2 })
    enc.finish()
    const out: number[][] = []
    for (const f of compositeGif(parseGif(enc.bytes()))) out.push([...f.rgba])
    expect(out[1].slice(0, 4)).toEqual([...RED, 255]) // 透明處透出上一格
    expect(out[1].slice(8, 12)).toEqual([...GREEN, 255])
    expect(out[2].slice(0, 4)).toEqual([0, 0, 0, 0]) // 第二格處置為背景 → 第三格全透明
  })
})

describe('動態 WebP 封裝', () => {
  it('取出單張影像 chunk（簡單與延伸格式）', () => {
    const a = extractFrameChunks(buildWebpLossless(30, 20, true))
    expect(a).toMatchObject({ width: 30, height: 20, alpha: true })
    expect(String.fromCharCode(...a.chunks.subarray(0, 4))).toBe('VP8L')
    const b = extractFrameChunks(buildWebpExtended(64, 48, 0x10))
    expect(b).toMatchObject({ width: 64, height: 48, alpha: true })
  })

  it('VP8X 動畫旗標、ANIM 循環、ANMF 尺寸與時間、RIFF 大小', () => {
    const f = extractFrameChunks(buildWebpLossless(30, 20, false))
    const out = muxAnimatedWebp(
      [
        { ...f, duration: 120 },
        { ...f, duration: 80 },
      ],
      { width: 30, height: 20, loop: 3 },
    )
    const v = new DataView(out.buffer)
    const s = (o: number) => String.fromCharCode(...out.subarray(o, o + 4))
    expect(s(0)).toBe('RIFF')
    expect(v.getUint32(4, true)).toBe(out.length - 8)
    expect(s(8)).toBe('WEBP')
    expect(s(12)).toBe('VP8X')
    expect(out[20] & 0x02).toBe(0x02)
    expect(s(30)).toBe('ANIM')
    expect(v.getUint16(38 + 4, true)).toBe(3)
    const anmf = 44
    expect(s(anmf)).toBe('ANMF')
    const d = anmf + 8
    expect(out[d + 6] | (out[d + 7] << 8)).toBe(29)
    expect(out[d + 9] | (out[d + 10] << 8)).toBe(19)
    expect(out[d + 12] | (out[d + 13] << 8)).toBe(120)
    expect(probeBytes(out)).toMatchObject({ format: 'webp', width: 30, height: 20, animated: true, frames: 2 })
  })

  it('沒有影格時丟出錯誤', () => {
    expect(() => muxAnimatedWebp([], { width: 1, height: 1 })).toThrow()
  })
})
