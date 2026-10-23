/**
 * 瀏覽器端的影像處理：文字圖章（Canvas 繪成透明 PNG，支援中文不必嵌入字型）、
 * 圖片解碼與重新編碼（給圖片轉 PDF、圖片浮水印、掃描式壓縮使用）。
 */
import { canvasToBlob, createCanvas, decodeImage, releaseCanvas } from '@/lib/image'
import type { EncodedImage } from './ops'
import type { Size } from './placement'

/** 文字圖章的解析度：每 pt 幾個像素（約 288 dpi） */
const PX_PER_PT = 4
const MAX_STAMP_PX = 4096

export const STAMP_FONT =
  '"Inter Variable", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif'

export interface TextStampOptions {
  text: string
  /** 字級（pt） */
  sizePt: number
  color: string
  bold?: boolean
  /** 外框描邊（讓頁碼在深色背景上也看得見）；預設無 */
  outline?: string
  /** 多行時的對齊（預設置中） */
  align?: 'center' | 'left'
}

export interface RenderedStamp {
  image: EncodedImage
  /** 在 PDF 中的尺寸（pt） */
  size: Size
}

/** 文字 → 透明 PNG（多行以換行分隔） */
export async function renderTextStamp(o: TextStampOptions): Promise<RenderedStamp | null> {
  const lines = o.text.split(/\r?\n/).map((l) => l.trimEnd())
  if (!lines.some((l) => l.trim())) return null
  // 字級太大時降低解析度，避免畫布超過上限
  const font = (px: number) => `${o.bold ? 700 : 500} ${px}px ${STAMP_FONT}`
  const probe = createCanvas(1, 1)
  const pctx = probe.getContext('2d')!
  let scale = PX_PER_PT
  pctx.font = font(o.sizePt * scale)
  const measure = () => Math.max(...lines.map((l) => pctx.measureText(l || ' ').width))
  let maxW = measure()
  if (maxW > MAX_STAMP_PX * 0.9) {
    scale = (scale * MAX_STAMP_PX * 0.9) / maxW
    pctx.font = font(o.sizePt * scale)
    maxW = measure()
  }
  releaseCanvas(probe)
  const px = o.sizePt * scale
  const lineH = px * 1.25
  const pad = Math.ceil(px * 0.12) + (o.outline ? Math.ceil(px * 0.08) : 0)
  const w = Math.ceil(maxW + pad * 2)
  const h = Math.ceil(lineH * lines.length + pad * 2)
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')!
  ctx.font = font(px)
  ctx.textBaseline = 'middle'
  const left = o.align === 'left'
  ctx.textAlign = left ? 'left' : 'center'
  const tx = left ? pad : w / 2
  lines.forEach((l, i) => {
    const y = pad + lineH * (i + 0.5)
    if (o.outline) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = px * 0.16
      ctx.strokeStyle = o.outline
      ctx.strokeText(l, tx, y)
    }
    ctx.fillStyle = o.color
    ctx.fillText(l, tx, y)
  })
  try {
    const blob = await canvasToBlob(c, 'image/png')
    return {
      image: { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png', width: w, height: h },
      size: { w: w / scale, h: h / scale },
    }
  } finally {
    releaseCanvas(c)
  }
}

const isHeicFile = (f: File) => /image\/hei[cf]/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)

/** 解碼任何支援的圖片（HEIC 首次使用才載入解碼器） */
export async function decodeAny(file: File): Promise<ImageBitmap> {
  if (isHeicFile(file)) {
    const { heicTo } = await (await import('@/lib/heic')).loadHeic()
    return heicTo({ blob: file, type: 'bitmap' })
  }
  return decodeImage(file)
}

/** 讀取 JPEG 的 EXIF 方向（1 為正常；讀不到時當作 1） */
async function jpegOrientation(file: File): Promise<number> {
  try {
    const exifr = await import('exifr')
    const o = await exifr.orientation(file)
    return typeof o === 'number' ? o : 1
  } catch {
    return 1
  }
}

/** 讀出 PNG 的尺寸（IHDR），不必解碼整張 */
function pngSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { w: v.getUint32(16), h: v.getUint32(20) }
}

/**
 * 把圖片檔轉成可嵌入 PDF 的 JPEG／PNG：
 * - JPEG（方向正常）與 PNG 直接沿用原始位元組，不重新壓縮、不損失畫質
 * - 其他格式（HEIC、WebP、AVIF、GIF、BMP、SVG）或需要套用方向的 JPEG 以 Canvas 重新編碼：
 *   有透明像素用 PNG，否則用高品質 JPEG
 */
export async function encodeForPdf(file: File, quality = 0.92): Promise<EncodedImage> {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  const isJpeg = type === 'image/jpeg' || /\.jpe?g$/.test(name)
  const isPng = type === 'image/png' || /\.png$/.test(name)
  if (isPng) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const s = pngSize(bytes)
    if (s) return { bytes, type: 'png', width: s.w, height: s.h }
  }
  if (isJpeg && (await jpegOrientation(file)) === 1) {
    const bmp = await decodeImage(file)
    const size = { w: bmp.width, h: bmp.height }
    bmp.close()
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      type: 'jpg',
      width: size.w,
      height: size.h,
    }
  }
  const bmp = await decodeAny(file)
  try {
    return await bitmapToEncoded(bmp, isJpeg ? 'jpg' : 'auto', quality)
  } finally {
    bmp.close()
  }
}

/** ImageBitmap → JPEG／PNG（auto：有透明用 PNG） */
export async function bitmapToEncoded(
  bmp: ImageBitmap | HTMLCanvasElement,
  type: 'jpg' | 'png' | 'auto',
  quality = 0.92,
): Promise<EncodedImage> {
  const c = createCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d', { willReadFrequently: type === 'auto' })!
  ctx.drawImage(bmp, 0, 0)
  try {
    let out = type
    if (out === 'auto') out = hasAlpha(ctx, c.width, c.height) ? 'png' : 'jpg'
    if (out === 'jpg') {
      // JPEG 沒有透明：先鋪白底
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
    }
    const blob = await canvasToBlob(c, out === 'png' ? 'image/png' : 'image/jpeg', quality)
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      type: out,
      width: c.width,
      height: c.height,
    }
  } finally {
    releaseCanvas(c)
  }
}

/** 抽樣檢查是否有透明像素（大圖每隔幾個像素看一次） */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250_000))) * 4
  for (let i = 3; i < data.length; i += step) if (data[i] < 250) return true
  return false
}

/** 產生小縮圖（物件網址）：給清單顯示用 */
export async function thumbnailUrl(bmp: ImageBitmap, max = 320): Promise<string> {
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = createCanvas(bmp.width * k, bmp.height * k)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  try {
    return URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.85))
  } finally {
    releaseCanvas(c)
  }
}

/** 圖片浮水印：解碼後轉成 PNG（保留透明），長邊最多 2000 px */
export async function encodeWatermarkImage(file: File): Promise<EncodedImage & { url: string }> {
  const bmp = await decodeAny(file)
  try {
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const c = createCanvas(bmp.width * k, bmp.height * k)
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, c.width, c.height)
    try {
      const blob = await canvasToBlob(c, 'image/png')
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        type: 'png',
        width: c.width,
        height: c.height,
        url: URL.createObjectURL(blob),
      }
    } finally {
      releaseCanvas(c)
    }
  } finally {
    bmp.close()
  }
}
