/** 主執行緒的圖片轉換：PDF 只能直接嵌入 PNG／JPEG，其他格式（GIF、WebP、SVG、BMP、AVIF）先用 canvas 轉成 PNG */
import type { ImageData } from '../engine/model'

const MAX_SIDE = 3000

async function decode(
  blob: Blob,
): Promise<{ source: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (blob.type !== 'image/svg+xml' && typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob)
      return { source: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() }
    } catch {
      // 退回 <img>
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    // SVG 沒有固有尺寸時給一個合理的預設
    const w = img.naturalWidth || 800
    const h = img.naturalHeight || 600
    return { source: img, w, h, close: () => undefined }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function convertImageToPng(
  bytes: Uint8Array,
  mime: string,
): Promise<ImageData | null> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })
  const d = await decode(blob)
  try {
    const k = Math.min(1, MAX_SIDE / Math.max(d.w, d.h))
    const w = Math.max(1, Math.round(d.w * k))
    const h = Math.max(1, Math.round(d.h * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(d.source, 0, 0, w, h)
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    canvas.width = canvas.height = 0
    if (!out) return null
    return { bytes: new Uint8Array(await out.arrayBuffer()), format: 'png', width: w, height: h }
  } finally {
    d.close()
  }
}
