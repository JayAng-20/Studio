/**
 * 需要在主執行緒解碼的格式：
 * - HEIC／HEIF：heic-to（libheif WASM，約 3 MB），第一次使用才下載，並回報下載進度。
 * - SVG：只能用 <img> 點陣化；直接以目標尺寸繪製，保持向量清晰。
 */
import { EngineError } from '../types'
import { loadHeic as loadHeicShared } from '@/lib/heic'

export { onHeicProgress, heicLoaded } from '@/lib/heic'
export type { HeicProgress } from '@/lib/heic'

/** 載入共用的 HEIC 解碼器；失敗時轉成本模組的錯誤型別 */
export const loadHeic = () =>
  loadHeicShared().catch((e) => {
    throw new EngineError('heic-load', String(e))
  })

/** 解碼 HEIC：先試瀏覽器原生（例如 Safari），失敗才用 heic-to */
export async function decodeHeic(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    /* 多數瀏覽器不支援原生 HEIC，改用 WASM */
  }
  const { heicTo } = await loadHeic()
  try {
    return await heicTo({ blob: file, type: 'bitmap' })
  } catch (e) {
    console.error(e)
    throw new EngineError('decode', String(e))
  }
}

/** SVG 點陣化：size 未提供時用原始尺寸（沒有尺寸資訊時用 fallback） */
export async function rasterizeSvg(
  file: Blob,
  size?: { width: number; height: number },
  fallback = 1024,
): Promise<ImageBitmap> {
  const blob = file.type === 'image/svg+xml' ? file : new Blob([file], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const canvas = document.createElement('canvas')
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    try {
      await img.decode()
    } catch (e) {
      console.error(e)
      throw new EngineError('decode', 'svg')
    }
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    let w = size?.width ?? nw
    let h = size?.height ?? nh
    if (!w || !h) {
      // 沒有寬高也沒有 viewBox：以 fallback 為長邊
      const ratio = nw && nh ? nw / nh : 1
      w = ratio >= 1 ? fallback : Math.round(fallback * ratio)
      h = ratio >= 1 ? Math.round(fallback / ratio) : fallback
    }
    canvas.width = Math.max(1, Math.round(w))
    canvas.height = Math.max(1, Math.round(h))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new EngineError('memory')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await createImageBitmap(canvas)
  } finally {
    URL.revokeObjectURL(url)
    canvas.width = 0
    canvas.height = 0
  }
}
