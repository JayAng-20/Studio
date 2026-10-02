// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { unzlibSync } from 'fflate'
import {
  createPngEncoder,
  crc32,
  inspectPng,
  makeChunk,
  type PngFilter,
} from '@/features/pdf/lib/png'
import { groupPages, planLongImage, scaleForWidth } from '@/features/pdf/lib/longImage'

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** 簡易 PNG 解碼器（只支援 8 位元 RGB／RGBA、非交錯），用來驗證編碼結果 */
function decodePng(bytes: Uint8Array) {
  const info = inspectPng(bytes)
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const idat: Uint8Array[] = []
  let off = 8
  while (off < bytes.length) {
    const len = v.getUint32(off)
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8))
    if (type === 'IDAT') idat.push(bytes.subarray(off + 8, off + 8 + len))
    off += 12 + len
  }
  const raw = unzlibSync(concat(idat))
  const bpp = info.colorType === 6 ? 4 : 3
  const stride = info.width * bpp
  expect(raw.length).toBe((stride + 1) * info.height)
  const out = new Uint8Array(stride * info.height)
  for (let y = 0; y < info.height; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0
      const b = y > 0 ? out[(y - 1) * stride + i] : 0
      const c = y > 0 && i >= bpp ? out[(y - 1) * stride + i - bpp] : 0
      let pred = 0
      if (f === 1) pred = a
      else if (f === 2) pred = b
      else if (f === 3) pred = (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[y * stride + i] = (line[i] + pred) & 0xff
    }
  }
  return { ...info, pixels: out, bpp }
}

/** 產生測試像素：位置相關的圖樣 */
const pattern = (w: number, h: number) => {
  const d = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      d[i] = (x * 37 + y) & 255
      d[i + 1] = (y * 11) & 255
      d[i + 2] = (x ^ y) & 255
      d[i + 3] = (x + y * 3) & 255
    }
  return d
}

describe('CRC32', () => {
  it('已知值', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
  it('IEND chunk 的 CRC 與規範一致', () => {
    const c = makeChunk('IEND', new Uint8Array(0))
    expect(Array.from(c.subarray(8))).toEqual([0xae, 0x42, 0x60, 0x82])
  })
})

describe('串流 PNG 編碼器', () => {
  for (const filter of ['none', 'sub', 'paeth'] as PngFilter[]) {
    for (const alpha of [false, true]) {
      it(`${filter} 篩選、${alpha ? 'RGBA' : 'RGB'}：可解碼且像素一致`, async () => {
        const w = 37
        const h = 23
        const src = pattern(w, h)
        const enc = createPngEncoder({ width: w, height: h, alpha, filter, idatSize: 64 })
        enc.writeRows(src, h)
        const png = concat(await enc.finish())
        const d = decodePng(png)
        expect(d.ok).toBe(true)
        expect(d.width).toBe(w)
        expect(d.height).toBe(h)
        expect(d.colorType).toBe(alpha ? 6 : 2)
        for (let i = 0; i < w * h; i++) {
          for (let k = 0; k < d.bpp; k++) expect(d.pixels[i * d.bpp + k]).toBe(src[i * 4 + k])
        }
      })
    }
  }

  it('壓縮資料分成多個 IDAT，各自 CRC 正確', async () => {
    const w = 300
    const h = 300
    const enc = createPngEncoder({ width: w, height: h, alpha: true, idatSize: 1024 })
    enc.writeRows(pattern(w, h), h)
    const d = decodePng(concat(await enc.finish()))
    expect(d.ok).toBe(true)
    expect(d.chunks.filter((c) => c.type === 'IDAT').length).toBeGreaterThan(1)
    expect(d.chunks.every((c) => c.crcOk)).toBe(true)
  })

  it('沒有 CompressionStream 時的後備路徑（stored）也能解碼', async () => {
    const w = 50
    const h = 40
    const src = pattern(w, h)
    const enc = createPngEncoder({ width: w, height: h, alpha: true, forceFallback: true })
    enc.writeRows(src, h)
    const d = decodePng(concat(await enc.finish()))
    expect(d.ok).toBe(true)
    expect(Array.from(d.pixels.subarray(0, 8))).toEqual(Array.from(src.subarray(0, 8)))
  })

  it('高度超過 65535 px 仍正確', async () => {
    const w = 3
    const h = 70_001
    // 自適應篩選＋原生 Deflate（這組資料曾讓 fflate 串流壓縮出錯，作為回歸測試）
    const enc = createPngEncoder({ width: w, height: h, alpha: false })
    const row = new Uint8Array(w * 4)
    for (let y = 0; y < h; y++) {
      row[0] = y & 255
      row[1] = (y >> 8) & 255
      row[2] = (y >> 16) & 255
      row[4] = 200
      row[8] = 255 - (y & 255)
      enc.writeRow(row)
    }
    const png = concat(await enc.finish())
    const d = decodePng(png)
    expect(d.ok).toBe(true)
    expect(d.height).toBe(70_001)
    for (const y of [0, 1, 65535, 65536, 70_000]) {
      const o = y * w * 3
      expect(d.pixels[o]).toBe(y & 255)
      expect(d.pixels[o + 1]).toBe((y >> 8) & 255)
      expect(d.pixels[o + 2]).toBe((y >> 16) & 255)
      expect(d.pixels[o + 3]).toBe(200)
      expect(d.pixels[o + 6]).toBe(255 - (y & 255))
    }
  })

  it('列數不符時拒絕結束；超過高度時拒絕寫入', async () => {
    const enc = createPngEncoder({ width: 2, height: 2, alpha: false })
    enc.writeRow(new Uint8Array(8))
    await expect(enc.finish()).rejects.toThrow()
    const e2 = createPngEncoder({ width: 1, height: 1, alpha: false })
    e2.writeRow(new Uint8Array(4))
    expect(() => e2.writeRow(new Uint8Array(4))).toThrow()
  })

  it('無效尺寸', () => {
    expect(() => createPngEncoder({ width: 0, height: 1, alpha: false })).toThrow()
  })

  it('檢查器能發現 CRC 錯誤', async () => {
    const enc = createPngEncoder({ width: 2, height: 2, alpha: false })
    enc.writeRows(new Uint8Array(16), 2)
    const png = concat(await enc.finish())
    expect(inspectPng(png).ok).toBe(true)
    png[png.length - 20] ^= 0xff
    expect(inspectPng(png).ok).toBe(false)
  })
})

describe('長圖版面', () => {
  const sizes = [
    { w: 100, h: 200 },
    { w: 200, h: 100 },
    { w: 100, h: 200 },
  ]
  it('以最寬的頁為寬度，置中並加上間距', () => {
    const l = planLongImage(sizes, [1, 2, 3], {
      scale: 2,
      gap: 10,
      align: 'center',
      separator: false,
    })
    expect(l.width).toBe(400)
    expect(l.height).toBe(400 + 200 + 400 + 20)
    expect(l.pages.map((p) => [p.x, p.y])).toEqual([
      [100, 0],
      [0, 410],
      [100, 620],
    ])
    expect(l.lines).toEqual([])
  })
  it('靠左對齊與分隔線（落在間距中央）', () => {
    const l = planLongImage(sizes, [1, 3], { scale: 1, gap: 9, align: 'left', separator: true })
    expect(l.pages.map((p) => p.x)).toEqual([0, 0])
    expect(l.lines).toEqual([{ y: 204, h: 1 }])
    expect(l.height).toBe(409)
  })
  it('間距 0 但有分隔線時，至少留出線的高度', () => {
    const l = planLongImage(sizes, [1, 3], { scale: 4, gap: 0, align: 'left', separator: true })
    expect(l.lines[0].h).toBe(2)
    expect(l.height).toBe(800 + 2 + 800)
  })
  it('輸出寬度換算縮放', () => {
    expect(scaleForWidth(sizes, [1, 2], 1000)).toBe(5)
  })
  it('每 N 頁一組', () => {
    expect(groupPages([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(groupPages([1, 2], 0)).toEqual([[1, 2]])
  })
})
