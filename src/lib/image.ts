/** 影像共用工具：解碼、編碼、釋放 */

export type OutputMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'

/** 解碼成 ImageBitmap（自動套用 EXIF 方向） */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    // Safari 對部分格式（例如 SVG）不支援 createImageBitmap(blob)，改用 <img>
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await img.decode()
      const w = img.naturalWidth || 1024
      const h = img.naturalHeight || 1024
      return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h })
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/** 釋放 canvas 記憶體 */
export function releaseCanvas(c: HTMLCanvasElement | OffscreenCanvas | null | undefined) {
  if (!c) return
  c.width = 0
  c.height = 0
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失敗'))), type, quality),
  )
}

export async function toPngBlob(blob: Blob): Promise<Blob> {
  const bmp = await decodeImage(blob)
  const c = createCanvas(bmp.width, bmp.height)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  try {
    return await canvasToBlob(c, 'image/png')
  } finally {
    releaseCanvas(c)
  }
}

const encodeSupportCache = new Map<string, Promise<boolean>>()

/** 偵測 canvas 是否真的能編碼某格式（不支援時瀏覽器會默默退回 PNG） */
export function canEncode(mime: string): Promise<boolean> {
  if (mime === 'image/png') return Promise.resolve(true)
  let p = encodeSupportCache.get(mime)
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      try {
        const c = createCanvas(2, 2)
        c.toBlob((b) => resolve(!!b && b.type === mime), mime, 0.8)
      } catch {
        resolve(false)
      }
    })
    encodeSupportCache.set(mime, p)
  }
  return p
}

/** 透過 <img> 取得尺寸（不解碼整張） */
export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await decodeImage(blob)
  const s = { width: bmp.width, height: bmp.height }
  bmp.close()
  return s
}
