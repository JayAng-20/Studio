/** 縮放尺寸計算（純函式） */

export type ResizeMode = 'none' | 'width' | 'height' | 'long' | 'percent'

export interface ResizeSpec {
  mode: ResizeMode
  width: number
  height: number
  long: number
  percent: number
  /** 允許放大比目標小的圖片 */
  upscale: boolean
}

export interface Size {
  width: number
  height: number
}

export const DEFAULT_RESIZE: ResizeSpec = {
  mode: 'none',
  width: 1920,
  height: 1080,
  long: 2048,
  percent: 50,
  upscale: false,
}

/** 縮放倍率（保持長寬比）；不允許放大時上限為 1 */
export function resizeScale(src: Size, spec: ResizeSpec): number {
  const { width: w, height: h } = src
  if (w <= 0 || h <= 0) return 1
  let s: number
  switch (spec.mode) {
    case 'width':
      s = spec.width > 0 ? spec.width / w : 1
      break
    case 'height':
      s = spec.height > 0 ? spec.height / h : 1
      break
    case 'long':
      s = spec.long > 0 ? spec.long / Math.max(w, h) : 1
      break
    case 'percent':
      s = spec.percent > 0 ? spec.percent / 100 : 1
      break
    default:
      s = 1
  }
  if (!spec.upscale) s = Math.min(1, s)
  return s
}

/** 輸出尺寸：四捨五入、最小 1 px；指定的那一邊會精確等於設定值 */
export function computeOutputSize(src: Size, spec: ResizeSpec): Size & { scaled: boolean } {
  const s = resizeScale(src, spec)
  if (s === 1) return { width: src.width, height: src.height, scaled: false }
  let width = Math.max(1, Math.round(src.width * s))
  let height = Math.max(1, Math.round(src.height * s))
  // 避免浮點誤差讓「依寬 1920」變成 1919
  if (spec.mode === 'width' && s === spec.width / src.width) width = Math.round(spec.width)
  if (spec.mode === 'height' && s === spec.height / src.height) height = Math.round(spec.height)
  if (spec.mode === 'long' && s === spec.long / Math.max(src.width, src.height)) {
    if (src.width >= src.height) width = Math.round(spec.long)
    else height = Math.round(spec.long)
  }
  return { width, height, scaled: width !== src.width || height !== src.height }
}

/** 限制總像素（大圖保護）：超過時等比縮小到 maxPixels 以內 */
export function fitPixels(size: Size, maxPixels: number): Size & { limited: boolean } {
  const px = size.width * size.height
  if (px <= maxPixels || maxPixels <= 0) return { ...size, limited: false }
  const s = Math.sqrt(maxPixels / px)
  let width = Math.max(1, Math.floor(size.width * s))
  let height = Math.max(1, Math.floor(size.height * s))
  // 浮點誤差保險
  while (width * height > maxPixels) {
    if (width >= height) width--
    else height--
  }
  return { width, height, limited: true }
}

/** 限制最長邊（Canvas 單邊上限） */
export function fitDimension(size: Size, maxSide: number): Size & { limited: boolean } {
  const long = Math.max(size.width, size.height)
  if (long <= maxSide) return { ...size, limited: false }
  const s = maxSide / long
  return {
    width: Math.max(1, Math.floor(size.width * s)),
    height: Math.max(1, Math.floor(size.height * s)),
    limited: true,
  }
}

/**
 * 高品質縮小的分段計畫：每次最多縮小一半，最後一步到目標尺寸。
 * 回傳每一步的尺寸（不含原尺寸）；放大或不變時只有一步。
 */
export function stepDownPlan(src: Size, dst: Size): Size[] {
  const steps: Size[] = []
  let w = src.width
  let h = src.height
  while (w / 2 >= dst.width && h / 2 >= dst.height && w > dst.width * 2 && h > dst.height * 2) {
    w = Math.max(dst.width, Math.round(w / 2))
    h = Math.max(dst.height, Math.round(h / 2))
    steps.push({ width: w, height: h })
  }
  if (
    !steps.length ||
    steps[steps.length - 1].width !== dst.width ||
    steps[steps.length - 1].height !== dst.height
  )
    steps.push({ ...dst })
  return steps
}
