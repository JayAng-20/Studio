/**
 * 串流式 PNG 編碼器（純函式，可在 Worker 與 Node 測試中使用）。
 * 逐列寫入像素：每列加上 PNG filter byte（自適應選擇 None／Sub／Up／Paeth），
 * 送進串流 Deflate（zlib 格式），壓縮後的資料累積到一定大小就包成一個 IDAT chunk（各自計算 CRC32）。
 * 記憶體只保留壓縮後的資料與上一列，所以高度可以到數十萬像素，不受 canvas 尺寸上限影響。
 *
 * 壓縮器：優先使用瀏覽器原生的 CompressionStream('deflate')（快、穩定）。
 * 實測 fflate 0.8 的串流 Zlib 在某些資料下會產生錯誤的距離碼（一次壓縮 zlibSync 正常、串流則否），
 * 所以不支援 CompressionStream 的環境只用 fflate 的「不壓縮（stored）」模式，確保檔案一定正確。
 */
import { Zlib } from 'fflate'

export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
/** PNG 規範的寬高上限（2^31 − 1） */
export const PNG_MAX_DIM = 0x7fffffff

/* ---------- CRC32 ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** 累加 CRC32（crc 傳入上一次的結果；初始值 0） */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0))

/** 組出一個 chunk：長度（4）＋類型（4）＋資料＋CRC（4） */
export function makeChunk(type: string, parts: Uint8Array[] | Uint8Array): Uint8Array {
  const list = parts instanceof Uint8Array ? [parts] : parts
  const len = list.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(12 + len)
  const v = new DataView(out.buffer)
  v.setUint32(0, len)
  const typeBytes = ascii(type)
  out.set(typeBytes, 4)
  let off = 8
  let crc = crc32(typeBytes)
  for (const p of list) {
    out.set(p, off)
    off += p.length
    crc = crc32(p, crc)
  }
  v.setUint32(8 + len, crc)
  return out
}

export type PngFilter = 'none' | 'sub' | 'up' | 'paeth' | 'adaptive'

export interface PngEncoderOptions {
  width: number
  height: number
  /** true：RGBA（色彩類型 6）；false：RGB（色彩類型 2，檔案較小） */
  alpha: boolean
  filter?: PngFilter
  /** 強制使用 fflate stored 模式（測試後備路徑用） */
  forceFallback?: boolean
  /** 每個 IDAT 的目標大小（位元組） */
  idatSize?: number
}

export interface PngStreamEncoder {
  /** 寫入一列 RGBA 像素（長度 = width × 4） */
  writeRow(rgba: Uint8Array | Uint8ClampedArray, offset?: number): void
  /** 寫入多列（緊密排列的 RGBA） */
  writeRows(rgba: Uint8Array | Uint8ClampedArray, rows: number): void
  /** 已寫入的列數 */
  readonly rows: number
  /** 等待已送出的資料被壓縮器消化（背壓；每批像素寫完後呼叫） */
  drain(): Promise<void>
  /** 結束並取得所有片段（簽章、IHDR、IDAT…、IEND），可直接組成 Blob */
  finish(): Promise<Uint8Array[]>
  /** 目前已產生的壓縮資料量（位元組） */
  readonly bytes: number
}

export function createPngEncoder(o: PngEncoderOptions): PngStreamEncoder {
  const { width, height, alpha } = o
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new RangeError('PNG 尺寸無效')
  if (width > PNG_MAX_DIM || height > PNG_MAX_DIM) throw new RangeError('PNG 尺寸超過上限')
  const bpp = alpha ? 4 : 3
  const stride = width * bpp
  const filter = o.filter ?? 'adaptive'
  const idatSize = o.idatSize ?? 1 << 18
  const parts: Uint8Array[] = [PNG_SIGNATURE.slice()]
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, width)
  hv.setUint32(4, height)
  ihdr[8] = 8 // 位元深度
  ihdr[9] = alpha ? 6 : 2 // 色彩類型
  ihdr[10] = 0 // 壓縮方式
  ihdr[11] = 0 // 篩選方式
  ihdr[12] = 0 // 非交錯
  parts.push(makeChunk('IHDR', ihdr))

  let pending: Uint8Array[] = []
  let pendingLen = 0
  let total = 0
  const flush = () => {
    if (!pendingLen) return
    parts.push(makeChunk('IDAT', pending))
    pending = []
    pendingLen = 0
  }
  const z = createCompressor((d) => {
    total += d.length
    // 切成不超過 idatSize 的 IDAT
    for (let off = 0; off < d.length;) {
      const take = Math.min(idatSize - pendingLen, d.length - off)
      pending.push(d.subarray(off, off + take))
      pendingLen += take
      off += take
      if (pendingLen >= idatSize) flush()
    }
  }, o.forceFallback)

  // 批次送進壓縮器，減少呼叫次數
  const BATCH = Math.max(stride + 1, Math.min(1 << 20, (stride + 1) * 64))
  let batch = new Uint8Array(BATCH)
  let batchLen = 0
  let prev = new Uint8Array(stride)
  let cur = new Uint8Array(stride)
  let rows = 0
  let done = false

  const pushLine = (line: Uint8Array) => {
    if (batchLen + line.length > batch.length) {
      z.push(batch.subarray(0, batchLen))
      batch = new Uint8Array(BATCH)
      batchLen = 0
    }
    batch.set(line, batchLen)
    batchLen += line.length
  }
  const line = new Uint8Array(stride + 1)

  const writeRow = (rgba: Uint8Array | Uint8ClampedArray, offset = 0) => {
    if (done) throw new Error('PNG 已結束')
    if (rows >= height) throw new RangeError('寫入的列數超過高度')
    // 轉成目標像素格式
    if (alpha) {
      for (let i = 0; i < stride; i++) cur[i] = rgba[offset + i]
    } else {
      for (let x = 0, s = offset, d = 0; x < width; x++, s += 4, d += 3) {
        cur[d] = rgba[s]
        cur[d + 1] = rgba[s + 1]
        cur[d + 2] = rgba[s + 2]
      }
    }
    const first = rows === 0
    if (filter === 'none') {
      line[0] = 0
      line.set(cur, 1)
    } else if (filter === 'sub') {
      filterSub(line, cur, stride, bpp)
    } else if (filter === 'up') {
      filterUp(line, cur, first ? null : prev, stride)
    } else if (filter === 'paeth') {
      filterPaeth(line, cur, first ? null : prev, stride, bpp)
    } else {
      // 自適應：抽樣估計 None／Sub／Up／Paeth 的「殘差絕對值總和」，選最小者再完整計算（libpng 的常用啟發式）。
      // 文件頁面大多是大片單色，None 本身就很好壓縮，所以篩選後要明顯更小才採用。
      const k = chooseFilter(cur, first ? null : prev, stride, bpp)
      if (k === 0) {
        line[0] = 0
        line.set(cur, 1)
      } else if (k === 1) filterSub(line, cur, stride, bpp)
      else if (k === 2) filterUp(line, cur, first ? null : prev, stride)
      else filterPaeth(line, cur, first ? null : prev, stride, bpp)
    }
    pushLine(line)
    const tmp = prev
    prev = cur
    cur = tmp
    rows++
  }

  return {
    writeRow,
    writeRows(rgba, n) {
      const rowBytes = width * 4
      for (let r = 0; r < n; r++) writeRow(rgba, r * rowBytes)
    },
    get rows() {
      return rows
    },
    get bytes() {
      return total
    },
    drain: () => z.drain(),
    async finish() {
      if (done) throw new Error('PNG 已結束')
      if (rows !== height) throw new RangeError(`列數不足：${rows}／${height}`)
      done = true
      if (batchLen) z.push(batch.subarray(0, batchLen))
      await z.finish()
      flush()
      parts.push(makeChunk('IEND', new Uint8Array(0)))
      return parts
    },
  }
}

/* ---------- 壓縮器 ---------- */

interface Compressor {
  /** 送出一段資料（呼叫後不可再修改這段資料） */
  push(chunk: Uint8Array): void
  drain(): Promise<void>
  finish(): Promise<void>
}

const hasNativeDeflate = () => typeof CompressionStream === 'function'

function createCompressor(onData: (d: Uint8Array) => void, forceFallback = false): Compressor {
  if (!forceFallback && hasNativeDeflate()) {
    const cs = new CompressionStream('deflate')
    const writer = cs.writable.getWriter()
    const reader = cs.readable.getReader()
    let chain: Promise<void> = Promise.resolve()
    const reading = (async () => {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        onData(value)
      }
    })()
    return {
      push(chunk) {
        chain = chain.then(() => writer.write(chunk as Uint8Array<ArrayBuffer>))
      },
      async drain() {
        await chain
        await writer.ready
      },
      async finish() {
        await chain
        await writer.close()
        await reading
      },
    }
  }
  // 後備：fflate 串流 Zlib 的 stored 模式（不壓縮，但保證正確）
  const z = new Zlib({ level: 0 })
  z.ondata = (d) => onData(d.slice())
  return {
    push: (chunk) => z.push(chunk),
    drain: async () => {},
    finish: async () => z.push(new Uint8Array(0), true),
  }
}

/* ---------- 篩選器 ---------- */

/** 自適應時 None 的分數折扣（實測文件頁面以 0.15 左右最佳，照片類不受影響） */
let NONE_BIAS = 0.15
/** 測試與調校用 */
export const setNoneBias = (v: number) => {
  NONE_BIAS = v
}

const abs8 = (v: number) => {
  const b = v & 0xff
  return b < 128 ? b : 256 - b
}

/** 抽樣（每隔數個像素）估計各篩選器的殘差，回傳 0 None、1 Sub、2 Up、4 Paeth */
function chooseFilter(
  cur: Uint8Array,
  prev: Uint8Array | null,
  stride: number,
  bpp: number,
): number {
  const step = bpp * 3
  let sNone = 0
  let sSub = 0
  let sUp = 0
  let sPaeth = 0
  for (let px = bpp; px < stride; px += step) {
    for (let j = 0; j < bpp; j++) {
      const i = px + j
      const x = cur[i]
      const a = cur[i - bpp]
      const b = prev ? prev[i] : 0
      const c = prev ? prev[i - bpp] : 0
      sNone += x < 128 ? x : 256 - x
      sSub += abs8(x - a)
      sUp += abs8(x - b)
      const p = a + b - c
      const pa = p > a ? p - a : a - p
      const pb = p > b ? p - b : b - p
      const pc = p > c ? p - c : c - p
      sPaeth += abs8(x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c))
    }
  }
  let best = 0
  let bestScore = sNone * NONE_BIAS
  if (sUp < bestScore) {
    best = 2
    bestScore = sUp
  }
  if (sSub < bestScore) {
    best = 1
    bestScore = sSub
  }
  if (sPaeth < bestScore) best = 4
  return best
}

function filterSub(out: Uint8Array, cur: Uint8Array, stride: number, bpp: number) {
  out[0] = 1
  for (let i = 0; i < bpp; i++) out[i + 1] = cur[i]
  for (let i = bpp; i < stride; i++) out[i + 1] = (cur[i] - cur[i - bpp]) & 0xff
}
function filterUp(out: Uint8Array, cur: Uint8Array, prev: Uint8Array | null, stride: number) {
  out[0] = 2
  if (!prev) out.set(cur, 1)
  else for (let i = 0; i < stride; i++) out[i + 1] = (cur[i] - prev[i]) & 0xff
}
function filterPaeth(
  out: Uint8Array,
  cur: Uint8Array,
  prev: Uint8Array | null,
  stride: number,
  bpp: number,
) {
  out[0] = 4
  for (let i = 0; i < stride; i++) {
    const a = i >= bpp ? cur[i - bpp] : 0
    const b = prev ? prev[i] : 0
    const c = prev && i >= bpp ? prev[i - bpp] : 0
    const p = a + b - c
    const pa = p > a ? p - a : a - p
    const pb = p > b ? p - b : b - p
    const pc = p > c ? p - c : c - p
    out[i + 1] = (cur[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
  }
}

/* ---------- 解析（驗證用） ---------- */

export interface PngChunkInfo {
  type: string
  length: number
  crcOk: boolean
}

/** 讀出 PNG 的 chunk 清單並檢查 CRC；回傳 IHDR 尺寸 */
export function inspectPng(bytes: Uint8Array): {
  ok: boolean
  width: number
  height: number
  colorType: number
  chunks: PngChunkInfo[]
} {
  const sigOk = PNG_SIGNATURE.every((b, i) => bytes[i] === b)
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks: PngChunkInfo[] = []
  let off = 8
  let width = 0
  let height = 0
  let colorType = -1
  while (off + 12 <= bytes.length) {
    const len = v.getUint32(off)
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8))
    const data = bytes.subarray(off + 8, off + 8 + len)
    const crc = v.getUint32(off + 8 + len)
    const calc = crc32(data, crc32(bytes.subarray(off + 4, off + 8)))
    chunks.push({ type, length: len, crcOk: calc === crc })
    if (type === 'IHDR') {
      width = v.getUint32(off + 8)
      height = v.getUint32(off + 12)
      colorType = bytes[off + 17]
    }
    off += 12 + len
    if (type === 'IEND') break
  }
  const ok =
    sigOk &&
    chunks[0]?.type === 'IHDR' &&
    chunks[chunks.length - 1]?.type === 'IEND' &&
    chunks.every((c) => c.crcOk) &&
    off === bytes.length
  return { ok, width, height, colorType, chunks }
}
