/**
 * 簡易標註的資料模型與匯出（純函式，可在 Node 測試）。
 * 所有座標都在「視覺座標」（pt，左上為原點，使用者看到的頁面方向），匯出時再轉成 PDF 座標，
 * 所以旋轉過的頁面也會畫在正確的位置。
 * - 畫筆、螢光筆：向量路徑（drawSvgPath），螢光筆用色彩增值（Multiply）混合，不會蓋掉文字
 * - 文字框、簽名：圖片（文字以 Canvas 繪製，支援中文）
 */
import type { EncodedImage } from './ops'
import { loadForEdit, pageGeometry } from './ops'
import { placementToDraw, visualToPdf, type Size } from './placement'

export interface StrokeAnn {
  id: string
  kind: 'pen' | 'highlight'
  page: number
  points: Array<[number, number]>
  color: string
  /** 線寬（pt） */
  width: number
  opacity: number
}

export interface TextAnn {
  id: string
  kind: 'text'
  page: number
  /** 左上角 */
  x: number
  y: number
  text: string
  sizePt: number
  color: string
}

export interface ImageAnn {
  id: string
  kind: 'sign'
  page: number
  x: number
  y: number
  w: number
  h: number
  image: EncodedImage
  url: string
}

export type Ann = StrokeAnn | TextAnn | ImageAnn

export const isStroke = (a: Ann): a is StrokeAnn => a.kind === 'pen' || a.kind === 'highlight'

export const TEXT_LINE_HEIGHT = 1.25

/** 文字框在頁面上的大小（粗估：給選取框與拖曳用；匯出時以實際繪製結果為準） */
export function textBox(a: TextAnn, measure?: (line: string, sizePt: number) => number): Size {
  const lines = a.text.split('\n')
  const w = Math.max(
    a.sizePt,
    ...lines.map((l) => (measure ? measure(l, a.sizePt) : l.length * a.sizePt * 0.6)),
  )
  return { w, h: lines.length * a.sizePt * TEXT_LINE_HEIGHT }
}

/** 把點列轉成平滑的 SVG 路徑（二次貝茲曲線經過中點） */
export function strokePath(points: Array<[number, number]>): string {
  if (!points.length) return ''
  if (points.length === 1) {
    const [x, y] = points[0]
    return `M${x} ${y}L${x + 0.01} ${y}`
  }
  let d = `M${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    d += `Q${x0} ${y0} ${(x0 + x1) / 2} ${(y0 + y1) / 2}`
  }
  const last = points[points.length - 1]
  return `${d}L${last[0]} ${last[1]}`
}

const hexRgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16) || 0
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const
}

/** 平移一個標註 */
export function moveAnn(a: Ann, dx: number, dy: number): Ann {
  if (isStroke(a))
    return { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) }
  return { ...a, x: a.x + dx, y: a.y + dy }
}

/** 標註的外接框（視覺座標） */
export function annBounds(a: Ann, measure?: (line: string, sizePt: number) => number) {
  if (isStroke(a)) {
    const xs = a.points.map((p) => p[0])
    const ys = a.points.map((p) => p[1])
    const pad = a.width / 2
    return {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      w: Math.max(...xs) - Math.min(...xs) + pad * 2,
      h: Math.max(...ys) - Math.min(...ys) + pad * 2,
    }
  }
  if (a.kind === 'text') return { x: a.x, y: a.y, ...textBox(a, measure) }
  return { x: a.x, y: a.y, w: a.w, h: a.h }
}

/** 匯出：把標註畫進 PDF（就地修改原檔，其他內容不變） */
export async function applyAnnotations(
  bytes: Uint8Array,
  anns: Ann[],
  renderText: (a: TextAnn) => Promise<{ image: EncodedImage; size: Size } | null>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const { rgb, degrees, BlendMode, LineCapStyle } = await import('pdf-lib')
  const doc = await loadForEdit(bytes)
  const pages = doc.getPages()
  const images = new Map<Uint8Array, Awaited<ReturnType<typeof doc.embedPng>>>()
  for (const a of anns) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const page = pages[a.page]
    if (!page) continue
    const geo = pageGeometry(page)
    if (isStroke(a)) {
      if (!a.points.length) continue
      // drawSvgPath 以 (x, y) 為原點並把 y 軸翻轉；直接給「PDF 座標的 y 取負值」即可
      const pdfPts = a.points.map(([x, y]) => {
        const p = visualToPdf(geo, x, y)
        return [p.x, -p.y] as [number, number]
      })
      const [r, g, b] = hexRgb(a.color)
      page.drawSvgPath(strokePath(pdfPts), {
        x: 0,
        y: 0,
        borderColor: rgb(r, g, b),
        borderWidth: a.width,
        borderOpacity: a.opacity,
        borderLineCap: LineCapStyle.Round,
        blendMode: a.kind === 'highlight' ? BlendMode.Multiply : BlendMode.Normal,
      })
      continue
    }
    let image: EncodedImage
    let size: Size
    if (a.kind === 'text') {
      const r = await renderText(a)
      if (!r) continue
      image = r.image
      size = r.size
    } else {
      image = a.image
      size = { w: a.w, h: a.h }
    }
    let emb = images.get(image.bytes)
    if (!emb) {
      emb = image.type === 'png' ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes)
      images.set(image.bytes, emb)
    }
    const d = placementToDraw(geo, { cx: a.x + size.w / 2, cy: a.y + size.h / 2, angle: 0 }, size)
    page.drawImage(emb, {
      x: d.x,
      y: d.y,
      width: d.width,
      height: d.height,
      rotate: degrees(d.rotate),
    })
  }
  return doc.save({ useObjectStreams: true })
}
