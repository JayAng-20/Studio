/**
 * 動畫容器封裝（純函式）：APNG（acTL／fcTL／fdAT）與 Animated WebP（VP8X／ANIM／ANMF）。
 * 壓縮本身由呼叫端提供（APNG 用 fflate 的 zlib，WebP 用 @jsquash/webp 編出的靜態 WebP）。
 */

// ---------- 共用 ----------

let crcTable: Uint32Array | null = null
function table() {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  return crcTable
}

/** PNG 用的 CRC-32 */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const t = table()
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 可增長的位元組緩衝 */
class ByteWriter {
  buf: Uint8Array
  len = 0
  constructor(cap = 1 << 16) {
    this.buf = new Uint8Array(cap)
  }
  ensure(n: number) {
    if (this.len + n <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < this.len + n) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }
  u8(v: number) {
    this.ensure(1)
    this.buf[this.len++] = v & 0xff
  }
  u16le(v: number) {
    this.u8(v)
    this.u8(v >>> 8)
  }
  u24le(v: number) {
    this.u8(v)
    this.u8(v >>> 8)
    this.u8(v >>> 16)
  }
  u32le(v: number) {
    this.u16le(v & 0xffff)
    this.u16le(v >>> 16)
  }
  u32be(v: number) {
    this.u8(v >>> 24)
    this.u8(v >>> 16)
    this.u8(v >>> 8)
    this.u8(v)
  }
  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i))
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length)
    this.buf.set(b, this.len)
    this.len += b.length
  }
  result() {
    return this.buf.slice(0, this.len)
  }
}

/** 兩張 RGBA 影格之間有變化的最小矩形；完全相同時回傳 null */
export function changedRect(
  prev: Uint8Array | Uint8ClampedArray,
  cur: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  const a = new Uint32Array(prev.buffer, prev.byteOffset, (width * height) | 0)
  const b = new Uint32Array(cur.buffer, cur.byteOffset, (width * height) | 0)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let first = -1
    for (let x = 0; x < width; x++) {
      if (a[row + x] !== b[row + x]) {
        first = x
        break
      }
    }
    if (first < 0) continue
    let last = first
    for (let x = width - 1; x > first; x--) {
      if (a[row + x] !== b[row + x]) {
        last = x
        break
      }
    }
    if (first < minX) minX = first
    if (last > maxX) maxX = last
    if (y < minY) minY = y
    maxY = y
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** 從 RGBA 影格切出矩形區域 */
export function cropRgba(
  src: Uint8Array | Uint8ClampedArray,
  width: number,
  r: { x: number; y: number; w: number; h: number },
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4)
  for (let y = 0; y < r.h; y++) {
    const s = ((r.y + y) * width + r.x) * 4
    out.set(src.subarray(s, s + r.w * 4), y * r.w * 4)
  }
  return out
}

// ---------- APNG ----------

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function paeth(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * PNG 掃描列濾波：每列試 5 種濾波器，取「有號位元組絕對值總和」最小者（libpng 的經驗法則）。
 * 輸入為 RGBA；colorType 2 時捨棄 alpha。回傳含濾波位元組的原始資料（尚未壓縮）。
 */
export function filterScanlines(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  colorType: 2 | 6,
): Uint8Array {
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const out = new Uint8Array((stride + 1) * height)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride))
  for (let y = 0; y < height; y++) {
    // 取出目前列
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4
      const d = x * bpp
      cur[d] = rgba[s]
      cur[d + 1] = rgba[s + 1]
      cur[d + 2] = rgba[s + 2]
      if (bpp === 4) cur[d + 3] = rgba[s + 3]
    }
    let best = 0
    let bestSum = Infinity
    for (let f = 0; f < 5; f++) {
      const c = cand[f]
      let sum = 0
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0
        const up = prev[i]
        const ul = i >= bpp ? prev[i - bpp] : 0
        let v: number
        switch (f) {
          case 0:
            v = cur[i]
            break
          case 1:
            v = cur[i] - left
            break
          case 2:
            v = cur[i] - up
            break
          case 3:
            v = cur[i] - ((left + up) >> 1)
            break
          default:
            v = cur[i] - paeth(left, up, ul)
        }
        v &= 0xff
        c[i] = v
        sum += v < 128 ? v : 256 - v
        if (sum >= bestSum) break
      }
      if (sum < bestSum) {
        bestSum = sum
        best = f
      }
    }
    const o = y * (stride + 1)
    out[o] = best
    // 最佳濾波器可能在提早中斷前未完整計算，重新完整算一次
    const c = cand[best]
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? cur[i - bpp] : 0
      const up = prev[i]
      const ul = i >= bpp ? prev[i - bpp] : 0
      const p =
        best === 0
          ? 0
          : best === 1
            ? left
            : best === 2
              ? up
              : best === 3
                ? (left + up) >> 1
                : paeth(left, up, ul)
      c[i] = (cur[i] - p) & 0xff
    }
    out.set(c, o + 1)
    prev.set(cur)
  }
  return out
}

export interface ApngFrame {
  x: number
  y: number
  width: number
  height: number
  /** 延遲：分子／分母（秒） */
  delayNum: number
  delayDen: number
  /** zlib 壓縮後的掃描列資料 */
  data: Uint8Array
}

function writeChunk(w: ByteWriter, type: string, data: Uint8Array) {
  w.u32be(data.length)
  const start = w.len
  w.ascii(type)
  w.bytes(data)
  w.u32be(crc32(w.buf, start, w.len))
}

function be(fields: Array<[number, 1 | 2 | 4]>): Uint8Array {
  const size = fields.reduce((a, [, n]) => a + n, 0)
  const out = new Uint8Array(size)
  let o = 0
  for (const [v, n] of fields) {
    for (let k = n - 1; k >= 0; k--) out[o++] = (v >>> (k * 8)) & 0xff
  }
  return out
}

/**
 * 組出 APNG：第一格同時是預設影像（IDAT），其後每格 fcTL＋fdAT。
 * dispose_op = 0（不清除）、blend_op = 0（直接覆蓋），搭配子矩形即可只寫入變化區域。
 */
export function buildApng(
  width: number,
  height: number,
  numPlays: number,
  frames: ApngFrame[],
  colorType: 2 | 6,
): Uint8Array {
  const w = new ByteWriter()
  w.bytes(PNG_SIG)
  writeChunk(
    w,
    'IHDR',
    be([
      [width, 4],
      [height, 4],
      [8, 1],
      [colorType, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ]),
  )
  writeChunk(
    w,
    'acTL',
    be([
      [frames.length, 4],
      [Math.max(0, numPlays), 4],
    ]),
  )
  let seq = 0
  frames.forEach((f, i) => {
    writeChunk(
      w,
      'fcTL',
      be([
        [seq++, 4],
        [f.width, 4],
        [f.height, 4],
        [f.x, 4],
        [f.y, 4],
        [f.delayNum, 2],
        [f.delayDen, 2],
        [0, 1],
        [0, 1],
      ]),
    )
    if (i === 0) {
      writeChunk(w, 'IDAT', f.data)
    } else {
      const d = new Uint8Array(f.data.length + 4)
      d.set(be([[seq++, 4]]), 0)
      d.set(f.data, 4)
      writeChunk(w, 'fdAT', d)
    }
  })
  writeChunk(w, 'IEND', new Uint8Array(0))
  return w.result()
}

// ---------- Animated WebP ----------

export interface WebpPayload {
  /** ALPH／VP8／VP8L 子區塊（已含區塊標頭與補齊位元組） */
  chunks: Uint8Array
  hasAlpha: boolean
}

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
const u32le = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

/** 從靜態 WebP 檔取出影像資料區塊（略過 VP8X／ICCP／EXIF／XMP） */
export function extractWebpPayload(file: Uint8Array): WebpPayload {
  if (fourcc(file, 0) !== 'RIFF' || fourcc(file, 8) !== 'WEBP') throw new Error('not a webp')
  const parts: Uint8Array[] = []
  let hasAlpha = false
  let o = 12
  while (o + 8 <= file.length) {
    const type = fourcc(file, o)
    const size = u32le(file, o + 4)
    const total = 8 + size + (size & 1)
    if (type === 'ALPH' || type === 'VP8 ' || type === 'VP8L') {
      parts.push(file.subarray(o, Math.min(file.length, o + total)))
      if (type === 'ALPH') hasAlpha = true
      // VP8L 的 alpha_is_used 位元（第 5 個位元組的第 4 bit 之後）：header 1 byte 0x2f 後 4 bytes
      if (type === 'VP8L' && o + 8 + 5 <= file.length) {
        const bits = u32le(file, o + 9)
        if ((bits >>> 28) & 1) hasAlpha = true
      }
    }
    o += total
  }
  const len = parts.reduce((a, p) => a + p.length, 0)
  const chunks = new Uint8Array(len)
  let w = 0
  for (const p of parts) {
    chunks.set(p, w)
    w += p.length
  }
  return { chunks, hasAlpha }
}

export interface WebpFrame {
  /** 必須是偶數 */
  x: number
  y: number
  width: number
  height: number
  durationMs: number
  payload: WebpPayload
}

/**
 * 組出 Animated WebP。每格 blending = 不混合（直接覆蓋）、disposal = 不清除，
 * 所以子矩形只需包含變化區域。
 */
export function buildAnimatedWebp(
  width: number,
  height: number,
  loops: number,
  frames: WebpFrame[],
): Uint8Array {
  const w = new ByteWriter()
  const anyAlpha = frames.some((f) => f.payload.hasAlpha)
  w.ascii('RIFF')
  w.u32le(0) // 稍後回填
  w.ascii('WEBP')
  // VP8X
  w.ascii('VP8X')
  w.u32le(10)
  w.u8((anyAlpha ? 0x10 : 0) | 0x02)
  w.u24le(0)
  w.u24le(width - 1)
  w.u24le(height - 1)
  // ANIM：背景色（BGRA）＋迴圈次數
  w.ascii('ANIM')
  w.u32le(6)
  w.u32le(0x00000000)
  w.u16le(Math.max(0, Math.min(65535, loops)))
  for (const f of frames) {
    const size = 16 + f.payload.chunks.length
    w.ascii('ANMF')
    w.u32le(size)
    w.u24le(f.x >> 1)
    w.u24le(f.y >> 1)
    w.u24le(f.width - 1)
    w.u24le(f.height - 1)
    w.u24le(Math.max(1, Math.min(0xffffff, Math.round(f.durationMs))))
    // bit1 = 不混合；bit0 = 不清除（0）
    w.u8(0x02)
    w.bytes(f.payload.chunks)
    if (size & 1) w.u8(0)
  }
  const out = w.result()
  const riff = out.length - 8
  out[4] = riff & 0xff
  out[5] = (riff >>> 8) & 0xff
  out[6] = (riff >>> 16) & 0xff
  out[7] = (riff >>> 24) & 0xff
  return out
}

/** 子矩形對齊到偶數座標（WebP 的 ANMF 位移以 2 px 為單位） */
export function alignEven(
  r: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const x = r.x & ~1
  const y = r.y & ~1
  return { x, y, w: Math.min(width - x, r.w + (r.x - x)), h: Math.min(height - y, r.h + (r.y - y)) }
}
