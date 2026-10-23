/** EditState 的判斷與轉換（純函式） */
import { effectiveParams, isNeutral } from './adjust'
import { centeredCrop, cropRect, frameOf, isFullRect, outputSize, stateRatio } from './geometry'
import { watermarkActive } from './render'
import type { Container, EditState, EncodeMime, OutputFormat } from './types'

/** 畫面像素有沒有被改變（決定能不能直接沿用原檔、不重新壓縮） */
export function pixelsChanged(s: EditState, srcW: number, srcH: number): boolean {
  const g = s.geometry
  const f = frameOf(g, srcW, srcH)
  if (g.rot || g.flipH || g.flipV || g.angle) return true
  if (g.crop && !isFullRect(g.crop, f.w, f.h)) return true
  const c = cropRect(g, srcW, srcH)
  const o = outputSize(s, srcW, srcH)
  if (o.w !== Math.round(c.w) || o.h !== Math.round(c.h)) return true
  if (!isNeutral(effectiveParams(s.adjust, s.filter))) return true
  if (watermarkActive(s.watermark)) return true
  return s.redactions.length > 0
}

/** 原檔格式的 MIME */
export function containerMime(c: Container): string | null {
  switch (c) {
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'avif':
      return 'image/avif'
    case 'gif':
      return 'image/gif'
    case 'bmp':
      return 'image/bmp'
    default:
      return null
  }
}

/** 能就地（無損）修改中繼資料的容器 */
export const metaEditable = (c: Container) => c === 'jpeg' || c === 'png' || c === 'webp'

/** 實際要輸出的編碼格式 */
export function effectiveMime(
  format: OutputFormat,
  container: Container,
  supported: ReadonlySet<string>,
): EncodeMime {
  if (format !== 'original') return supported.has(format) ? format : 'image/jpeg'
  switch (container) {
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
    case 'gif':
    case 'bmp':
    case 'svg':
    case 'other':
      return 'image/png'
    case 'webp':
      return supported.has('image/webp') ? 'image/webp' : 'image/png'
    case 'avif':
      return supported.has('image/avif') ? 'image/avif' : 'image/jpeg'
    default:
      return 'image/jpeg'
  }
}

export const extOfMime = (m: string) =>
  m === 'image/jpeg' ? 'jpg' : m === 'image/png' ? 'png' : m === 'image/webp' ? 'webp' : 'avif'

export const isLossy = (m: string) => m !== 'image/png'

/**
 * 會不會直接沿用原檔（只做無損的中繼資料處理）：
 * 畫面沒改、沒選壓縮、格式沿用原檔；而且要嘛保留中繼資料，要嘛容器支援無損移除。
 */
export function isPassthrough(
  s: EditState,
  srcW: number,
  srcH: number,
  container: Container,
): boolean {
  if (pixelsChanged(s, srcW, srcH)) return false
  if (s.output.mode !== 'none' || s.output.format !== 'original') return false
  if (s.meta === 'keep') return container !== 'heic' && container !== 'svg' && container !== 'other'
  return metaEditable(container)
}

/**
 * 批次「套用到全部」：把來源的縮放設定套到目標。
 * 固定比例時以目標圖片的中心做最大裁切，像素尺寸鎖定比例時等比例縮到框內。
 */
export function applyResizeTo(
  src: EditState,
  target: EditState,
  srcW: number,
  srcH: number,
  tW: number,
  tH: number,
): EditState {
  const sf = frameOf(src.geometry, srcW, srcH)
  const ratio =
    src.aspect === 'free' || src.aspect === 'original' ? null : stateRatio(src, sf.w, sf.h)
  const tf = frameOf(target.geometry, tW, tH)
  return {
    ...target,
    aspect: src.aspect,
    aspectFlip: src.aspectFlip,
    customAspect: src.customAspect,
    geometry: ratio
      ? { ...target.geometry, crop: centeredCrop(ratio, tf.w, tf.h) }
      : target.geometry,
    resize: src.resize,
  }
}

const blobIds = new WeakMap<Blob, number>()
let blobSeq = 0
const blobId = (b: Blob) => {
  let id = blobIds.get(b)
  if (!id) {
    id = ++blobSeq
    blobIds.set(b, id)
  }
  return id
}

/** 簡單穩定的狀態簽章（快取估算結果、判斷是否已匯出） */
export function stateKey(s: EditState): string {
  return JSON.stringify(s, (_k, v: unknown) =>
    v instanceof Blob ? `blob#${blobId(v)}` : typeof v === 'number' ? Math.round(v * 100) / 100 : v,
  )
}
