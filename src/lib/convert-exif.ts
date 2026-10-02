/**
 * EXIF 擷取與寫回（純位元組操作，不依賴 DOM，可在 Worker 使用）。
 *
 * - extractExif：從 JPEG（APP1）、PNG（eXIf）、WebP（EXIF chunk）、HEIC／AVIF（Exif item）取出 TIFF 區塊。
 * - sanitizeTiff：方向重設為 1（畫面已套用方向）、移除 GPS（含清除 GPS 資料位元組）、
 *   移除縮圖參照、更新 PixelX／YDimension。
 * - insertExifJpeg／insertExifPng／insertExifWebp：把 TIFF 區塊寫回輸出檔。
 */

// ───────────── 讀取工具 ─────────────

/** 以視窗快取讀取 Blob 的任意區段（避免整檔讀入記憶體） */
class BlobReader {
  private start = 0
  private buf = new Uint8Array(0)
  constructor(
    private blob: Blob,
    private window = 256 * 1024,
  ) {}
  get size() {
    return this.blob.size
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.blob.size) throw new RangeError('超出檔案範圍')
    if (offset >= this.start && offset + length <= this.start + this.buf.length)
      return this.buf.subarray(offset - this.start, offset - this.start + length)
    const len = Math.min(this.blob.size - offset, Math.max(length, this.window))
    this.buf = new Uint8Array(await this.blob.slice(offset, offset + len).arrayBuffer())
    this.start = offset
    return this.buf.subarray(0, length)
  }
}

const ascii = (b: Uint8Array, o: number, n: number) => {
  let s = ''
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i])
  return s
}
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1]
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])
const u32le = (b: Uint8Array, o: number) => ((b[o + 3] << 24) >>> 0) + ((b[o + 2] << 16) | (b[o + 1] << 8) | b[o])

/** 是否為合法的 TIFF 標頭（II*\0 或 MM\0*） */
export function isTiff(b: Uint8Array | null | undefined): b is Uint8Array {
  if (!b || b.length < 8) return false
  return (
    (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)
  )
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0] // "Exif\0\0"
const startsWithExifHeader = (b: Uint8Array, o = 0) => EXIF_HEADER.every((c, i) => b[o + i] === c)

// ───────────── 擷取 ─────────────

export type ContainerKind = 'jpeg' | 'png' | 'webp' | 'isobmff' | 'other'

export function sniffContainer(head: Uint8Array): ContainerKind {
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpeg'
  if (head[0] === 0x89 && ascii(head, 1, 3) === 'PNG') return 'png'
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'webp'
  if (ascii(head, 4, 4) === 'ftyp') return 'isobmff'
  return 'other'
}

/** 從圖片檔取出 EXIF 的 TIFF 區塊；沒有或無法解析時回傳 null */
export async function extractExif(blob: Blob): Promise<Uint8Array | null> {
  if (blob.size < 16) return null
  const r = new BlobReader(blob)
  try {
    const head = await r.read(0, 16)
    switch (sniffContainer(head)) {
      case 'jpeg':
        return await exifFromJpeg(r)
      case 'png':
        return await exifFromPng(r)
      case 'webp':
        return await exifFromWebp(r)
      case 'isobmff':
        return await exifFromIsobmff(r)
      default:
        return null
    }
  } catch (e) {
    console.error(e)
    return null
  }
}

async function exifFromJpeg(r: BlobReader): Promise<Uint8Array | null> {
  let i = 2
  while (i + 4 <= r.size) {
    const h = await r.read(i, 4)
    if (h[0] !== 0xff) return null
    const marker = h[1]
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    if (marker === 0xda || marker === 0xd9) return null
    const len = u16be(h, 2)
    if (len < 2) return null
    if (marker === 0xe1 && len >= 8 && i + 2 + len <= r.size) {
      const seg = await r.read(i + 4, len - 2)
      if (startsWithExifHeader(seg)) {
        const tiff = seg.slice(6)
        return isTiff(tiff) ? tiff : null
      }
    }
    i += 2 + len
  }
  return null
}

async function exifFromPng(r: BlobReader): Promise<Uint8Array | null> {
  let o = 8
  while (o + 8 <= r.size) {
    const h = await r.read(o, 8)
    const len = u32be(h, 0)
    const type = ascii(h, 4, 4)
    if (type === 'eXIf' && o + 8 + len <= r.size) {
      let data = (await r.read(o + 8, len)).slice()
      if (startsWithExifHeader(data)) data = data.slice(6)
      return isTiff(data) ? data : null
    }
    if (type === 'IEND') return null
    o += 12 + len
  }
  return null
}

async function exifFromWebp(r: BlobReader): Promise<Uint8Array | null> {
  let o = 12
  while (o + 8 <= r.size) {
    const h = await r.read(o, 8)
    const type = ascii(h, 0, 4)
    const len = u32le(h, 4)
    if (type === 'EXIF' && o + 8 + len <= r.size) {
      let data = (await r.read(o + 8, len)).slice()
      if (startsWithExifHeader(data)) data = data.slice(6)
      return isTiff(data) ? data : null
    }
    o += 8 + len + (len & 1)
  }
  return null
}

interface Box {
  type: string
  start: number
  /** 內容起點（標頭之後） */
  body: number
  end: number
}

async function readBox(r: BlobReader, o: number, limit: number): Promise<Box | null> {
  if (o + 8 > limit) return null
  const h = await r.read(o, Math.min(16, limit - o))
  let size = u32be(h, 0)
  const type = ascii(h, 4, 4)
  let header = 8
  if (size === 1) {
    if (h.length < 16) return null
    size = u32be(h, 8) * 2 ** 32 + u32be(h, 12)
    header = 16
  } else if (size === 0) size = limit - o
  if (size < header || o + size > limit) return null
  return { type, start: o, body: o + header, end: o + size }
}

async function children(r: BlobReader, from: number, to: number): Promise<Box[]> {
  const out: Box[] = []
  let o = from
  while (o < to) {
    const b = await readBox(r, o, to)
    if (!b) break
    out.push(b)
    o = b.end
  }
  return out
}

const readUint = (b: Uint8Array, o: number, n: number) => {
  let v = 0
  for (let i = 0; i < n; i++) v = v * 256 + b[o + i]
  return v
}

/** HEIC／AVIF：meta → iinf 找 Exif item → iloc 找位置 */
async function exifFromIsobmff(r: BlobReader): Promise<Uint8Array | null> {
  const top = await children(r, 0, r.size)
  const meta = top.find((b) => b.type === 'meta')
  if (!meta) return null
  const metaKids = await children(r, meta.body + 4, meta.end)
  const iinf = metaKids.find((b) => b.type === 'iinf')
  const iloc = metaKids.find((b) => b.type === 'iloc')
  const idat = metaKids.find((b) => b.type === 'idat')
  if (!iinf || !iloc) return null

  // iinf
  const iinfHead = await r.read(iinf.body, 8)
  const iinfVer = iinfHead[0]
  const entriesStart = iinf.body + 4 + (iinfVer === 0 ? 2 : 4)
  let exifId = -1
  for (const infe of await children(r, entriesStart, iinf.end)) {
    if (infe.type !== 'infe') continue
    const b = await r.read(infe.body, Math.min(16, infe.end - infe.body))
    const v = b[0]
    if (v < 2) continue
    const id = v === 2 ? u16be(b, 4) : u32be(b, 4)
    const typeAt = v === 2 ? 8 : 10
    if (ascii(b, typeAt, 4) === 'Exif') {
      exifId = id
      break
    }
  }
  if (exifId < 0) return null

  // iloc
  const loc = await r.read(iloc.body, iloc.end - iloc.body)
  const ver = loc[0]
  let p = 4
  const offsetSize = loc[p] >> 4
  const lengthSize = loc[p] & 15
  const baseOffsetSize = loc[p + 1] >> 4
  const indexSize = ver === 1 || ver === 2 ? loc[p + 1] & 15 : 0
  p += 2
  const count = ver < 2 ? u16be(loc, p) : u32be(loc, p)
  p += ver < 2 ? 2 : 4
  for (let i = 0; i < count; i++) {
    const id = ver < 2 ? u16be(loc, p) : u32be(loc, p)
    p += ver < 2 ? 2 : 4
    let method = 0
    if (ver === 1 || ver === 2) {
      method = u16be(loc, p) & 15
      p += 2
    }
    p += 2 // data_reference_index
    const base = readUint(loc, p, baseOffsetSize)
    p += baseOffsetSize
    const extents = u16be(loc, p)
    p += 2
    const parts: Array<[number, number]> = []
    for (let e = 0; e < extents; e++) {
      p += indexSize
      const off = readUint(loc, p, offsetSize)
      p += offsetSize
      const len = readUint(loc, p, lengthSize)
      p += lengthSize
      parts.push([off, len])
    }
    if (id !== exifId) continue
    if (method === 2) return null
    const origin = method === 1 ? (idat ? idat.body : -1) : 0
    if (origin < 0) return null
    const total = parts.reduce((a, [, l]) => a + l, 0)
    if (!total || total > 4 * 1024 * 1024) return null
    const payload = new Uint8Array(total)
    let w = 0
    for (const [off, len] of parts) {
      payload.set(await r.read(origin + base + off, len), w)
      w += len
    }
    const tiffOffset = u32be(payload, 0)
    const tiff = payload.slice(4 + tiffOffset)
    if (isTiff(tiff)) return tiff
    // 少數檔案把 "Exif\0\0" 算在 offset 之外
    const idx = findTiffStart(payload)
    return idx >= 0 ? payload.slice(idx) : null
  }
  return null
}

function findTiffStart(b: Uint8Array): number {
  for (let i = 0; i + 8 <= Math.min(b.length, 64); i++) if (isTiff(b.subarray(i))) return i
  return -1
}

// ───────────── TIFF 讀寫 ─────────────

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 }

export const TAG = {
  orientation: 0x0112,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  pixelX: 0xa002,
  pixelY: 0xa003,
} as const

function tiffIo(t: Uint8Array) {
  const le = t[0] === 0x49
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength)
  return {
    u16: (o: number) => dv.getUint16(o, le),
    u32: (o: number) => dv.getUint32(o, le),
    set16: (o: number, v: number) => dv.setUint16(o, v, le),
    set32: (o: number, v: number) => dv.setUint32(o, v, le),
  }
}

interface IfdEntry {
  tag: number
  type: number
  count: number
  /** 這筆 entry 在 TIFF 中的位置 */
  at: number
}

function readIfd(t: Uint8Array, offset: number): { entries: IfdEntry[]; next: number; nextAt: number } | null {
  const io = tiffIo(t)
  if (offset < 8 || offset + 2 > t.length) return null
  const n = io.u16(offset)
  const nextAt = offset + 2 + n * 12
  if (nextAt + 4 > t.length) return null
  const entries: IfdEntry[] = []
  for (let i = 0; i < n; i++) {
    const at = offset + 2 + i * 12
    entries.push({ tag: io.u16(at), type: io.u16(at + 2), count: io.u32(at + 4), at })
  }
  return { entries, next: io.u32(nextAt), nextAt }
}

/** 讀取 Orientation（1 到 8）；沒有時回傳 1 */
export function readOrientation(tiff: Uint8Array | null): number {
  if (!isTiff(tiff)) return 1
  const io = tiffIo(tiff)
  const ifd = readIfd(tiff, io.u32(4))
  const e = ifd?.entries.find((x) => x.tag === TAG.orientation)
  if (!e) return 1
  const v = e.type === 3 ? io.u16(e.at + 8) : e.type === 4 ? io.u32(e.at + 8) : 1
  return v >= 1 && v <= 8 ? v : 1
}

/** 是否含 GPS 資訊 */
export function hasGps(tiff: Uint8Array | null): boolean {
  if (!isTiff(tiff)) return false
  const io = tiffIo(tiff)
  return !!readIfd(tiff, io.u32(4))?.entries.some((x) => x.tag === TAG.gpsIfd)
}

export interface SanitizeOptions {
  /** 方向改成 1（畫面已套用方向） */
  resetOrientation?: boolean
  /** 移除 GPS：刪除 IFD0 中的指標並把 GPS 資料位元組清為 0 */
  dropGps?: boolean
  /** 移除縮圖（IFD1）參照 */
  dropThumbnail?: boolean
  /** 更新 Exif IFD 中的 PixelXDimension／PixelYDimension */
  pixelSize?: { width: number; height: number }
}

/** 回傳修改後的新 TIFF（不改動原本的陣列） */
export function sanitizeTiff(src: Uint8Array, opts: SanitizeOptions): Uint8Array {
  if (!isTiff(src)) throw new Error('不是有效的 EXIF 資料')
  const t = src.slice()
  const io = tiffIo(t)
  const ifd0Off = io.u32(4)
  let ifd0 = readIfd(t, ifd0Off)
  if (!ifd0) return t

  if (opts.resetOrientation) {
    const e = ifd0.entries.find((x) => x.tag === TAG.orientation)
    if (e && e.type === 3) io.set16(e.at + 8, 1)
    else if (e && e.type === 4) io.set32(e.at + 8, 1)
  }

  if (opts.pixelSize) {
    const ptr = ifd0.entries.find((x) => x.tag === TAG.exifIfd)
    const exif = ptr ? readIfd(t, io.u32(ptr.at + 8)) : null
    for (const e of exif?.entries ?? []) {
      if (e.tag !== TAG.pixelX && e.tag !== TAG.pixelY) continue
      const v = e.tag === TAG.pixelX ? opts.pixelSize.width : opts.pixelSize.height
      if (e.type === 3 && v <= 0xffff) io.set16(e.at + 8, v)
      else if (e.type === 4) io.set32(e.at + 8, v)
    }
  }

  if (opts.dropGps) {
    const idx = ifd0.entries.findIndex((x) => x.tag === TAG.gpsIfd)
    if (idx >= 0) {
      const gpsOff = io.u32(ifd0.entries[idx].at + 8)
      zeroIfd(t, gpsOff)
      // 把後面的 entry 與「下一個 IFD」指標往前移 12 bytes
      const n = ifd0.entries.length
      const from = ifd0.entries[idx].at
      t.copyWithin(from, from + 12, ifd0.nextAt + 4)
      t.fill(0, ifd0.nextAt - 8, ifd0.nextAt + 4)
      io.set16(ifd0Off, n - 1)
      // 重新寫回「下一個 IFD」指標（copyWithin 已搬好，fill 可能覆蓋了它）
      io.set32(ifd0Off + 2 + (n - 1) * 12, ifd0.next)
      ifd0 = readIfd(t, ifd0Off)
      if (!ifd0) return t
    }
  }

  if (opts.dropThumbnail) io.set32(ifd0.nextAt, 0)
  return t
}

/** 把一個 IFD（含其外部資料）全部清為 0 */
function zeroIfd(t: Uint8Array, offset: number) {
  const ifd = readIfd(t, offset)
  if (!ifd) return
  const io = tiffIo(t)
  for (const e of ifd.entries) {
    const size = (TYPE_SIZE[e.type] ?? 1) * e.count
    if (size > 4) {
      const p = io.u32(e.at + 8)
      if (p + size <= t.length) t.fill(0, p, p + size)
    }
  }
  t.fill(0, offset, ifd.nextAt + 4)
}

// ───────────── 寫回 ─────────────

/** JPEG APP1 能容納的最大 TIFF 長度 */
export const MAX_JPEG_EXIF = 0xffff - 2 - 6

/** 插入 APP1 Exif（緊接在 SOI 之後），並移除原有的 Exif APP1。超過 64 KB 時丟出錯誤 */
export function insertExifJpeg(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('不是 JPEG')
  if (tiff.length > MAX_JPEG_EXIF) throw new RangeError('EXIF 太大')
  // 去掉既有的 Exif APP1
  const keep: Array<[number, number]> = []
  let i = 2
  let tailStart = jpeg.length
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) {
      tailStart = i
      break
    }
    const m = jpeg[i + 1]
    if (m === 0xda || m === 0xd9) {
      tailStart = i
      break
    }
    const len = u16be(jpeg, i + 2)
    const isExif = m === 0xe1 && startsWithExifHeader(jpeg, i + 4)
    if (!isExif) keep.push([i, i + 2 + len])
    i += 2 + len
  }
  const segLen = 2 + 6 + tiff.length
  const app1 = new Uint8Array(2 + segLen)
  app1[0] = 0xff
  app1[1] = 0xe1
  app1[2] = segLen >> 8
  app1[3] = segLen & 255
  app1.set(EXIF_HEADER, 4)
  app1.set(tiff, 10)
  const keptLen = keep.reduce((a, [s, e]) => a + (e - s), 0)
  const out = new Uint8Array(2 + app1.length + keptLen + (jpeg.length - tailStart))
  out[0] = 0xff
  out[1] = 0xd8
  let w = 2
  out.set(app1, w)
  w += app1.length
  for (const [s, e] of keep) {
    out.set(jpeg.subarray(s, e), w)
    w += e - s
  }
  out.set(jpeg.subarray(tailStart), w)
  return out
}

let crcTable: Uint32Array | null = null
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 在 IHDR 之後插入 eXIf chunk（移除原有的 eXIf） */
export function insertExifPng(png: Uint8Array, tiff: Uint8Array): Uint8Array {
  if (png[0] !== 0x89 || ascii(png, 1, 3) !== 'PNG') throw new Error('不是 PNG')
  const chunks: Array<[number, number, string]> = []
  let o = 8
  while (o + 8 <= png.length) {
    const len = u32be(png, o)
    const type = ascii(png, o + 4, 4)
    chunks.push([o, o + 12 + len, type])
    o += 12 + len
    if (type === 'IEND') break
  }
  const ihdr = chunks.find((c) => c[2] === 'IHDR')
  if (!ihdr) throw new Error('PNG 缺少 IHDR')
  const chunk = new Uint8Array(12 + tiff.length)
  const dv = new DataView(chunk.buffer)
  dv.setUint32(0, tiff.length)
  chunk.set([0x65, 0x58, 0x49, 0x66], 4) // eXIf
  chunk.set(tiff, 8)
  dv.setUint32(8 + tiff.length, crc32(chunk, 4, 8 + tiff.length))
  const parts: Uint8Array[] = [png.subarray(0, 8)]
  for (const [s, e, type] of chunks) {
    if (type === 'eXIf') continue
    parts.push(png.subarray(s, e))
    if (type === 'IHDR') parts.push(chunk)
  }
  return concat(parts)
}

/**
 * WebP：加入 EXIF chunk。簡單格式（VP8／VP8L）會先轉成延伸格式（VP8X），
 * 並依 VP8L 標頭或 ALPH chunk 設定 alpha 旗標。
 */
export function insertExifWebp(webp: Uint8Array, tiff: Uint8Array): Uint8Array {
  if (ascii(webp, 0, 4) !== 'RIFF' || ascii(webp, 8, 4) !== 'WEBP') throw new Error('不是 WebP')
  const chunks: Array<{ type: string; start: number; end: number; data: number; len: number }> = []
  let o = 12
  while (o + 8 <= webp.length) {
    const type = ascii(webp, o, 4)
    const len = u32le(webp, o + 4)
    const end = Math.min(webp.length, o + 8 + len + (len & 1))
    chunks.push({ type, start: o, end, data: o + 8, len })
    o = end
  }
  const first = chunks[0]
  if (!first) throw new Error('WebP 內容為空')
  const exifChunk = makeRiffChunk('EXIF', tiff)
  const parts: Uint8Array[] = []
  if (first.type === 'VP8X') {
    const vp8x = webp.slice(first.start, first.end)
    vp8x[8] |= 0x08
    parts.push(vp8x)
    for (const c of chunks.slice(1)) if (c.type !== 'EXIF') parts.push(webp.subarray(c.start, c.end))
  } else {
    const { width, height, alpha } = simpleWebpInfo(webp, chunks)
    const body = new Uint8Array(10)
    body[0] = 0x08 | (alpha ? 0x10 : 0)
    writeU24le(body, 4, width - 1)
    writeU24le(body, 7, height - 1)
    parts.push(makeRiffChunk('VP8X', body))
    for (const c of chunks) if (c.type !== 'EXIF') parts.push(webp.subarray(c.start, c.end))
  }
  parts.push(exifChunk)
  const payload = concat(parts)
  const out = new Uint8Array(12 + payload.length)
  out.set(webp.subarray(0, 12))
  new DataView(out.buffer).setUint32(4, 4 + payload.length, true)
  out.set(payload, 12)
  return out
}

function simpleWebpInfo(
  webp: Uint8Array,
  chunks: Array<{ type: string; data: number }>,
): { width: number; height: number; alpha: boolean } {
  const vp8l = chunks.find((c) => c.type === 'VP8L')
  if (vp8l) {
    const bits = u32le(webp, vp8l.data + 1)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      alpha: ((bits >>> 28) & 1) === 1,
    }
  }
  const vp8 = chunks.find((c) => c.type === 'VP8 ')
  if (vp8) {
    const d = vp8.data
    return {
      width: (webp[d + 6] | (webp[d + 7] << 8)) & 0x3fff,
      height: (webp[d + 8] | (webp[d + 9] << 8)) & 0x3fff,
      alpha: chunks.some((c) => c.type === 'ALPH'),
    }
  }
  throw new Error('無法辨識的 WebP')
}

function makeRiffChunk(type: string, data: Uint8Array): Uint8Array {
  const pad = data.length & 1
  const out = new Uint8Array(8 + data.length + pad)
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i)
  new DataView(out.buffer).setUint32(4, data.length, true)
  out.set(data, 8)
  return out
}

function writeU24le(b: Uint8Array, o: number, v: number) {
  b[o] = v & 255
  b[o + 1] = (v >> 8) & 255
  b[o + 2] = (v >> 16) & 255
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let w = 0
  for (const p of parts) {
    out.set(p, w)
    w += p.length
  }
  return out
}
