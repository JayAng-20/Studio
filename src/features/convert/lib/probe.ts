/**
 * 不解碼整張圖，只讀檔頭：辨識格式、取得尺寸、判斷是否為動畫（純函式＋Blob 讀取）。
 */

export type SourceFormat =
  | 'jpeg'
  | 'png'
  | 'apng'
  | 'webp'
  | 'gif'
  | 'bmp'
  | 'avif'
  | 'heic'
  | 'svg'
  | 'ico'
  | 'tiff'
  | 'unknown'

export interface ProbeResult {
  format: SourceFormat
  width?: number
  height?: number
  /** 動畫（GIF、APNG、動態 WebP）的格數；靜態圖為 1 或未知 */
  frames?: number
  animated?: boolean
  /** 從檔頭推測可能含透明 */
  alpha?: boolean
}

const ascii = (b: Uint8Array, o: number, n: number) => {
  let s = ''
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i])
  return s
}
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1]
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])
const u32le = (b: Uint8Array, o: number) => ((b[o + 3] << 24) >>> 0) + ((b[o + 2] << 16) | (b[o + 1] << 8) | b[o])
const i32le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2']

/** 由開頭位元組辨識格式 */
export function sniffFormat(b: Uint8Array): SourceFormat {
  if (b.length < 4) return 'unknown'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png'
  if (ascii(b, 0, 4) === 'GIF8') return 'gif'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ico'
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a))
    return 'tiff'
  if (ascii(b, 4, 4) === 'ftyp') {
    const size = Math.min(u32be(b, 0), b.length)
    const brands = [ascii(b, 8, 4)]
    for (let o = 16; o + 4 <= size; o += 4) brands.push(ascii(b, o, 4))
    if (brands.includes('avif') || brands.includes('avis')) return 'avif'
    if (brands.some((x) => HEIC_BRANDS.includes(x))) return 'heic'
    return 'unknown'
  }
  // SVG：文字檔，跳過 BOM、空白、XML 宣告與註解
  const text = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 4096))).replace(/^\uFEFF/, '')
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(text)) return 'svg'
  return 'unknown'
}

/** 依副檔名推測（無法從內容辨識時的備援） */
export function formatFromName(name: string): SourceFormat {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, SourceFormat> = {
    jpg: 'jpeg',
    jpeg: 'jpeg',
    jfif: 'jpeg',
    png: 'png',
    apng: 'apng',
    webp: 'webp',
    gif: 'gif',
    bmp: 'bmp',
    avif: 'avif',
    heic: 'heic',
    heif: 'heic',
    svg: 'svg',
    ico: 'ico',
    tif: 'tiff',
    tiff: 'tiff',
  }
  return map[ext] ?? 'unknown'
}

/** JPEG：掃描 SOF 取得尺寸，並讀 EXIF 方向（5 到 8 會交換寬高） */
export function jpegInfo(b: Uint8Array): { width: number; height: number } | null {
  let i = 2
  let orientation = 1
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const m = b[i + 1]
    if (m === 0xff) {
      i++
      continue
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2
      continue
    }
    const len = u16be(b, i + 2)
    if (m === 0xe1 && ascii(b, i + 4, 4) === 'Exif') orientation = exifOrientation(b, i + 10) ?? 1
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = u16be(b, i + 5)
      const w = u16be(b, i + 7)
      return orientation >= 5 ? { width: h, height: w } : { width: w, height: h }
    }
    if (m === 0xda || m === 0xd9) return null
    i += 2 + len
  }
  return null
}

function exifOrientation(b: Uint8Array, t: number): number | null {
  if (t + 8 > b.length) return null
  const le = b[t] === 0x49
  const r16 = (o: number) => (le ? u16le(b, t + o) : u16be(b, t + o))
  const r32 = (o: number) => (le ? u32le(b, t + o) : u32be(b, t + o))
  const ifd = r32(4)
  if (t + ifd + 2 > b.length) return null
  const n = r16(ifd)
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (t + e + 12 > b.length) return null
    if (r16(e) === 0x0112) return r16(e + 8)
  }
  return null
}

function pngInfo(b: Uint8Array): ProbeResult {
  const width = u32be(b, 16)
  const height = u32be(b, 20)
  const colorType = b[25]
  let alpha = colorType === 4 || colorType === 6
  let frames = 1
  let animated = false
  let o = 8
  while (o + 8 <= b.length) {
    const len = u32be(b, o)
    const type = ascii(b, o + 4, 4)
    if (type === 'acTL') {
      frames = u32be(b, o + 8)
      animated = frames > 1
    }
    if (type === 'tRNS') alpha = true
    if (type === 'IDAT' || type === 'IEND') break
    o += 12 + len
  }
  return { format: animated ? 'apng' : 'png', width, height, frames, animated, alpha }
}

function webpInfo(b: Uint8Array): ProbeResult {
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8X' && b.length >= 30) {
    const flags = b[20]
    return {
      format: 'webp',
      width: 1 + u24le(b, 24),
      height: 1 + u24le(b, 27),
      animated: (flags & 0x02) !== 0,
      alpha: (flags & 0x10) !== 0,
      frames: (flags & 0x02) !== 0 ? countWebpFrames(b) : 1,
    }
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = u32le(b, 21)
    return {
      format: 'webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      alpha: ((bits >>> 28) & 1) === 1,
      frames: 1,
    }
  }
  if (chunk === 'VP8 ' && b.length >= 30) {
    return {
      format: 'webp',
      width: u16le(b, 26) & 0x3fff,
      height: u16le(b, 28) & 0x3fff,
      alpha: false,
      frames: 1,
    }
  }
  return { format: 'webp' }
}

function countWebpFrames(b: Uint8Array): number | undefined {
  let o = 12
  let n = 0
  while (o + 8 <= b.length) {
    const type = ascii(b, o, 4)
    const len = u32le(b, o + 4)
    if (type === 'ANMF') n++
    o += 8 + len + (len & 1)
  }
  // 只讀了檔頭的一部分時，格數不完整
  return o >= b.length - 8 && n > 0 ? n : undefined
}

/** GIF：數影像描述區塊（0x2C）；需要掃過整個檔案 */
export function gifInfo(b: Uint8Array): ProbeResult {
  const width = u16le(b, 6)
  const height = u16le(b, 8)
  const packed = b[10]
  let o = 13
  if (packed & 0x80) o += 3 * (1 << ((packed & 7) + 1))
  let frames = 0
  let alpha = false
  let complete = false
  const skipSub = (p: number) => {
    while (p < b.length) {
      const n = b[p]
      p += 1
      if (n === 0) return p
      p += n
    }
    return p
  }
  while (o < b.length) {
    const c = b[o]
    if (c === 0x3b) {
      complete = true
      break
    }
    if (c === 0x21) {
      // 延伸區塊：圖形控制延伸可得知是否透明
      if (b[o + 1] === 0xf9 && b[o + 3] & 1) alpha = true
      o = skipSub(o + 2)
    } else if (c === 0x2c) {
      frames++
      const p = b[o + 9]
      o += 10
      if (p & 0x80) o += 3 * (1 << ((p & 7) + 1))
      o = skipSub(o + 1) // LZW 最小碼長之後是資料子區塊
    } else break
  }
  return {
    format: 'gif',
    width,
    height,
    frames: complete || frames > 1 ? frames : undefined,
    animated: frames > 1,
    alpha,
  }
}

function bmpInfo(b: Uint8Array): ProbeResult {
  const bpp = u16le(b, 28)
  return { format: 'bmp', width: Math.abs(i32le(b, 18)), height: Math.abs(i32le(b, 22)), alpha: bpp === 32 }
}

/** HEIC／AVIF：在 meta 裡找所有 ispe，取面積最大者（格狀影像的完整尺寸）；irot 90／270 交換寬高 */
export function isobmffInfo(b: Uint8Array): { width: number; height: number } | null {
  let best: { width: number; height: number } | null = null
  let rotate = false
  const walk = (from: number, to: number, depth: number) => {
    let o = from
    while (o + 8 <= to && depth < 6) {
      let size = u32be(b, o)
      const type = ascii(b, o + 4, 4)
      let header = 8
      if (size === 1) {
        size = u32be(b, o + 8) * 2 ** 32 + u32be(b, o + 12)
        header = 16
      } else if (size === 0) size = to - o
      if (size < header) return
      const end = Math.min(to, o + size)
      if (type === 'meta') walk(o + header + 4, end, depth + 1)
      else if (type === 'iprp' || type === 'ipco') walk(o + header, end, depth + 1)
      else if (type === 'ispe' && o + header + 12 <= b.length) {
        const w = u32be(b, o + header + 4)
        const h = u32be(b, o + header + 8)
        if (!best || w * h > best.width * best.height) best = { width: w, height: h }
      } else if (type === 'irot' && o + header < b.length) {
        const angle = b[o + header] & 3
        if (angle === 1 || angle === 3) rotate = true
      }
      if (type === 'mdat') return
      o = end
    }
  }
  walk(0, b.length, 0)
  const r = best as { width: number; height: number } | null
  if (!r) return null
  return rotate ? { width: r.height, height: r.width } : r
}

/** SVG：讀根元素的 width／height（px 或無單位），或 viewBox */
export function svgInfo(text: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0]
  if (!tag) return null
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]
  const len = (v?: string) => {
    if (!v) return undefined
    const m = /^\s*([\d.]+)\s*(px)?\s*$/i.exec(v)
    return m ? parseFloat(m[1]) : undefined
  }
  const vb = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const vbW = vb && vb.length === 4 && vb[2] > 0 ? vb[2] : undefined
  const vbH = vb && vb.length === 4 && vb[3] > 0 ? vb[3] : undefined
  let w = len(attr('width'))
  let h = len(attr('height'))
  if (w && !h && vbW && vbH) h = (w * vbH) / vbW
  if (h && !w && vbW && vbH) w = (h * vbW) / vbH
  w ??= vbW
  h ??= vbH
  if (!w || !h) return null
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }
}

/** 由位元組判斷（測試可直接呼叫） */
export function probeBytes(b: Uint8Array, name = ''): ProbeResult {
  let format = sniffFormat(b)
  if (format === 'unknown') format = formatFromName(name)
  try {
    switch (format) {
      case 'jpeg':
        return { format, ...(jpegInfo(b) ?? {}), frames: 1, alpha: false }
      case 'png':
      case 'apng':
        return b.length > 24 ? pngInfo(b) : { format }
      case 'webp':
        return b.length >= 16 ? webpInfo(b) : { format }
      case 'gif':
        return gifInfo(b)
      case 'bmp':
        return bmpInfo(b)
      case 'avif':
      case 'heic':
        return { format, ...(isobmffInfo(b) ?? {}), frames: 1 }
      case 'svg':
        return { format, ...(svgInfo(new TextDecoder().decode(b)) ?? {}), alpha: true, frames: 1 }
      default:
        return { format }
    }
  } catch {
    return { format }
  }
}

/** 讀檔頭並辨識（GIF 與動態 WebP 會多讀以計算格數） */
export async function probeFile(file: Blob & { name?: string }): Promise<ProbeResult> {
  const headLen = Math.min(file.size, 512 * 1024)
  let b = new Uint8Array(await file.slice(0, headLen).arrayBuffer())
  const f = sniffFormat(b)
  const needAll = (f === 'gif' || f === 'webp') && file.size > headLen && file.size <= 64 * 1024 * 1024
  if (needAll) b = new Uint8Array(await file.arrayBuffer())
  return probeBytes(b, file.name ?? '')
}
