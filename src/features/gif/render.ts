/** 影格繪製：裁切、縮放、擺放、文字疊加、色鍵去背（預覽與編碼共用，確保所見即所得） */
import type { CropRect, FitMode, TextLayer } from './settings'
import { WIDTH_MAX, WIDTH_MIN } from './settings'
import { applyChromaKey, hexToRgb } from './dither'

/** 中文用系統字型 */
export const TEXT_FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif'

export interface Geometry {
  /** 基準畫面（影片尺寸，或圖片模式第一張圖的尺寸） */
  baseW: number
  baseH: number
  crop: CropRect
  outW: number
  outH: number
  fit: FitMode
  /** 圖片模式的底色；影片模式為 null */
  background: string | null
}

/** 依裁切與寬度設定算出輸出尺寸 */
export function outputSize(
  baseW: number,
  baseH: number,
  crop: CropRect,
  width: number | 'original',
): { w: number; h: number } {
  const cw = Math.max(1, baseW * crop.w)
  const ch = Math.max(1, baseH * crop.h)
  const w = Math.round(
    Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, width === 'original' ? cw : width)),
  )
  const h = Math.max(1, Math.round((w * ch) / cw))
  return { w, h }
}

/** 把來源畫到輸出畫布（含裁切、擺放） */
export function drawSource(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  g: Geometry,
) {
  const cx = g.crop.x * g.baseW
  const cy = g.crop.y * g.baseH
  const cw = Math.max(1e-3, g.crop.w * g.baseW)
  const ch = Math.max(1e-3, g.crop.h * g.baseH)
  const sx = g.outW / cw
  const sy = g.outH / ch
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, g.outW, g.outH)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.setTransform(sx, 0, 0, sy, -cx * sx, -cy * sy)
  if (g.background) {
    ctx.fillStyle = g.background
    ctx.fillRect(0, 0, g.baseW, g.baseH)
  }
  const k =
    g.fit === 'cover'
      ? Math.max(g.baseW / srcW, g.baseH / srcH)
      : Math.min(g.baseW / srcW, g.baseH / srcH)
  const fw = srcW * k
  const fh = srcH * k
  ctx.drawImage(src, (g.baseW - fw) / 2, (g.baseH - fh) / 2, fw, fh)
  ctx.restore()
}

export function fontFor(layer: TextLayer, outH: number) {
  const px = Math.max(6, Math.round(layer.size * outH))
  return { px, font: `${layer.bold ? 700 : 500} ${px}px ${TEXT_FONT}` }
}

/** 文字是否在這個輸出時間顯示 */
export function textVisible(layer: TextLayer, outT: number) {
  return layer.text.trim() !== '' && outT >= layer.start - 1e-6 && (layer.end === null || outT < layer.end - 1e-6)
}

/** 量測文字框（輸出像素） */
export function measureText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layer: TextLayer,
  outW: number,
  outH: number,
): { x: number; y: number; w: number; h: number } {
  const { px, font } = fontFor(layer, outH)
  ctx.save()
  ctx.font = font
  const lines = layer.text.split('\n')
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), px * 0.5)
  ctx.restore()
  const lh = px * 1.2
  const h = lh * lines.length
  const pad = px * layer.stroke
  return {
    x: layer.x * outW - w / 2 - pad,
    y: layer.y * outH - h / 2 - pad,
    w: w + pad * 2,
    h: h + pad * 2,
  }
}

/** 畫文字疊加（描邊在下、填色在上） */
export function drawTexts(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layers: readonly TextLayer[],
  outT: number,
  outW: number,
  outH: number,
) {
  for (const layer of layers) {
    if (!textVisible(layer, outT)) continue
    const { px, font } = fontFor(layer, outH)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    const lines = layer.text.split('\n')
    const lh = px * 1.2
    const cx = layer.x * outW
    const top = layer.y * outH - (lh * (lines.length - 1)) / 2
    lines.forEach((line, i) => {
      const y = top + i * lh
      if (layer.stroke > 0) {
        ctx.strokeStyle = layer.strokeColor
        ctx.lineWidth = px * layer.stroke * 2
        ctx.strokeText(line, cx, y)
      }
      ctx.fillStyle = layer.color
      ctx.fillText(line, cx, y)
    })
    ctx.restore()
  }
}

/** 對畫布內容做色鍵去背（直接修改 ImageData） */
export function chromaKeyImage(img: ImageData, color: string, tolerance: number) {
  applyChromaKey(img.data, hexToRgb(color), tolerance)
}
