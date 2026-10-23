/** 測試素材：以程式組出最小但合法的 TIFF／JPEG／PNG／WebP／HEIC／GIF 位元組 */
import { crc32 } from '@/lib/convert-exif'

export const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

export function concat(...parts: Array<Uint8Array | number[]>): Uint8Array {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)))
  const out = new Uint8Array(arrs.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of arrs) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const u16le = (v: number) => [v & 255, (v >> 8) & 255]
const u32le = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]
const u16be = (v: number) => [(v >> 8) & 255, v & 255]
const u32be = (v: number) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]

/**
 * 小端序 TIFF：IFD0（Orientation=6、ExifIFD、GPS）→ IFD1（縮圖）
 * 位置：IFD0@8、Exif@50、GPS@80、GPS 資料@110、IFD1@134，總長 152
 */
export function buildTiff(orientation = 6): Uint8Array {
  const t = new Uint8Array(152)
  const v = new DataView(t.buffer)
  t.set([0x49, 0x49, 0x2a, 0])
  v.setUint32(4, 8, true)
  const entry = (
    at: number,
    tag: number,
    type: number,
    count: number,
    value: number,
    short = false,
  ) => {
    v.setUint16(at, tag, true)
    v.setUint16(at + 2, type, true)
    v.setUint32(at + 4, count, true)
    if (short) v.setUint16(at + 8, value, true)
    else v.setUint32(at + 8, value, true)
  }
  // IFD0
  v.setUint16(8, 3, true)
  entry(10, 0x0112, 3, 1, orientation, true)
  entry(22, 0x8769, 4, 1, 50)
  entry(34, 0x8825, 4, 1, 80)
  v.setUint32(46, 134, true)
  // Exif IFD
  v.setUint16(50, 2, true)
  entry(52, 0xa002, 4, 1, 4032)
  entry(64, 0xa003, 3, 1, 3024, true)
  v.setUint32(76, 0, true)
  // GPS IFD
  v.setUint16(80, 2, true)
  entry(82, 0x0001, 2, 2, 0)
  t.set(ascii('N\0'), 90)
  entry(94, 0x0002, 5, 3, 110)
  v.setUint32(106, 0, true)
  // GPS 緯度（3 個 RATIONAL）
  ;[25, 1, 2, 1, 3, 1].forEach((n, i) => v.setUint32(110 + i * 4, n, true))
  // IFD1
  v.setUint16(134, 1, true)
  entry(136, 0x0103, 3, 1, 6, true)
  v.setUint32(148, 0, true)
  return t
}

/** 最小 JPEG：SOI、APP0（JFIF）、[APP1 Exif]、DQT、SOF0、SOS、資料、EOI */
export function buildJpeg(
  opts: { width?: number; height?: number; tiff?: Uint8Array } = {},
): Uint8Array {
  const { width = 640, height = 480, tiff } = opts
  const app0 = [0xff, 0xe0, ...u16be(16), ...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]
  const app1 = tiff
    ? [0xff, 0xe1, ...u16be(2 + 6 + tiff.length), ...ascii('Exif\0\0'), ...tiff]
    : []
  const dqt = [0xff, 0xdb, ...u16be(4), 0, 1]
  const sof = [
    0xff,
    0xc0,
    ...u16be(17),
    8,
    ...u16be(height),
    ...u16be(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]
  const sos = [0xff, 0xda, ...u16be(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]
  return concat([0xff, 0xd8], app0, app1, dqt, sof, sos, [1, 2, 3, 4, 5], [0xff, 0xd9])
}

function pngChunk(type: string, data: number[] | Uint8Array): Uint8Array {
  const body = concat(ascii(type), data)
  return concat(u32be(body.length - 4), body, u32be(crc32(body)))
}

/** 最小 PNG：簽章、IHDR、[acTL]、[eXIf]、IDAT、IEND */
export function buildPng(
  opts: {
    width?: number
    height?: number
    colorType?: number
    apngFrames?: number
    tiff?: Uint8Array
  } = {},
) {
  const { width = 32, height = 16, colorType = 6, apngFrames, tiff } = opts
  return concat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk('IHDR', [...u32be(width), ...u32be(height), 8, colorType, 0, 0, 0]),
    apngFrames ? pngChunk('acTL', [...u32be(apngFrames), ...u32be(0)]) : [],
    tiff ? pngChunk('eXIf', tiff) : [],
    pngChunk('IDAT', [8, 29, 1, 2]),
    pngChunk('IEND', []),
  )
}

function riffChunk(type: string, data: number[] | Uint8Array): Uint8Array {
  const d = data instanceof Uint8Array ? data : new Uint8Array(data)
  return concat(ascii(type), u32le(d.length), d, d.length & 1 ? [0] : [])
}

export function riff(chunks: Uint8Array[]): Uint8Array {
  const body = concat(ascii('WEBP'), ...chunks)
  return concat(ascii('RIFF'), u32le(body.length), body)
}

/** 簡單格式 VP8L（無損） */
export function buildWebpLossless(width: number, height: number, alpha: boolean): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28)
  return riff([riffChunk('VP8L', [0x2f, ...u32le(bits >>> 0), 0, 0])])
}

/** 延伸格式 VP8X（可標示動畫與 alpha） */
export function buildWebpExtended(
  width: number,
  height: number,
  flags: number,
  frames = 0,
): Uint8Array {
  const vp8x = [
    flags,
    0,
    0,
    0,
    (width - 1) & 255,
    ((width - 1) >> 8) & 255,
    ((width - 1) >> 16) & 255,
    (height - 1) & 255,
    ((height - 1) >> 8) & 255,
    ((height - 1) >> 16) & 255,
  ]
  const anmf = Array.from({ length: frames }, () => riffChunk('ANMF', new Array(16).fill(0)))
  return riff([
    riffChunk('VP8X', vp8x),
    ...(frames ? [riffChunk('ANIM', [0, 0, 0, 0, 0, 0])] : []),
    ...anmf,
    ...(frames ? [] : [riffChunk('VP8L', [0x2f, 0, 0, 0, 0])]),
  ])
}

function box(type: string, ...parts: Array<Uint8Array | number[]>): Uint8Array {
  const body = concat(...parts)
  return concat(u32be(8 + body.length), ascii(type), body)
}
const fullBox = (type: string, version: number, ...parts: Array<Uint8Array | number[]>) =>
  box(type, [version, 0, 0, 0], ...parts)

/** 最小 HEIC：ftyp、meta（hdlr、iinf/infe Exif、iloc、iprp/ipco/ispe［、irot］）、mdat */
export function buildHeic(
  opts: {
    tiff?: Uint8Array
    sizes?: Array<[number, number]>
    rotate?: boolean
    brand?: string
  } = {},
) {
  const {
    tiff = buildTiff(),
    sizes = [
      [4032, 3024],
      [512, 512],
    ],
    rotate = false,
    brand = 'heic',
  } = opts
  const payload = concat(u32be(6), ascii('Exif\0\0'), tiff)
  const ftyp = box('ftyp', ascii(brand), u32be(0), ascii('mif1'), ascii(brand))
  const hdlr = fullBox('hdlr', 0, u32be(0), ascii('pict'), new Array(12).fill(0), [0])
  const infe = fullBox('infe', 2, u16be(7), u16be(0), ascii('Exif'), [0])
  const iinf = fullBox('iinf', 0, u16be(1), infe)
  const ipco = box(
    'ipco',
    ...sizes.map(([w, h]) => fullBox('ispe', 0, u32be(w), u32be(h))),
    rotate ? box('irot', [1]) : [],
  )
  const iprp = box('iprp', ipco)
  const ilocFor = (offset: number) =>
    fullBox(
      'iloc',
      0,
      [0x44, 0x00],
      u16be(1),
      u16be(7),
      u16be(0),
      u16be(1),
      u32be(offset),
      u32be(payload.length),
    )
  const metaFor = (offset: number) => fullBox('meta', 0, hdlr, iinf, ilocFor(offset), iprp)
  const before = ftyp.length + metaFor(0).length + 8
  return concat(ftyp, metaFor(before), box('mdat', payload))
}

/** 兩格的動態 GIF（第一格透明） */
export function buildGif(frames = 2): Uint8Array {
  const header = [...ascii('GIF89a'), ...u16le(10), ...u16le(8), 0x80, 0, 0, 0, 0, 0, 255, 255, 255]
  const frame = (transparent: boolean) => [
    0x21,
    0xf9,
    4,
    transparent ? 1 : 0,
    10,
    0,
    0,
    0,
    0x2c,
    0,
    0,
    0,
    0,
    ...u16le(10),
    ...u16le(8),
    0,
    2,
    2,
    0x4c,
    0x01,
    0,
  ]
  const body: number[] = []
  for (let i = 0; i < frames; i++) body.push(...frame(i === 0))
  return concat(header, body, [0x3b])
}
