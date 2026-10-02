// @vitest-environment node
import { describe, expect, it } from 'vitest'
import exifr from 'exifr'
import {
  TAG,
  buildTiff,
  containsGps,
  crc32,
  extractExif,
  injectExif,
  prepareExifForReencode,
  removeGpsFromTiff,
  removeGpsFromXmp,
  sniffContainer,
  stripMetadata,
  tiffInfo,
  type TiffTag,
} from '@/lib/tools-metadata'

/** 緯度 25°2'1.234"（DMS 有理數）＝ 很好辨認的位元組樣式 */
const LAT = [25, 1, 2, 1, 1234, 1000]
const LON = [121, 1, 33, 1, 52100, 1000]

function makeTiff(littleEndian: boolean, orientation = 6) {
  const ifd0: TiffTag[] = [
    { tag: 0x010f, type: 2, value: 'TestCam' },
    { tag: 0x0110, type: 2, value: 'Model X100' },
    { tag: TAG.orientation, type: 3, value: [orientation] },
    { tag: 0x0131, type: 2, value: 'JayAng Test' },
  ]
  const exif: TiffTag[] = [
    { tag: 0x9003, type: 2, value: '2026:09:30 14:22:05' },
    { tag: 0x829a, type: 5, value: [1, 125] },
    { tag: 0x8827, type: 3, value: [200] },
    { tag: TAG.pixelX, type: 4, value: [4032] },
    { tag: TAG.pixelY, type: 4, value: [3024] },
  ]
  const gps: TiffTag[] = [
    { tag: 0x0000, type: 1 as never, value: [2, 3, 0, 0] },
    { tag: 0x0001, type: 2, value: 'N' },
    { tag: 0x0002, type: 5, value: LAT },
    { tag: 0x0003, type: 2, value: 'E' },
    { tag: 0x0004, type: 5, value: LON },
  ].filter((x) => x.tag !== 0x0000) as TiffTag[]
  return buildTiff(ifd0, { exif, gps, littleEndian })
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0]

/** 組出最小可解析的 JPEG：SOI、APP0、APP1(Exif)、APP1(XMP)、假的 SOS 掃描資料、EOI */
function makeJpeg(tiff: Uint8Array | null, xmp?: string): Uint8Array {
  const parts: number[] = [0xff, 0xd8]
  const app0 = [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  parts.push(0xff, 0xe0, (app0.length + 2) >> 8, (app0.length + 2) & 0xff, ...app0)
  if (tiff) {
    const len = tiff.length + 6 + 2
    parts.push(0xff, 0xe1, len >> 8, len & 0xff, ...EXIF_HEADER, ...tiff)
  }
  if (xmp) {
    const payload = new TextEncoder().encode(`http://ns.adobe.com/xap/1.0/\0${xmp}`)
    const len = payload.length + 2
    parts.push(0xff, 0xe1, len >> 8, len & 0xff, ...payload)
  }
  // DQT（假的，只為了讓結構像真的 JPEG）
  parts.push(0xff, 0xdb, 0, 4, 0, 1)
  // SOS 與掃描資料
  parts.push(0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xff, 0xd9)
  return Uint8Array.from(parts)
}

function scanData(jpeg: Uint8Array) {
  for (let i = 2; i < jpeg.length - 1; i++)
    if (jpeg[i] === 0xff && jpeg[i + 1] === 0xda) return jpeg.slice(i)
  throw new Error('no SOS')
}

/** 在位元組中尋找一段樣式 */
function indexOf(hay: Uint8Array, needle: Uint8Array) {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

function rationalBytes(vals: number[], le: boolean) {
  const out = new Uint8Array(vals.length * 4)
  const dv = new DataView(out.buffer)
  vals.forEach((v, i) => dv.setUint32(i * 4, v, le))
  return out
}

describe.each([
  ['big-endian', false],
  ['little-endian', true],
])('JPEG 只移除 GPS（%s）', (_name, le) => {
  const tiff = makeTiff(le)
  const jpeg = makeJpeg(tiff)

  it('測試素材本身可被 exifr 讀出 GPS', async () => {
    const parsed = await exifr.parse(jpeg, { gps: true, translateValues: false })
    expect(parsed.latitude).toBeCloseTo(25 + 2 / 60 + 1.234 / 3600, 5)
    expect(parsed.longitude).toBeCloseTo(121 + 33 / 60 + 52.1 / 3600, 5)
    expect(containsGps(jpeg)).toBe(true)
  })

  it('移除 GPS 後其他 EXIF 完整保留，GPS 讀不到', async () => {
    const out = stripMetadata(jpeg, 'gps')
    const parsed = await exifr.parse(out, {
      gps: true,
      translateValues: false,
      reviveValues: false,
    })
    expect(parsed.latitude).toBeUndefined()
    expect(parsed.longitude).toBeUndefined()
    expect(parsed.GPSLatitude).toBeUndefined()
    expect(parsed.Make).toBe('TestCam')
    expect(parsed.Model).toBe('Model X100')
    expect(parsed.Software).toBe('JayAng Test')
    expect(parsed.Orientation).toBe(6)
    expect(parsed.DateTimeOriginal).toBe('2026:09:30 14:22:05')
    expect(parsed.ExposureTime).toBeCloseTo(1 / 125)
    expect(parsed.ISO).toBe(200)
    expect(containsGps(out)).toBe(false)
  })

  it('GPS 的位元組真的被清除，而不只是斷開連結', () => {
    const latBytes = rationalBytes(LAT, le)
    expect(indexOf(jpeg, latBytes)).toBeGreaterThan(0)
    const out = stripMetadata(jpeg, 'gps')
    expect(indexOf(out, latBytes)).toBe(-1)
    expect(indexOf(out, rationalBytes(LON, le))).toBe(-1)
  })

  it('不重新壓縮：掃描資料與長度完全不變', () => {
    const out = stripMetadata(jpeg, 'gps')
    expect(out.length).toBe(jpeg.length)
    expect(scanData(out)).toEqual(scanData(jpeg))
  })

  it('TIFF 層級：GPS 指標移除、IFD0 其他項目仍可讀', () => {
    const { tiff: cleaned, removed } = removeGpsFromTiff(tiff)
    expect(removed).toBe(true)
    expect(cleaned.length).toBe(tiff.length)
    const info = tiffInfo(cleaned)
    expect(info.hasGps).toBe(false)
    expect(info.orientation).toBe(6)
    // 原陣列不被修改
    expect(tiffInfo(tiff).hasGps).toBe(true)
  })

  it('全部移除：沒有 EXIF，但保留方向', async () => {
    const out = stripMetadata(jpeg, 'all')
    const parsed = await exifr.parse(out, { gps: true, translateValues: false })
    expect(parsed?.Make).toBeUndefined()
    expect(parsed?.latitude).toBeUndefined()
    expect(parsed?.Orientation).toBe(6)
    expect(containsGps(out)).toBe(false)
    expect(scanData(out)).toEqual(scanData(jpeg))
  })

  it('全部移除：方向為 1 時完全不留 EXIF', () => {
    const out = stripMetadata(makeJpeg(makeTiff(le, 1)), 'all')
    expect(extractExif(out)).toBeNull()
  })
})

describe('XMP 裡的 GPS', () => {
  const xmp =
    '<x:xmpmeta><rdf:Description exif:GPSLatitude="25,2.02N" exif:GPSLongitude="121,33.87E" xmp:Rating="5"><exif:GPSAltitude>12/1</exif:GPSAltitude></rdf:Description></x:xmpmeta>'

  it('removeGpsFromXmp 只拿掉 GPS 屬性與元素', () => {
    const out = removeGpsFromXmp(xmp)
    expect(out).not.toMatch(/GPS/)
    expect(out).toContain('xmp:Rating="5"')
  })

  it('JPEG 的 XMP 區段也會清掉 GPS，其他保留', () => {
    const jpeg = makeJpeg(makeTiff(false), xmp)
    expect(containsGps(jpeg)).toBe(true)
    const out = stripMetadata(jpeg, 'gps')
    expect(containsGps(out)).toBe(false)
    expect(new TextDecoder('latin1').decode(out)).toContain('xmp:Rating="5"')
  })
})

describe('重新編碼時放回 EXIF', () => {
  it('方向改成 1、更新像素寬高、可選擇移除 GPS', async () => {
    const tiff = makeTiff(true)
    const prepared = prepareExifForReencode(tiff, { stripGps: true, w: 800, h: 600 })
    const jpeg = injectExif(makeJpeg(null), prepared, { w: 800, h: 600 })
    expect(sniffContainer(jpeg)).toBe('jpeg')
    const parsed = await exifr.parse(jpeg, { gps: true, translateValues: false })
    expect(parsed.Orientation).toBe(1)
    expect(parsed.ExifImageWidth).toBe(800)
    expect(parsed.ExifImageHeight).toBe(600)
    expect(parsed.Make).toBe('TestCam')
    expect(parsed.latitude).toBeUndefined()
  })

  it('PNG：放入 eXIf 區塊並能只移除 GPS', async () => {
    const png = makePng()
    const withExif = injectExif(png, makeTiff(false), { w: 1, h: 1 })
    expect(containsGps(withExif)).toBe(true)
    const parsed = await exifr.parse(withExif, { gps: true, translateValues: false })
    expect(parsed.Make).toBe('TestCam')
    const out = stripMetadata(withExif, 'gps')
    expect(containsGps(out)).toBe(false)
    const after = await exifr.parse(out, { gps: true, translateValues: false })
    expect(after.Make).toBe('TestCam')
    expect(after.latitude).toBeUndefined()
    const none = stripMetadata(withExif, 'all')
    expect(extractExif(none)).toBeNull()
  })

  it('WebP：簡單格式升級成 VP8X 並放入 EXIF，可移除', () => {
    const webp = makeWebp()
    const withExif = injectExif(webp, makeTiff(true), { w: 1, h: 1 })
    expect(sniffContainer(withExif)).toBe('webp')
    expect(String.fromCharCode(...withExif.subarray(12, 16))).toBe('VP8X')
    expect(withExif[20] & 0x08).toBe(0x08)
    expect(containsGps(withExif)).toBe(true)
    const tiff = extractExif(stripMetadata(withExif, 'gps'))
    expect(tiff && tiffInfo(tiff).hasGps).toBe(false)
    expect(extractExif(stripMetadata(withExif, 'all'))).toBeNull()
  })
})

/** 1×1 PNG（只有結構正確，IDAT 內容不需真的解得開） */
function makePng() {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const chunk = (type: string, data: number[]) => {
    const body = Uint8Array.from([...type].map((c) => c.charCodeAt(0)).concat(data))
    const c = crc32(body)
    const len = data.length
    return [
      len >>> 24,
      (len >>> 16) & 255,
      (len >>> 8) & 255,
      len & 255,
      ...body,
      c >>> 24,
      (c >>> 16) & 255,
      (c >>> 8) & 255,
      c & 255,
    ]
  }
  return Uint8Array.from([
    ...sig,
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...chunk('IDAT', [0x78, 0x9c, 0x63, 0, 0, 0, 2, 0, 1]),
    ...chunk('IEND', []),
  ])
}

/** 最小 VP8L WebP 結構 */
function makeWebp() {
  const vp8l = [0x2f, 0, 0, 0, 0x10, 0, 0, 0]
  const size = 4 + 8 + vp8l.length
  return Uint8Array.from([
    0x52,
    0x49,
    0x46,
    0x46,
    size & 255,
    0,
    0,
    0,
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x4c,
    vp8l.length,
    0,
    0,
    0,
    ...vp8l,
  ])
}
