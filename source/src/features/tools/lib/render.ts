/**
 * 編輯管線：原圖＋EditState → canvas。主執行緒（預覽，縮小的代理圖）與 Worker（匯出，原尺寸）
 * 共用同一份程式，所以預覽與成品一致。
 *
 * 順序：幾何（轉正、翻轉、拉直、裁切、縮放）→ 細節（模糊／銳利）→ 顏色 → 遮蔽 → 浮水印
 */
import { applyColor, applyDetail, effectiveParams, isNeutral, mosaic } from './adjust'
import { coverScale, cropRect, frameOf, frameToOutput, fullRect, outputSize } from './geometry'
import type { EditState, Watermark } from './types'

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type MakeCanvas = (w: number, h: number) => AnyCanvas
export type Drawable = ImageBitmap | HTMLCanvasElement | OffscreenCanvas

export class CanvasMemoryError extends Error {
  constructor() {
    super('canvas 無法配置')
    this.name = 'CanvasMemoryError'
  }
}

export function ctx2d(c: AnyCanvas): Ctx2D {
  const ctx = c.getContext('2d') as Ctx2D | null
  if (!ctx) throw new CanvasMemoryError()
  return ctx
}

const release = (c: AnyCanvas) => {
  c.width = 0
  c.height = 0
}

export const SYSTEM_FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif'

export interface RenderInput {
  source: Drawable
  /** 原圖（全尺寸）寬高；代理圖會被畫成這個邏輯大小 */
  srcW: number
  srcH: number
  state: EditState
  /** frame：整張轉正後的畫面（裁切模式用）；final：最終成品 */
  stage: 'frame' | 'final'
  /** 預覽縮放：畫布像素 = 輸出像素 × scale */
  scale?: number
  make: MakeCanvas
  watermarkImage?: Drawable | null
  /** 「按住看原圖」：只做幾何，不做顏色與疊加 */
  geometryOnly?: boolean
}

export const watermarkActive = (w: Watermark) =>
  w.enabled && (w.kind === 'text' ? w.text.trim().length > 0 : !!w.image)

/** 大幅縮小時先逐次減半，避免鋸齒（Firefox 等的單次縮小品質較差） */
function stepDown(
  img: Drawable,
  ratio: number,
  make: MakeCanvas,
): { img: Drawable; temp: AnyCanvas[] } {
  const temp: AnyCanvas[] = []
  let cur = img
  let w = img.width
  let h = img.height
  let r = ratio
  while (r < 0.5 && w > 2 && h > 2) {
    const nw = Math.max(1, Math.round(w / 2))
    const nh = Math.max(1, Math.round(h / 2))
    const c = make(nw, nh)
    const ctx = ctx2d(c)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cur, 0, 0, nw, nh)
    temp.push(c)
    cur = c
    w = nw
    h = nh
    r *= 2
  }
  return { img: cur, temp }
}

export function renderEdit(input: RenderInput): AnyCanvas {
  const { source, srcW, srcH, state, stage, make } = input
  const scale = input.scale ?? 1
  const g = state.geometry
  const frame = frameOf(g, srcW, srcH)
  const crop = stage === 'final' ? cropRect(g, srcW, srcH) : fullRect(frame.w, frame.h)
  const out = stage === 'final' ? outputSize(state, srcW, srcH) : frame
  const W = Math.max(1, Math.round(out.w * scale))
  const H = Math.max(1, Math.round(out.h * scale))
  const sx = W / crop.w
  const sy = H / crop.h
  const rad = (g.angle * Math.PI) / 180
  // 拉直時多放大一點點，避免邊緣抗鋸齒露出透明
  const cover = g.angle
    ? coverScale(frame.w, frame.h, g.angle) * (1 + 2 / Math.min(frame.w, frame.h))
    : 1

  const canvas = make(W, H)
  const ctx = ctx2d(canvas)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const pxRatio = Math.max(sx, sy) * cover * (srcW / source.width)
  const { img, temp } = stepDown(source, pxRatio, make)
  ctx.save()
  ctx.scale(sx, sy)
  ctx.translate(-crop.x, -crop.y)
  ctx.translate(frame.w / 2, frame.h / 2)
  if (rad) ctx.rotate(rad)
  if (cover !== 1) ctx.scale(cover, cover)
  if (g.flipH || g.flipV) ctx.scale(g.flipH ? -1 : 1, g.flipV ? -1 : 1)
  if (g.rot) ctx.rotate((g.rot * Math.PI) / 180)
  ctx.drawImage(img, -srcW / 2, -srcH / 2, srcW, srcH)
  ctx.restore()
  temp.forEach(release)

  if (input.geometryOnly) return canvas

  const params = effectiveParams(state.adjust, state.filter)
  if (!isNeutral(params)) {
    const data = ctx.getImageData(0, 0, W, H)
    applyDetail(data.data, W, H, params)
    applyColor(data.data, W, H, params)
    ctx.putImageData(data, 0, 0)
  }

  if (stage === 'final') {
    if (state.redactions.length) {
      const { map } = frameToOutput(crop, { w: W, h: H })
      const block = Math.max(3, (state.mosaicSize / 1000) * Math.max(W, H))
      for (const r of state.redactions) {
        const m = map(r.rect)
        const x0 = Math.max(0, Math.floor(m.x))
        const y0 = Math.max(0, Math.floor(m.y))
        const x1 = Math.min(W, Math.ceil(m.x + m.w))
        const y1 = Math.min(H, Math.ceil(m.y + m.h))
        if (x1 <= x0 || y1 <= y0) continue
        if (r.mode === 'black') {
          ctx.fillStyle = '#000'
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
        } else {
          const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
          mosaic(d.data, x1 - x0, y1 - y0, block)
          ctx.putImageData(d, x0, y0)
        }
      }
    }
    if (watermarkActive(state.watermark)) {
      drawWatermark(ctx, W, H, state.watermark, input.watermarkImage ?? null)
    }
  }
  return canvas
}

/** 浮水印：九宮格定位或平鋪；文字用系統字型繪製（支援中文） */
export function drawWatermark(
  ctx: Ctx2D,
  W: number,
  H: number,
  wm: Watermark,
  image: Drawable | null,
) {
  const short = Math.min(W, H)
  let cw: number
  let ch: number
  let fontSize = 0
  if (wm.kind === 'text') {
    fontSize = Math.max(6, (wm.textSize / 100) * short)
    ctx.font = `${wm.bold ? 700 : 500} ${fontSize}px ${SYSTEM_FONT}`
    cw = ctx.measureText(wm.text).width
    ch = fontSize * 1.2
  } else {
    if (!image) return
    cw = Math.max(4, (wm.imageSize / 100) * W)
    ch = (cw * image.height) / image.width
  }
  const rad = (wm.rotation * Math.PI) / 180
  const drawOne = (cx: number, cy: number) => {
    ctx.save()
    ctx.translate(cx, cy)
    if (rad) ctx.rotate(rad)
    if (wm.kind === 'text') {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `${wm.bold ? 700 : 500} ${fontSize}px ${SYSTEM_FONT}`
      if (wm.shadow) {
        const dark = isDarkHex(wm.color)
        ctx.shadowColor = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)'
        ctx.shadowBlur = fontSize * 0.14
        ctx.shadowOffsetY = fontSize * 0.04
      }
      ctx.fillStyle = wm.color
      ctx.fillText(wm.text, 0, 0)
    } else if (image) {
      ctx.drawImage(image, -cw / 2, -ch / 2, cw, ch)
    }
    ctx.restore()
  }
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, wm.opacity / 100))
  if (wm.tile) {
    const gap = (wm.tileGap / 100) * short
    const stepX = cw + gap
    const stepY = ch + gap
    const reach = Math.hypot(W, H)
    const nx = Math.ceil(reach / stepX) + 1
    const ny = Math.ceil(reach / stepY) + 1
    ctx.translate(W / 2, H / 2)
    ctx.rotate(rad)
    for (let j = -ny; j <= ny; j++) {
      const offset = j % 2 ? stepX / 2 : 0
      for (let i = -nx; i <= nx; i++) {
        ctx.save()
        // 平鋪時整片一起旋轉，單個不再旋轉
        ctx.translate(i * stepX + offset, j * stepY)
        if (rad) ctx.rotate(-rad)
        drawOne(0, 0)
        ctx.restore()
      }
    }
  } else {
    const margin = (wm.margin / 100) * short
    const bw = Math.abs(cw * Math.cos(rad)) + Math.abs(ch * Math.sin(rad))
    const bh = Math.abs(cw * Math.sin(rad)) + Math.abs(ch * Math.cos(rad))
    const col = wm.position % 3
    const row = Math.floor(wm.position / 3)
    const cx = col === 0 ? margin + bw / 2 : col === 1 ? W / 2 : W - margin - bw / 2
    const cy = row === 0 ? margin + bh / 2 : row === 1 ? H / 2 : H - margin - bh / 2
    drawOne(cx, cy)
  }
  ctx.restore()
}

function isDarkHex(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110
}
