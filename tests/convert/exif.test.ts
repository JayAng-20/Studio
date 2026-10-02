// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  crc32,
  extractExif,
  hasGps,
  insertExifJpeg,
  insertExifPng,
  insertExifWebp,
  isTiff,
  readOrientation,
  sanitizeTiff,
  TAG,
} from '@/lib/convert-exif'
import { ascii, buildHeic, buildJpeg, buildPng, buildTiff, buildWebpExtended, buildWebpLossless } from './fixtures'

const blob = (b: Uint8Array) => new Blob([b as Uint8Array<ArrayBuffer>])
const u16 = (t: Uint8Array, o: number) => new DataView(t.buffer, t.byteOffset).getUint16(o, true)
const u32 = (t: Uint8Array, o: number) => new DataView(t.buffer, t.byteOffset).getUint32(o, true)

describe('EXIF 擷取', () => {
  const tiff = buildTiff()

  it('TIFF 素材本身', () => {
    expect(isTiff(tiff)).toBe(true)
    expect(readOrientation(tiff)).toBe(6)
    expect(hasGps(tiff)).toBe(true)
  })

  it('JPEG（APP1）', async () => {
    expect([...((await extractExif(blob(buildJpeg({ tiff })))) ?? [])]).toEqual([...tiff])
    expect(await extractExif(blob(buildJpeg()))).toBeNull()
  })

  it('PNG（eXIf）', async () => {
    expect([...((await extractExif(blob(buildPng({ tiff })))) ?? [])]).toEqual([...tiff])
    expect(await extractExif(blob(buildPng()))).toBeNull()
  })

  it('HEIC（meta → iinf → iloc → mdat）', async () => {
    expect([...((await extractExif(blob(buildHeic({ tiff })))) ?? [])]).toEqual([...tiff])
  })

  it('不認得的格式回傳 null', async () => {
    expect(await extractExif(blob(new Uint8Array(64)))).toBeNull()
  })
})

describe('EXIF 清理', () => {
  const tiff = buildTiff()

  it('方向重設為 1，不改動原本的陣列', () => {
    const out = sanitizeTiff(tiff, { resetOrientation: true })
    expect(readOrientation(out)).toBe(1)
    expect(readOrientation(tiff)).toBe(6)
  })

  it('更新 PixelX／PixelYDimension（LONG 與 SHORT）', () => {
    const out = sanitizeTiff(tiff, { pixelSize: { width: 1920, height: 1440 } })
    expect(u16(out, 52)).toBe(TAG.pixelX)
    expect(u32(out, 60)).toBe(1920)
    expect(u16(out, 64)).toBe(TAG.pixelY)
    expect(u16(out, 72)).toBe(1440)
  })

  it('移除 GPS：刪除指標、清除 GPS 資料位元組、保留其他欄位與下一個 IFD', () => {
    const out = sanitizeTiff(tiff, { dropGps: true })
    expect(hasGps(out)).toBe(false)
    expect(u16(out, 8)).toBe(2)
    expect(u16(out, 10)).toBe(TAG.orientation)
    expect(u16(out, 22)).toBe(TAG.exifIfd)
    expect(u32(out, 10 + 2 * 12)).toBe(134) // 下一個 IFD 指標往前移
    expect([...out.subarray(80, 134)].every((b) => b === 0)).toBe(true)
    // 緯度資料不再出現在檔案中
    expect(readOrientation(out)).toBe(6)
  })

  it('移除縮圖參照', () => {
    const out = sanitizeTiff(tiff, { dropThumbnail: true, dropGps: true })
    expect(u32(out, 10 + 2 * 12)).toBe(0)
  })

  it('大端序也能處理', () => {
    const be = new Uint8Array([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 8, 0, 0, 0, 0, 0, 0])
    expect(readOrientation(be)).toBe(8)
    expect(readOrientation(sanitizeTiff(be, { resetOrientation: true }))).toBe(1)
  })

  it('無效資料', () => {
    expect(() => sanitizeTiff(new Uint8Array([1, 2, 3]), {})).toThrow()
    expect(readOrientation(null)).toBe(1)
  })
})

describe('EXIF 寫回', () => {
  const tiff = sanitizeTiff(buildTiff(), { resetOrientation: true, dropGps: true })

  it('JPEG：APP1 緊接 SOI，保留其他區段，可再讀回', async () => {
    const src = buildJpeg()
    const out = insertExifJpeg(src, tiff)
    expect([out[0], out[1], out[2], out[3]]).toEqual([0xff, 0xd8, 0xff, 0xe1])
    expect(String.fromCharCode(...out.subarray(6, 10))).toBe('Exif')
    expect(out.length).toBe(src.length + 2 + 2 + 6 + tiff.length)
    expect([...((await extractExif(blob(out))) ?? [])]).toEqual([...tiff])
    // JFIF 區段仍在
    expect(String.fromCharCode(...out.subarray(out.indexOf(0xe0) + 3, out.indexOf(0xe0) + 7))).toBe('JFIF')
    // 再寫一次只會有一個 Exif APP1
    const twice = insertExifJpeg(out, tiff)
    expect(twice.length).toBe(out.length)
  })

  it('JPEG：超過 64 KB 丟出 RangeError', () => {
    const big = new Uint8Array(70_000)
    big.set(tiff)
    expect(() => insertExifJpeg(buildJpeg(), big)).toThrow(RangeError)
  })

  it('PNG：eXIf 在 IHDR 之後、CRC 正確、可再讀回、取代舊的', async () => {
    const out = insertExifPng(buildPng({ tiff: buildTiff() }), tiff)
    // 8（簽章）＋ IHDR（25）之後就是 eXIf
    expect(String.fromCharCode(...out.subarray(8 + 25 + 4, 8 + 25 + 8))).toBe('eXIf')
    const len = new DataView(out.buffer).getUint32(8 + 25)
    const crc = new DataView(out.buffer).getUint32(8 + 25 + 8 + len)
    expect(crc).toBe(crc32(out, 8 + 25 + 4, 8 + 25 + 8 + len))
    expect([...((await extractExif(blob(out))) ?? [])]).toEqual([...tiff])
    expect(out.filter((_, i) => String.fromCharCode(...out.subarray(i, i + 4)) === 'eXIf').length).toBe(1)
  })

  it('WebP 簡單格式（VP8L）：轉成 VP8X、帶 EXIF 與 alpha 旗標', async () => {
    const out = insertExifWebp(buildWebpLossless(300, 200, true), tiff)
    const v = new DataView(out.buffer)
    expect(String.fromCharCode(...out.subarray(12, 16))).toBe('VP8X')
    expect(out[20]).toBe(0x08 | 0x10)
    expect(out[24] | (out[25] << 8) | (out[26] << 16)).toBe(299)
    expect(out[27] | (out[28] << 8) | (out[29] << 16)).toBe(199)
    expect(v.getUint32(4, true)).toBe(out.length - 8)
    expect([...((await extractExif(blob(out))) ?? [])]).toEqual([...tiff])
    // 沒有 alpha 的 VP8L
    expect(insertExifWebp(buildWebpLossless(10, 10, false), tiff)[20]).toBe(0x08)
  })

  it('WebP 延伸格式：只加上 EXIF 旗標', () => {
    const out = insertExifWebp(buildWebpExtended(64, 64, 0x10), tiff)
    expect(out[20]).toBe(0x18)
    expect(ascii('EXIF').every((c, i) => out[out.length - (tiff.length + (tiff.length & 1)) - 8 + i] === c)).toBe(true)
  })
})
