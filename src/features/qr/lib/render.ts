/**
 * 點陣輸出：用與 SVG 相同的幾何路徑（Path2D）畫到 canvas，再編碼成 PNG／JPG。
 */
import { canvasToBlob, createCanvas, releaseCanvas } from '@/lib/image'
import { gradientCoords, roundedRect, type Geometry } from './geometry'
import { buildSvgTree, serializeSvg } from './svg'
import type { QrStyle } from './style'

/** 載入 Logo（data URL）成可繪製的影像 */
export async function loadLogoImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  await img.decode()
  return img
}

/** 依樣式建立填色（顏色字串或漸層） */
function fillStyle(
  ctx: CanvasRenderingContext2D,
  geo: Geometry,
  style: QrStyle,
): string | CanvasGradient {
  const fg = style.fg
  if (fg.type === 'solid') return fg.color
  const g = gradientCoords(geo, fg.angle)
  const grad =
    fg.type === 'linear'
      ? ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2)
      : ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.r)
  grad.addColorStop(0, fg.color)
  grad.addColorStop(1, fg.color2)
  return grad
}

/** 畫到 canvas；呼叫端用完要 releaseCanvas */
export function drawToCanvas(
  geo: Geometry,
  style: QrStyle,
  size: number,
  opts: { opaque?: boolean; logo?: CanvasImageSource | null } = {},
): HTMLCanvasElement {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('無法建立 canvas')
  const k = size / geo.total
  ctx.scale(k, k)
  if (!style.bgTransparent || opts.opaque) {
    ctx.fillStyle = style.bgTransparent ? '#FFFFFF' : style.bg
    ctx.fillRect(0, 0, geo.total, geo.total)
  }
  const fill = fillStyle(ctx, geo, style)
  ctx.fillStyle = fill
  if (geo.modules) ctx.fill(new Path2D(geo.modules))
  ctx.fillStyle = style.eyeCustom ? style.eyeColor : fill
  ctx.fill(new Path2D(geo.eyeFrames), 'evenodd')
  ctx.fill(new Path2D(geo.eyeBalls))
  if (geo.logo && opts.logo) {
    const p = geo.logo.plate
    if (p) {
      ctx.fillStyle = style.bgTransparent ? '#FFFFFF' : style.bg
      ctx.fill(new Path2D(roundedRect(p.x, p.y, p.w, p.h, [p.r, p.r, p.r, p.r])))
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(opts.logo, geo.logo.x, geo.logo.y, geo.logo.w, geo.logo.h)
  }
  return canvas
}

export type ExportFormat = 'png' | 'jpg' | 'svg'

export function svgBlob(geo: Geometry, style: QrStyle): Blob {
  const text = serializeSvg(buildSvgTree(geo, style, { idPrefix: 'qr' }))
  return new Blob([text], { type: 'image/svg+xml' })
}

/** 輸出成指定格式的 Blob */
export async function exportBlob(
  geo: Geometry,
  style: QrStyle,
  format: ExportFormat,
  opts: { quality?: number; logo?: CanvasImageSource | null; size?: number } = {},
): Promise<Blob> {
  if (format === 'svg') return svgBlob(geo, style)
  const canvas = drawToCanvas(geo, style, opts.size ?? style.size, {
    opaque: format === 'jpg',
    logo: opts.logo,
  })
  try {
    return await canvasToBlob(
      canvas,
      format === 'jpg' ? 'image/jpeg' : 'image/png',
      format === 'jpg' ? (opts.quality ?? 92) / 100 : undefined,
    )
  } finally {
    releaseCanvas(canvas)
  }
}

/** 使用者上傳的 Logo：縮到 512 px 內並轉成 PNG data URL（SVG 保留原樣） */
export async function prepareLogo(
  file: File,
): Promise<{ src: string; width: number; height: number }> {
  const MAX = 512
  if (file.type === 'image/svg+xml') {
    const text = await file.text()
    // SVG 以 <image> 載入時不會執行其中的指令碼
    let bin = ''
    for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
    const src = `data:image/svg+xml;base64,${btoa(bin)}`
    const img = await loadLogoImage(src)
    return { src, width: img.naturalWidth || 1, height: img.naturalHeight || 1 }
  }
  const { decodeImage } = await import('@/lib/image')
  const bmp = await decodeImage(file)
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const c = createCanvas(w, h)
  try {
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('無法建立 canvas')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, w, h)
    return { src: c.toDataURL('image/png'), width: w, height: h }
  } finally {
    bmp.close()
    releaseCanvas(c)
  }
}
