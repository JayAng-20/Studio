/**
 * 圖片中繼資料（EXIF／XMP）的位元組層級處理，純函式、不依賴 DOM。
 *
 * 重點：「只移除 GPS」是**就地**修改 TIFF：把 IFD0 的 GPSInfo 指標拿掉、把 GPS IFD 與它的資料
 * 全部歸零。其他標籤、MakerNote（常用絕對位移）位置都不變，所以其餘 EXIF 原封保留；
 * 而且 GPS 的位元組真的被清掉，不只是斷開連結。
 *
 * 支援容器：JPEG（APP1 Exif／XMP）、PNG（eXIf、iTXt XMP）、WebP（EXIF／XMP 區塊）。
 */

export type MetaContainer = 'jpeg' | 'png' | 'webp'

export const TAG = {
  orientation: 0x0112,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  interopIfd: 0xa005,
  pixelX: 0xa002,
  pixelY: 0xa003,
  thumbOffset: 0x0201,
  thumbLength: 0x0202,
  stripOffsets: 0x0111,
  stripByteCounts: 0x0117,
} as const

const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
}

export class MetadataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetadataError'
  }
}

// ───────────────────────── TIFF ─────────────────────────

interface Tiff {
  b: Uint8Array
  le: boolean
}

function openTiff(b: Uint8Array): Tiff {
  if (b.length < 8) throw new MetadataError('TIFF 太短')
  const le = b[0] === 0x49 && b[1] === 0x49
  const be = b[0] === 0x4d && b[1] === 0x4d
  if (!le && !be) throw new MetadataError('不是 TIFF')
  const t = { b, le }
  if (u16(t, 2) !== 42) throw new MetadataError('TIFF 標記錯誤')
  return t
}

function u16(t: Tiff, o: number): number {
  if (o < 0 || o + 2 > t.b.length) throw new MetadataError('超出範圍')
  return t.le ? t.b[o] | (t.b[o + 1] << 8) : (t.b[o] << 8) | t.b[o + 1]
}
function u32(t: Tiff, o: number): number {
  if (o < 0 || o + 4 > t.b.length) throw new MetadataError('超出範圍')
  return t.le
    ? (t.b[o] | (t.b[o + 1] << 8) | (t.b[o + 2] << 16) | (t.b[o + 3] << 24)) >>> 0
    : ((t.b[o] << 24) | (t.b[o + 1] << 16) | (t.b[o + 2] << 8) | t.b[o + 3]) >>> 0
}
function w16(t: Tiff, o: number, v: number) {
  if (t.le) {
    t.b[o] = v & 0xff
    t.b[o + 1] = (v >> 8) & 0xff
  } else {
    t.b[o] = (v >> 8) & 0xff
    t.b[o + 1] = v & 0xff
  }
}
function w32(t: Tiff, o: number, v: number) {
  if (t.le) {
    t.b[o] = v & 0xff
    t.b[o + 1] = (v >>> 8) & 0xff
    t.b[o + 2] = (v >>> 16) & 0xff
    t.b[o + 3] = (v >>> 24) & 0xff
  } else {
    t.b[o] = (v >>> 24) & 0xff
    t.b[o + 1] = (v >>> 16) & 0xff
    t.b[o + 2] = (v >>> 8) & 0xff
    t.b[o + 3] = v & 0xff
  }
}

interface IfdEntry {
  tag: number
  type: number
  count: number
  /** 這筆 entry 在 TIFF 中的位置 */
  pos: number
  /** 值所在位置（≤ 4 bytes 時就在 entry 內） */
  dataPos: number
  dataSize: number
  inline: boolean
}

interface Ifd {
  pos: number
  count: number
  entries: IfdEntry[]
  nextPos: number
  next: number
}

function readIfd(t: Tiff, pos: number): Ifd {
  const count = u16(t, pos)
  if (count > 4096) throw new MetadataError('IFD 項目過多')
  const entries: IfdEntry[] = []
  for (let i = 0; i < count; i++) {
    const p = pos + 2 + i * 12
    const tag = u16(t, p)
    const type = u16(t, p + 2)
    const cnt = u32(t, p + 4)
    const size = (TYPE_SIZE[type] ?? 1) * cnt
    const inline = size <= 4
    entries.push({
      tag,
      type,
      count: cnt,
      pos: p,
      dataPos: inline ? p + 8 : u32(t, p + 8),
      dataSize: size,
      inline,
    })
  }
  const nextPos = pos + 2 + count * 12
  return { pos, count, entries, nextPos, next: u32(t, nextPos) }
}

const findEntry = (ifd: Ifd, tag: number) => ifd.entries.find((e) => e.tag === tag)

function zero(t: Tiff, start: number, len: number) {
  const s = Math.max(0, start)
  const e = Math.min(t.b.length, start + len)
  if (e > s) t.b.fill(0, s, e)
}

/** 把一個 IFD（含所有外部資料）歸零 */
function zeroIfd(t: Tiff, ifd: Ifd) {
  for (const e of ifd.entries) if (!e.inline) zero(t, e.dataPos, e.dataSize)
  zero(t, ifd.pos, 2 + ifd.count * 12 + 4)
}

/** 從 IFD 就地移除一筆 entry：後面的 entry 往前移，next 指標跟著移，多出的 12 bytes 歸零 */
function removeEntry(t: Tiff, ifd: Ifd, tag: number): boolean {
  const idx = ifd.entries.findIndex((e) => e.tag === tag)
  if (idx < 0) return false
  const start = ifd.pos + 2
  const total = 2 + ifd.count * 12 + 4
  const copy = t.b.slice(ifd.pos, ifd.pos + total)
  // 重新寫入：count-1、其他 entries、next
  w16(t, ifd.pos, ifd.count - 1)
  let o = start
  for (let i = 0; i < ifd.count; i++) {
    if (i === idx) continue
    t.b.set(copy.subarray(2 + i * 12, 2 + i * 12 + 12), o)
    o += 12
  }
  w32(t, o, ifd.next)
  zero(t, o + 4, 12)
  return true
}

export interface TiffInfo {
  orientation: number
  hasGps: boolean
  hasThumbnail: boolean
}

export function tiffInfo(tiff: Uint8Array): TiffInfo {
  const t = openTiff(tiff)
  const ifd0 = readIfd(t, u32(t, 4))
  const o = findEntry(ifd0, TAG.orientation)
  return {
    orientation: o && o.type === 3 ? u16(t, o.dataPos) : 1,
    hasGps: !!findEntry(ifd0, TAG.gpsIfd),
    hasThumbnail: ifd0.next > 0,
  }
}

/**
 * 就地移除 GPS（回傳新的副本，長度不變）。
 * 沒有 GPS 時 removed=false 並回傳原陣列。
 */
export function removeGpsFromTiff(tiff: Uint8Array): { tiff: Uint8Array; removed: boolean } {
  const t = openTiff(tiff.slice())
  const ifd0 = readIfd(t, u32(t, 4))
  const ptr = findEntry(ifd0, TAG.gpsIfd)
  if (!ptr) return { tiff, removed: false }
  const gpsPos = u32(t, ptr.dataPos)
  if (gpsPos > 0 && gpsPos < t.b.length) {
    try {
      zeroIfd(t, readIfd(t, gpsPos))
    } catch {
      // GPS IFD 損毀：至少把指標拿掉
    }
  }
  removeEntry(t, ifd0, TAG.gpsIfd)
  return { tiff: t.b, removed: true }
}

/** 移除 IFD1（內嵌縮圖）：重新編碼後縮圖會跟畫面不一致，甚至留下被裁掉的內容 */
export function removeThumbnailFromTiff(tiff: Uint8Array): Uint8Array {
  const t = openTiff(tiff.slice())
  const ifd0 = readIfd(t, u32(t, 4))
  if (!ifd0.next || ifd0.next >= t.b.length) return t.b
  try {
    const ifd1 = readIfd(t, ifd0.next)
    const off = findEntry(ifd1, TAG.thumbOffset)
    const len = findEntry(ifd1, TAG.thumbLength)
    if (off && len) zero(t, u32(t, off.dataPos), u32(t, len.dataPos))
    const so = findEntry(ifd1, TAG.stripOffsets)
    const sc = findEntry(ifd1, TAG.stripByteCounts)
    if (so && sc && so.count === 1 && sc.count === 1) {
      const read = (e: IfdEntry) => (e.type === 3 ? u16(t, e.dataPos) : u32(t, e.dataPos))
      zero(t, read(so), read(sc))
    }
    zeroIfd(t, ifd1)
  } catch {
    // 縮圖區損毀：只斷開連結
  }
  w32(t, ifd0.nextPos, 0)
  return t.b
}

/** 設定方向標籤（重新編碼時方向已經套用到像素，要改回 1） */
export function setTiffOrientation(tiff: Uint8Array, value: number): Uint8Array {
  const t = openTiff(tiff.slice())
  const ifd0 = readIfd(t, u32(t, 4))
  const o = findEntry(ifd0, TAG.orientation)
  if (o && o.type === 3) w16(t, o.dataPos, value)
  return t.b
}

/** 更新 Exif 的像素寬高（PixelXDimension／PixelYDimension） */
export function setTiffPixelSize(tiff: Uint8Array, w: number, h: number): Uint8Array {
  const t = openTiff(tiff.slice())
  const ifd0 = readIfd(t, u32(t, 4))
  const ptr = findEntry(ifd0, TAG.exifIfd)
  if (!ptr) return t.b
  const exif = readIfd(t, u32(t, ptr.dataPos))
  for (const [tag, v] of [
    [TAG.pixelX, w],
    [TAG.pixelY, h],
  ] as const) {
    const e = findEntry(exif, tag)
    if (!e) continue
    if (e.type === 3 && v <= 0xffff) w16(t, e.dataPos, v)
    else if (e.type === 4) w32(t, e.dataPos, v)
  }
  return t.b
}

// ───── TIFF 寫入（最小版，用於「只保留方向」與測試素材） ─────

export interface TiffTag {
  tag: number
  /** 2 ASCII、3 SHORT、4 LONG、5 RATIONAL、7 UNDEFINED */
  type: 2 | 3 | 4 | 5 | 7
  value: string | number[]
}

/** 組出 TIFF：IFD0 ＋ 選用的 Exif IFD 與 GPS IFD */
export function buildTiff(
  ifd0: TiffTag[],
  opts: { exif?: TiffTag[]; gps?: TiffTag[]; littleEndian?: boolean } = {},
): Uint8Array {
  const le = !!opts.littleEndian
  const enc = new TextEncoder()
  const payload = (tag: TiffTag): Uint8Array => {
    if (tag.type === 2) return enc.encode(`${String(tag.value)}\0`)
    const vals = tag.value as number[]
    if (tag.type === 7) return Uint8Array.from(vals)
    const size = tag.type === 3 ? 2 : tag.type === 4 ? 4 : 4
    const b = new Uint8Array(vals.length * size)
    const t = { b, le }
    vals.forEach((v, i) => (size === 2 ? w16(t, i * 2, v) : w32(t, i * 4, v)))
    return b
  }
  const count = (tag: TiffTag) =>
    tag.type === 2
      ? enc.encode(String(tag.value)).length + 1
      : tag.type === 5
        ? (tag.value as number[]).length / 2
        : (tag.value as number[]).length

  // 先排版：每個 IFD 依序放置，外部資料緊接在 IFD 後面
  type Block = { tags: TiffTag[]; pos: number; dataPos: number; size: number }
  const lists: TiffTag[][] = [[...ifd0]]
  if (opts.exif) lists[0].push({ tag: TAG.exifIfd, type: 4, value: [0] })
  if (opts.gps) lists[0].push({ tag: TAG.gpsIfd, type: 4, value: [0] })
  if (opts.exif) lists.push(opts.exif)
  if (opts.gps) lists.push(opts.gps)
  lists.forEach((l) => l.sort((a, b) => a.tag - b.tag))
  const blocks: Block[] = []
  let pos = 8
  for (const tags of lists) {
    const ifdSize = 2 + tags.length * 12 + 4
    let data = 0
    for (const tg of tags) {
      const n = payload(tg).length
      if (n > 4) data += n + (n % 2)
    }
    blocks.push({ tags, pos, dataPos: pos + ifdSize, size: ifdSize + data })
    pos += ifdSize + data
  }
  const b = new Uint8Array(pos)
  const t = { b, le }
  b.set(le ? [0x49, 0x49] : [0x4d, 0x4d], 0)
  w16(t, 2, 42)
  w32(t, 4, 8)
  const pointerTo = { [TAG.exifIfd]: blocks[1]?.pos, [TAG.gpsIfd]: blocks[opts.exif ? 2 : 1]?.pos }
  for (const blk of blocks) {
    w16(t, blk.pos, blk.tags.length)
    let data = blk.dataPos
    blk.tags.forEach((tg, i) => {
      const p = blk.pos + 2 + i * 12
      w16(t, p, tg.tag)
      w16(t, p + 2, tg.type)
      w32(t, p + 4, count(tg))
      let bytes = payload(tg)
      if (blk === blocks[0] && (tg.tag === TAG.exifIfd || tg.tag === TAG.gpsIfd)) {
        const ptrBytes = new Uint8Array(4)
        w32({ b: ptrBytes, le }, 0, pointerTo[tg.tag] ?? 0)
        bytes = ptrBytes
      }
      if (bytes.length <= 4) {
        if (tg.type === 3 && bytes.length === 2) b.set(bytes, p + 8)
        else b.set(bytes, p + 8)
      } else {
        w32(t, p + 8, data)
        b.set(bytes, data)
        data += bytes.length + (bytes.length % 2)
      }
    })
    w32(t, blk.pos + 2 + blk.tags.length * 12, 0)
  }
  return b
}

/** 只含方向標籤的最小 EXIF（全部移除時仍保持照片正確方向） */
export const orientationOnlyTiff = (orientation: number) =>
  buildTiff([{ tag: TAG.orientation, type: 3, value: [orientation] }])

// ───────────────────────── XMP ─────────────────────────

/** 從 XMP 文字移除 exif:GPS* 屬性與元素 */
export function removeGpsFromXmp(xml: string): string {
  return xml
    .replace(/\s+exif:GPS[A-Za-z]*\s*=\s*"[^"]*"/g, '')
    .replace(/\s+exif:GPS[A-Za-z]*\s*=\s*'[^']*'/g, '')
    .replace(/<exif:GPS([A-Za-z]*)\b[^>]*\/>/g, '')
    .replace(/<exif:GPS([A-Za-z]*)\b[^>]*>[\s\S]*?<\/exif:GPS\1>/g, '')
}

// ───────────────────────── 容器偵測 ─────────────────────────

export function sniffContainer(b: Uint8Array): MetaContainer | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (
    b.length > 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP'
  )
    return 'webp'
  return null
}

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, start + len))

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

// ───────────────────────── JPEG ─────────────────────────

interface JpegSegment {
  marker: number
  start: number
  end: number
  dataStart: number
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"
const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0'

function jpegSegments(b: Uint8Array): { segments: JpegSegment[]; scanStart: number } {
  const segments: JpegSegment[] = []
  let p = 2
  while (p < b.length) {
    if (b[p] !== 0xff) throw new MetadataError('JPEG 標記錯誤')
    while (b[p] === 0xff) p++
    const marker = b[p]
    const start = p - 1
    p++
    if (marker === 0xda || marker === 0xd9) return { segments, scanStart: start }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (p + 2 > b.length) throw new MetadataError('JPEG 截斷')
    const len = (b[p] << 8) | b[p + 1]
    if (len < 2 || p + len > b.length) throw new MetadataError('JPEG 長度錯誤')
    segments.push({ marker, start, end: p + len, dataStart: p + 2 })
    p += len
  }
  return { segments, scanStart: b.length }
}

const isExifSeg = (b: Uint8Array, s: JpegSegment) =>
  s.marker === 0xe1 && EXIF_HEADER.every((v, i) => b[s.dataStart + i] === v)
const isXmpSeg = (b: Uint8Array, s: JpegSegment) =>
  s.marker === 0xe1 && ascii(b, s.dataStart, XMP_NS.length) === XMP_NS

function app1(payload: Uint8Array): Uint8Array {
  const len = payload.length + 2
  if (len > 0xffff) throw new MetadataError('APP1 過大')
  return concat([new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff]), payload])
}

function jpegExif(b: Uint8Array): Uint8Array | null {
  const { segments } = jpegSegments(b)
  const s = segments.find((x) => isExifSeg(b, x))
  return s ? b.slice(s.dataStart + 6, s.end) : null
}

function stripJpeg(b: Uint8Array, mode: 'gps' | 'all'): Uint8Array {
  const { segments, scanStart } = jpegSegments(b)
  const parts: Uint8Array[] = [b.subarray(0, 2)]
  let orientation = 1
  for (const s of segments) {
    const raw = b.subarray(s.start, s.end)
    if (isExifSeg(b, s)) {
      const tiff = b.subarray(s.dataStart + 6, s.end)
      if (mode === 'all') {
        try {
          orientation = tiffInfo(tiff).orientation
        } catch {
          orientation = 1
        }
        if (orientation !== 1)
          parts.push(app1(concat([Uint8Array.from(EXIF_HEADER), orientationOnlyTiff(orientation)])))
        continue
      }
      try {
        const { tiff: cleaned } = removeGpsFromTiff(tiff)
        parts.push(app1(concat([Uint8Array.from(EXIF_HEADER), cleaned])))
      } catch {
        // 無法安全解析：以隱私優先，整段 EXIF 移除
      }
      continue
    }
    if (isXmpSeg(b, s)) {
      if (mode === 'all') continue
      const xml = new TextDecoder().decode(b.subarray(s.dataStart + XMP_NS.length, s.end))
      const cleaned = new TextEncoder().encode(removeGpsFromXmp(xml))
      parts.push(app1(concat([new TextEncoder().encode(XMP_NS), cleaned])))
      continue
    }
    if (mode === 'all' && (s.marker === 0xe1 || s.marker === 0xed || s.marker === 0xfe)) continue
    parts.push(raw)
  }
  parts.push(b.subarray(scanStart))
  return concat(parts)
}

function injectJpeg(b: Uint8Array, tiff: Uint8Array): Uint8Array {
  const { segments, scanStart } = jpegSegments(b)
  const parts: Uint8Array[] = [b.subarray(0, 2)]
  const exif = app1(concat([Uint8Array.from(EXIF_HEADER), tiff]))
  let inserted = false
  for (const s of segments) {
    if (isExifSeg(b, s)) continue
    if (!inserted && s.marker !== 0xe0) {
      parts.push(exif)
      inserted = true
    }
    parts.push(b.subarray(s.start, s.end))
  }
  if (!inserted) parts.push(exif)
  parts.push(b.subarray(scanStart))
  return concat(parts)
}

// ───────────────────────── PNG ─────────────────────────

let crcTable: Uint32Array | null = null
export function crc32(data: Uint8Array, start = 0, end = data.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface PngChunk {
  type: string
  start: number
  dataStart: number
  dataEnd: number
  end: number
}

function pngChunks(b: Uint8Array): PngChunk[] {
  const out: PngChunk[] = []
  let p = 8
  while (p + 12 <= b.length) {
    const len = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0
    const type = ascii(b, p + 4, 4)
    const end = p + 12 + len
    if (end > b.length) throw new MetadataError('PNG 截斷')
    out.push({ type, start: p, dataStart: p + 8, dataEnd: p + 8 + len, end })
    p = end
    if (type === 'IEND') break
  }
  return out
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const len = data.length
  out.set([(len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff], 0)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  const c = crc32(out, 4, 8 + len)
  out.set([(c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff], 8 + len)
  return out
}

const PNG_TEXT = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME', 'eXIf'])

function pngExif(b: Uint8Array): Uint8Array | null {
  const c = pngChunks(b).find((x) => x.type === 'eXIf')
  return c ? b.slice(c.dataStart, c.dataEnd) : null
}

/** iTXt 的 XMP（未壓縮）：keyword\0 flag method lang\0 transKey\0 text */
function pngXmp(b: Uint8Array, c: PngChunk): { prefix: Uint8Array; xml: string } | null {
  const data = b.subarray(c.dataStart, c.dataEnd)
  const kw = 'XML:com.adobe.xmp'
  if (ascii(data, 0, kw.length) !== kw || data[kw.length] !== 0) return null
  if (data[kw.length + 1] !== 0) return null // 壓縮的 XMP 不處理
  let p = kw.length + 3
  for (let n = 0; n < 2; n++) {
    while (p < data.length && data[p] !== 0) p++
    p++
  }
  return { prefix: data.slice(0, p), xml: new TextDecoder().decode(data.subarray(p)) }
}

function stripPng(b: Uint8Array, mode: 'gps' | 'all'): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)]
  for (const c of pngChunks(b)) {
    if (mode === 'all' && PNG_TEXT.has(c.type)) continue
    if (mode === 'gps' && c.type === 'eXIf') {
      try {
        const { tiff } = removeGpsFromTiff(b.subarray(c.dataStart, c.dataEnd))
        parts.push(pngChunk('eXIf', tiff))
      } catch {
        // 無法解析就整段移除
      }
      continue
    }
    if (mode === 'gps' && c.type === 'iTXt') {
      const x = pngXmp(b, c)
      if (x) {
        const xml = new TextEncoder().encode(removeGpsFromXmp(x.xml))
        parts.push(pngChunk('iTXt', concat([x.prefix, xml])))
        continue
      }
    }
    parts.push(b.subarray(c.start, c.end))
  }
  return concat(parts)
}

function injectPng(b: Uint8Array, tiff: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)]
  let inserted = false
  for (const c of pngChunks(b)) {
    if (c.type === 'eXIf') continue
    if (!inserted && c.type === 'IDAT') {
      parts.push(pngChunk('eXIf', tiff))
      inserted = true
    }
    parts.push(b.subarray(c.start, c.end))
  }
  return concat(parts)
}

// ───────────────────────── WebP ─────────────────────────

interface RiffChunk {
  fourcc: string
  start: number
  dataStart: number
  dataEnd: number
  end: number
}

function webpChunks(b: Uint8Array): RiffChunk[] {
  const out: RiffChunk[] = []
  let p = 12
  while (p + 8 <= b.length) {
    const fourcc = ascii(b, p, 4)
    const size = (b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24)) >>> 0
    const dataEnd = p + 8 + size
    if (dataEnd > b.length) throw new MetadataError('WebP 截斷')
    const end = dataEnd + (size % 2)
    out.push({ fourcc, start: p, dataStart: p + 8, dataEnd, end: Math.min(end, b.length) })
    p = end
  }
  return out
}

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2
  const out = new Uint8Array(8 + data.length + pad)
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i)
  const n = data.length
  out.set([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff], 4)
  out.set(data, 8)
  return out
}

function riffWrap(chunks: Uint8Array[]): Uint8Array {
  const body = concat(chunks)
  const size = body.length + 4
  const head = new Uint8Array(12)
  head.set([0x52, 0x49, 0x46, 0x46], 0)
  head.set([size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff], 4)
  head.set([0x57, 0x45, 0x42, 0x50], 8)
  return concat([head, body])
}

const VP8X_EXIF = 0x08
const VP8X_XMP = 0x04
const VP8X_ALPHA = 0x10

/** WebP 的 EXIF 區塊有時帶 "Exif\0\0" 前綴 */
function webpTiffOffset(d: Uint8Array) {
  return EXIF_HEADER.every((v, i) => d[i] === v) ? 6 : 0
}

function webpExif(b: Uint8Array): Uint8Array | null {
  const c = webpChunks(b).find((x) => x.fourcc === 'EXIF')
  if (!c) return null
  const d = b.subarray(c.dataStart, c.dataEnd)
  return d.slice(webpTiffOffset(d))
}

function stripWebp(b: Uint8Array, mode: 'gps' | 'all'): Uint8Array {
  const out: Uint8Array[] = []
  for (const c of webpChunks(b)) {
    const data = b.slice(c.dataStart, c.dataEnd)
    if (c.fourcc === 'VP8X' && mode === 'all') {
      data[0] &= ~(VP8X_EXIF | VP8X_XMP)
      out.push(riffChunk('VP8X', data))
      continue
    }
    if (c.fourcc === 'EXIF') {
      if (mode === 'all') continue
      try {
        const off = webpTiffOffset(data)
        const { tiff } = removeGpsFromTiff(data.subarray(off))
        out.push(riffChunk('EXIF', concat([data.subarray(0, off), tiff])))
      } catch {
        // 無法解析：整段移除（VP8X 旗標保留不影響顯示）
      }
      continue
    }
    if (c.fourcc === 'XMP ') {
      if (mode === 'all') continue
      const xml = removeGpsFromXmp(new TextDecoder().decode(data))
      out.push(riffChunk('XMP ', new TextEncoder().encode(xml)))
      continue
    }
    out.push(b.subarray(c.start, c.end))
  }
  return riffWrap(out)
}

function injectWebp(b: Uint8Array, tiff: Uint8Array, size: { w: number; h: number }): Uint8Array {
  const chunks = webpChunks(b).filter((c) => c.fourcc !== 'EXIF')
  const out: Uint8Array[] = []
  if (chunks[0]?.fourcc !== 'VP8X') {
    // 簡單格式（VP8／VP8L）要先升級成 VP8X 才能放 EXIF
    let flags = VP8X_EXIF
    const first = chunks[0]
    if (first?.fourcc === 'VP8L') {
      const d = b.subarray(first.dataStart, first.dataEnd)
      // VP8L 標頭：0x2f、14 位元寬、14 位元高、1 位元 alpha
      if (d.length > 4 && (d[4] >> 4) & 0x01) flags |= VP8X_ALPHA
    }
    const vp8x = new Uint8Array(10)
    vp8x[0] = flags
    const w = size.w - 1
    const h = size.h - 1
    vp8x.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 4)
    vp8x.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 7)
    out.push(riffChunk('VP8X', vp8x))
    for (const c of chunks) out.push(b.subarray(c.start, c.end))
  } else {
    for (const c of chunks) {
      if (c.fourcc === 'VP8X') {
        const d = b.slice(c.dataStart, c.dataEnd)
        d[0] |= VP8X_EXIF
        out.push(riffChunk('VP8X', d))
      } else out.push(b.subarray(c.start, c.end))
    }
  }
  out.push(riffChunk('EXIF', tiff))
  return riffWrap(out)
}

// ───────────────────────── 對外 API ─────────────────────────

/** 取出原始 EXIF（TIFF 位元組）；沒有或不支援時回傳 null */
export function extractExif(b: Uint8Array): Uint8Array | null {
  try {
    const c = sniffContainer(b)
    if (c === 'jpeg') return jpegExif(b)
    if (c === 'png') return pngExif(b)
    if (c === 'webp') return webpExif(b)
  } catch (e) {
    console.error(e)
  }
  return null
}

/**
 * 無損移除中繼資料（不重新壓縮像素）。
 * - gps：只移除 GPS（EXIF 的 GPS IFD 與 XMP 的 exif:GPS*），其他保留
 * - all：移除 EXIF／XMP／IPTC／註解；方向不是 1 時保留一個只有方向的最小 EXIF
 */
export function stripMetadata(b: Uint8Array, mode: 'gps' | 'all'): Uint8Array {
  const c = sniffContainer(b)
  if (c === 'jpeg') return stripJpeg(b, mode)
  if (c === 'png') return stripPng(b, mode)
  if (c === 'webp') return stripWebp(b, mode)
  throw new MetadataError('不支援的容器')
}

/** 把 EXIF（TIFF 位元組）放進新編碼的圖片 */
export function injectExif(b: Uint8Array, tiff: Uint8Array, size: { w: number; h: number }) {
  const c = sniffContainer(b)
  if (c === 'jpeg') return injectJpeg(b, tiff)
  if (c === 'png') return injectPng(b, tiff)
  if (c === 'webp') return injectWebp(b, tiff, size)
  throw new MetadataError('不支援的容器')
}

/**
 * 重新編碼後要放回去的 EXIF：方向改成 1（像素已轉正）、移除內嵌縮圖、更新像素寬高，
 * 需要時一併移除 GPS。
 */
export function prepareExifForReencode(
  tiff: Uint8Array,
  opts: { stripGps: boolean; w: number; h: number },
): Uint8Array {
  let t = setTiffOrientation(tiff, 1)
  t = removeThumbnailFromTiff(t)
  t = setTiffPixelSize(t, opts.w, opts.h)
  if (opts.stripGps) t = removeGpsFromTiff(t).tiff
  return t
}

/** 檢查檔案是否還含 GPS（EXIF GPS IFD 或 XMP exif:GPS*） */
export function containsGps(b: Uint8Array): boolean {
  const tiff = extractExif(b)
  if (tiff) {
    try {
      if (tiffInfo(tiff).hasGps) return true
    } catch {
      /* 無法解析的 EXIF 視為沒有 */
    }
  }
  // XMP：只掃描前 512 KB 以內的文字
  const head = new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 512 * 1024)))
  return /exif:GPS(Latitude|Longitude)/.test(head)
}
