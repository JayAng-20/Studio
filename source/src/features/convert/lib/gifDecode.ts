/**
 * GIF 解碼（純 JS）：在不支援 ImageDecoder 的瀏覽器上逐格取出動畫。
 * parseGif 只解析結構並記錄壓縮資料位置；compositeGif 逐格 LZW 解壓並依處置方式合成完整畫面。
 */

export interface GifFrameInfo {
  x: number
  y: number
  width: number
  height: number
  /** 毫秒 */
  delay: number
  /** 0／1：保留、2：還原成背景（透明）、3：還原成上一格 */
  disposal: number
  /** -1 表示沒有透明色 */
  transparentIndex: number
  interlaced: boolean
  /** RGB 三元組 */
  palette: Uint8Array
  minCodeSize: number
  /** 壓縮資料（子區塊已串接） */
  data: Uint8Array
}

export interface ParsedGif {
  width: number
  height: number
  /** 0 表示無限循環；未指定時為 1（播一次） */
  loop: number
  frames: GifFrameInfo[]
}

export function parseGif(b: Uint8Array): ParsedGif {
  const sig = String.fromCharCode(...b.subarray(0, 6))
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('不是 GIF')
  const width = b[6] | (b[7] << 8)
  const height = b[8] | (b[9] << 8)
  const packed = b[10]
  let p = 13
  let globalPalette = new Uint8Array(0)
  if (packed & 0x80) {
    const n = 3 * (1 << ((packed & 7) + 1))
    globalPalette = b.slice(p, p + n)
    p += n
  }
  const frames: GifFrameInfo[] = []
  let loop = 1
  let delay = 0
  let disposal = 0
  let transparentIndex = -1
  const readSub = (): Uint8Array => {
    const parts: Uint8Array[] = []
    let total = 0
    while (p < b.length) {
      const n = b[p++]
      if (n === 0) break
      parts.push(b.subarray(p, p + n))
      total += n
      p += n
    }
    const out = new Uint8Array(total)
    let o = 0
    for (const s of parts) {
      out.set(s, o)
      o += s.length
    }
    return out
  }
  while (p < b.length) {
    const c = b[p++]
    if (c === 0x3b) break
    if (c === 0x21) {
      const label = b[p++]
      if (label === 0xf9) {
        const block = readSub()
        disposal = (block[0] >> 2) & 7
        delay = (block[1] | (block[2] << 8)) * 10
        transparentIndex = block[0] & 1 ? block[3] : -1
      } else if (label === 0xff) {
        const id = String.fromCharCode(...b.subarray(p + 1, p + 12))
        const block = readSub()
        if (id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') {
          // 第一個子區塊是識別碼，第二個是循環次數；readSub 已把兩者串在一起
          const off = 11
          if (block.length >= off + 3 && block[off] === 1)
            loop = block[off + 1] | (block[off + 2] << 8)
        }
      } else readSub()
      continue
    }
    if (c !== 0x2c) break
    const x = b[p] | (b[p + 1] << 8)
    const y = b[p + 2] | (b[p + 3] << 8)
    const w = b[p + 4] | (b[p + 5] << 8)
    const h = b[p + 6] | (b[p + 7] << 8)
    const fp = b[p + 8]
    p += 9
    let palette = globalPalette
    if (fp & 0x80) {
      const n = 3 * (1 << ((fp & 7) + 1))
      palette = b.slice(p, p + n)
      p += n
    }
    const minCodeSize = b[p++]
    const data = readSub()
    frames.push({
      x,
      y,
      width: w,
      height: h,
      delay,
      disposal,
      transparentIndex,
      interlaced: (fp & 0x40) !== 0,
      palette,
      minCodeSize,
      data,
    })
    delay = 0
    disposal = 0
    transparentIndex = -1
  }
  return { width, height, loop, frames }
}

/** GIF 變長 LZW 解壓 */
export function lzwDecode(minCodeSize: number, data: Uint8Array, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount)
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  const prefix = new Int16Array(4096)
  const suffix = new Uint8Array(4096)
  const stack = new Uint8Array(4097)
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1
    suffix[i] = i
  }
  let codeSize = minCodeSize + 1
  let mask = (1 << codeSize) - 1
  let next = eoi + 1
  let old = -1
  let first = 0
  let op = 0
  let bits = 0
  let datum = 0
  let pi = 0
  while (op < pixelCount) {
    while (bits < codeSize) {
      if (pi >= data.length) return out
      datum |= data[pi++] << bits
      bits += 8
    }
    let code = datum & mask
    datum >>>= codeSize
    bits -= codeSize
    if (code === clear) {
      codeSize = minCodeSize + 1
      mask = (1 << codeSize) - 1
      next = eoi + 1
      old = -1
      continue
    }
    if (code === eoi) break
    if (old === -1) {
      if (code >= clear) return out
      out[op++] = suffix[code]
      old = code
      first = code
      continue
    }
    const inCode = code
    let sp = 0
    if (code >= next) {
      stack[sp++] = first
      code = old
    }
    while (code >= clear) {
      if (sp >= 4096) return out
      stack[sp++] = suffix[code]
      code = prefix[code]
    }
    first = suffix[code]
    stack[sp++] = first
    if (next < 4096) {
      prefix[next] = old
      suffix[next] = first
      next++
      if (next === 1 << codeSize && codeSize < 12) {
        codeSize++
        mask = (1 << codeSize) - 1
      }
    }
    old = inCode
    while (sp > 0 && op < pixelCount) out[op++] = stack[--sp]
  }
  return out
}

function deinterlace(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length)
  let row = 0
  const passes: Array<[number, number]> = [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ]
  for (const [start, step] of passes) {
    for (let y = start; y < h; y += step) {
      out.set(src.subarray(row * w, row * w + w), y * w)
      row++
    }
  }
  return out
}

/**
 * 逐格合成完整畫面（RGBA）。回傳的 rgba 會在下一格被覆寫，呼叫端要在 yield 之後立即使用。
 */
export function* compositeGif(
  gif: ParsedGif,
): Generator<{ rgba: Uint8ClampedArray<ArrayBuffer>; delay: number; index: number }> {
  const { width: W, height: H } = gif
  const canvas = new Uint8ClampedArray(W * H * 4)
  let saved: Uint8ClampedArray<ArrayBuffer> | null = null
  for (let i = 0; i < gif.frames.length; i++) {
    const f = gif.frames[i]
    if (f.disposal === 3) saved = canvas.slice()
    let idx = lzwDecode(f.minCodeSize, f.data, f.width * f.height)
    if (f.interlaced) idx = deinterlace(idx, f.width, f.height)
    const pal = f.palette
    for (let y = 0; y < f.height; y++) {
      const cy = f.y + y
      if (cy >= H) break
      for (let x = 0; x < f.width; x++) {
        const cx = f.x + x
        if (cx >= W) break
        const ci = idx[y * f.width + x]
        if (ci === f.transparentIndex) continue
        const o = (cy * W + cx) * 4
        canvas[o] = pal[ci * 3] ?? 0
        canvas[o + 1] = pal[ci * 3 + 1] ?? 0
        canvas[o + 2] = pal[ci * 3 + 2] ?? 0
        canvas[o + 3] = 255
      }
    }
    yield { rgba: canvas, delay: f.delay, index: i }
    if (f.disposal === 2) {
      for (let y = f.y; y < Math.min(H, f.y + f.height); y++)
        canvas.fill(0, (y * W + f.x) * 4, (y * W + Math.min(W, f.x + f.width)) * 4)
    } else if (f.disposal === 3 && saved) {
      canvas.set(saved)
    }
  }
}
