/**
 * 動態 WebP 封裝（純函式）：把每一格的單張 WebP 取出影像 chunk（ALPH＋VP8 或 VP8L），
 * 包成 ANMF，再加上 VP8X（動畫旗標）與 ANIM（背景色、循環次數）。
 */

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

export interface WebpFrame {
  /** ALPH／VP8／VP8L chunk（含 chunk 標頭） */
  chunks: Uint8Array
  width: number
  height: number
  alpha: boolean
  /** 毫秒 */
  duration: number
}

/** 從單張 WebP 取出影像 chunk 與尺寸 */
export function extractFrameChunks(webp: Uint8Array): Omit<WebpFrame, 'duration'> {
  if (ascii(webp, 0, 4) !== 'RIFF' || ascii(webp, 8, 4) !== 'WEBP') throw new Error('不是 WebP')
  const parts: Uint8Array[] = []
  let width = 0
  let height = 0
  let alpha = false
  let o = 12
  while (o + 8 <= webp.length) {
    const type = ascii(webp, o, 4)
    const len = u32le(webp, o + 4)
    const end = Math.min(webp.length, o + 8 + len + (len & 1))
    const d = o + 8
    if (type === 'VP8X') {
      width = 1 + (webp[d + 4] | (webp[d + 5] << 8) | (webp[d + 6] << 16))
      height = 1 + (webp[d + 7] | (webp[d + 8] << 8) | (webp[d + 9] << 16))
      alpha = (webp[d] & 0x10) !== 0
    } else if (type === 'ALPH') {
      alpha = true
      parts.push(webp.subarray(o, end))
    } else if (type === 'VP8 ') {
      if (!width) {
        width = (webp[d + 6] | (webp[d + 7] << 8)) & 0x3fff
        height = (webp[d + 8] | (webp[d + 9] << 8)) & 0x3fff
      }
      parts.push(webp.subarray(o, end))
    } else if (type === 'VP8L') {
      const bits = u32le(webp, d + 1)
      if (!width) {
        width = (bits & 0x3fff) + 1
        height = ((bits >>> 14) & 0x3fff) + 1
      }
      if ((bits >>> 28) & 1) alpha = true
      parts.push(webp.subarray(o, end))
    }
    o = end
  }
  if (!parts.length || !width || !height) throw new Error('WebP 中沒有影像資料')
  const chunks = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let w = 0
  for (const p of parts) {
    chunks.set(p, w)
    w += p.length
  }
  return { chunks, width, height, alpha }
}

const u24 = (out: Uint8Array, o: number, v: number) => {
  out[o] = v & 255
  out[o + 1] = (v >> 8) & 255
  out[o + 2] = (v >> 16) & 255
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const pad = body.length & 1
  const out = new Uint8Array(8 + body.length + pad)
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i)
  new DataView(out.buffer).setUint32(4, body.length, true)
  out.set(body, 8)
  return out
}

/** 組成動態 WebP；每格都是完整畫面，所以不混合（blend）也不處置 */
export function muxAnimatedWebp(
  frames: WebpFrame[],
  opts: { width: number; height: number; loop?: number; background?: [number, number, number, number] },
): Uint8Array {
  if (!frames.length) throw new Error('沒有影格')
  const { width, height, loop = 0, background = [0, 0, 0, 0] } = opts
  const anyAlpha = frames.some((f) => f.alpha)
  const vp8x = new Uint8Array(10)
  vp8x[0] = 0x02 | (anyAlpha ? 0x10 : 0)
  u24(vp8x, 4, width - 1)
  u24(vp8x, 7, height - 1)
  const anim = new Uint8Array(6)
  // 背景色順序為 B、G、R、A
  anim.set([background[2], background[1], background[0], background[3]])
  anim[4] = loop & 255
  anim[5] = (loop >> 8) & 255
  const parts: Uint8Array[] = [chunk('VP8X', vp8x), chunk('ANIM', anim)]
  for (const f of frames) {
    const head = new Uint8Array(16)
    u24(head, 0, 0)
    u24(head, 3, 0)
    u24(head, 6, f.width - 1)
    u24(head, 9, f.height - 1)
    u24(head, 12, Math.max(0, Math.min(0xffffff, Math.round(f.duration))))
    head[15] = 0x02 // 不混合、不處置
    const body = new Uint8Array(16 + f.chunks.length)
    body.set(head)
    body.set(f.chunks, 16)
    parts.push(chunk('ANMF', body))
  }
  const payload = 4 + parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(8 + payload)
  out.set([0x52, 0x49, 0x46, 0x46]) // RIFF
  new DataView(out.buffer).setUint32(4, payload, true)
  out.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  let o = 12
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
