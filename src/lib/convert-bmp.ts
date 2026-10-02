/**
 * BMP 編碼（自行實作）：
 * - 不透明圖：24 位元 BI_RGB，BITMAPINFOHEADER（40 bytes），每列補齊到 4 bytes，由下往上。
 * - 有透明：32 位元 BI_BITFIELDS，BITMAPV4HEADER（108 bytes）含 alpha 遮罩，色彩空間 sRGB。
 */

export interface RgbaImage {
  /** RGBA，非預乘 */
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

const FILE_HEADER = 14
const INFO_HEADER = 40
const V4_HEADER = 108
/** 72 DPI ≈ 2835 像素／公尺 */
const PPM = 2835

/** 是否有任何不完全不透明的像素 */
export function hasTransparency(data: Uint8ClampedArray | Uint8Array): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true
  return false
}

export function bmpRowSize(width: number, bitCount: 24 | 32): number {
  return Math.ceil((width * bitCount) / 32) * 4
}

export function encodeBmp(img: RgbaImage, opts: { alpha?: boolean | 'auto' } = {}): Uint8Array {
  const { data, width, height } = img
  if (width < 1 || height < 1) throw new Error('BMP 尺寸無效')
  if (data.length < width * height * 4) throw new Error('像素資料長度不足')
  const alpha =
    opts.alpha === undefined || opts.alpha === 'auto' ? hasTransparency(data) : opts.alpha
  const bitCount: 24 | 32 = alpha ? 32 : 24
  const dib = alpha ? V4_HEADER : INFO_HEADER
  const row = bmpRowSize(width, bitCount)
  const imageSize = row * height
  const offset = FILE_HEADER + dib
  const out = new Uint8Array(offset + imageSize)
  const v = new DataView(out.buffer)

  // BITMAPFILEHEADER
  out[0] = 0x42 // 'B'
  out[1] = 0x4d // 'M'
  v.setUint32(2, out.length, true)
  v.setUint32(6, 0, true)
  v.setUint32(10, offset, true)

  // DIB header
  const h = FILE_HEADER
  v.setUint32(h, dib, true)
  v.setInt32(h + 4, width, true)
  v.setInt32(h + 8, height, true) // 正值 = 由下往上
  v.setUint16(h + 12, 1, true)
  v.setUint16(h + 14, bitCount, true)
  v.setUint32(h + 16, alpha ? 3 : 0, true) // BI_BITFIELDS : BI_RGB
  v.setUint32(h + 20, imageSize, true)
  v.setInt32(h + 24, PPM, true)
  v.setInt32(h + 28, PPM, true)
  v.setUint32(h + 32, 0, true)
  v.setUint32(h + 36, 0, true)
  if (alpha) {
    v.setUint32(h + 40, 0x00ff0000, true) // R
    v.setUint32(h + 44, 0x0000ff00, true) // G
    v.setUint32(h + 48, 0x000000ff, true) // B
    v.setUint32(h + 52, 0xff000000, true) // A
    v.setUint32(h + 56, 0x73524742, true) // LCS_sRGB（'sRGB'）
    // 其餘（CIEXYZTRIPLE 端點與 gamma）保持 0
  }

  // 像素：BGR(A)，由下往上
  const bpp = bitCount / 8
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4
    let dst = offset + y * row
    for (let x = 0; x < width; x++) {
      const s = src + x * 4
      out[dst] = data[s + 2]
      out[dst + 1] = data[s + 1]
      out[dst + 2] = data[s]
      if (alpha) out[dst + 3] = data[s + 3]
      dst += bpp
    }
  }
  return out
}
