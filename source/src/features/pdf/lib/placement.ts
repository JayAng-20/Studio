/**
 * 浮水印與頁碼的擺放幾何（純函式）。
 * 一律先在「視覺座標」計算（使用者看到的頁面方向，左上為原點、y 向下、角度逆時針為正），
 * 再轉換成 PDF 使用者空間（左下為原點、y 向上），並考慮頁面的 /Rotate 與裁切框原點。
 * 預覽（CSS）與匯出（pdf-lib）共用同一套計算，確保所見即所得。
 */

export type Anchor = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'
export const ANCHORS: Anchor[] = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']

export interface Size {
  w: number
  h: number
}

/** 視覺座標中的一個擺放：中心點與逆時針角度（度） */
export interface Placement {
  cx: number
  cy: number
  angle: number
}

const rad = (d: number) => (d * Math.PI) / 180

/** 旋轉後的外接框 */
export function rotatedBounds(box: Size, angle: number): Size {
  const c = Math.abs(Math.cos(rad(angle)))
  const s = Math.abs(Math.sin(rad(angle)))
  return { w: box.w * c + box.h * s, h: box.w * s + box.h * c }
}

/** 九宮格位置：外接框整個落在頁面內（扣除邊距） */
export function anchorPlacement(
  page: Size,
  box: Size,
  anchor: Anchor,
  margin: number,
  angle = 0,
): Placement {
  const b = rotatedBounds(box, angle)
  const col = anchor[1] === 'l' ? 0 : anchor[1] === 'c' ? 1 : 2
  const row = anchor[0] === 't' ? 0 : anchor[0] === 'm' ? 1 : 2
  const xs = [margin + b.w / 2, page.w / 2, page.w - margin - b.w / 2]
  const ys = [margin + b.h / 2, page.h / 2, page.h - margin - b.h / 2]
  return { cx: xs[col], cy: ys[row], angle }
}

/** 平鋪：以頁面中心對稱排列，奇數列錯開半格（磚牆排列），完整覆蓋頁面 */
export function tilePlacements(page: Size, box: Size, angle: number, gap: number): Placement[] {
  const b = rotatedBounds(box, angle)
  const stepX = Math.max(1, b.w + gap)
  const stepY = Math.max(1, b.h + gap)
  const out: Placement[] = []
  const rows = Math.ceil(page.h / 2 / stepY) + 1
  const cols = Math.ceil(page.w / 2 / stepX) + 1
  for (let r = -rows; r <= rows; r++) {
    const shift = Math.abs(r) % 2 === 1 ? stepX / 2 : 0
    for (let c = -cols - 1; c <= cols; c++) {
      const cx = page.w / 2 + c * stepX + shift
      const cy = page.h / 2 + r * stepY
      // 只保留與頁面有交集的
      if (cx + b.w / 2 < 0 || cx - b.w / 2 > page.w) continue
      if (cy + b.h / 2 < 0 || cy - b.h / 2 > page.h) continue
      out.push({ cx, cy, angle })
      if (out.length >= 600) return out
    }
  }
  return out
}

/** PDF 頁面的幾何資訊（未旋轉的裁切框） */
export interface PageGeometry {
  /** 裁切框原點與尺寸（PDF 單位，未旋轉） */
  x: number
  y: number
  width: number
  height: number
  /** /Rotate（0、90、180、270） */
  rotation: number
}

export const normRotation = (r: number) => (((Math.round(r / 90) * 90) % 360) + 360) % 360

/** 頁面的視覺尺寸（套用 /Rotate 之後） */
export function visualSize(g: PageGeometry): Size {
  const r = normRotation(g.rotation)
  return r === 90 || r === 270 ? { w: g.height, h: g.width } : { w: g.width, h: g.height }
}

/** 視覺座標的點 → PDF 使用者空間 */
export function visualToPdf(g: PageGeometry, vx: number, vy: number): { x: number; y: number } {
  const r = normRotation(g.rotation)
  const W = g.width
  const H = g.height
  let x: number
  let y: number
  switch (r) {
    case 90:
      x = vy
      y = vx
      break
    case 180:
      x = W - vx
      y = vy
      break
    case 270:
      x = W - vy
      y = H - vx
      break
    default:
      x = vx
      y = H - vy
  }
  return { x: x + g.x, y: y + g.y }
}

/** pdf-lib drawImage 的參數：左下角位置、尺寸、繞左下角逆時針旋轉角 */
export interface DrawParams {
  x: number
  y: number
  width: number
  height: number
  rotate: number
}

/** 視覺擺放 → pdf-lib drawImage 參數（讓圖章在使用者看到的方向上保持正確角度） */
export function placementToDraw(g: PageGeometry, p: Placement, box: Size): DrawParams {
  const center = visualToPdf(g, p.cx, p.cy)
  // 頁面顯示時順時針旋轉 r，所以要在 PDF 空間多轉 r（逆時針）才能在畫面上呈現 angle
  const phi = p.angle + normRotation(g.rotation)
  const c = Math.cos(rad(phi))
  const s = Math.sin(rad(phi))
  const hw = box.w / 2
  const hh = box.h / 2
  return {
    x: center.x - (hw * c - hh * s),
    y: center.y - (hw * s + hh * c),
    width: box.w,
    height: box.h,
    rotate: ((phi % 360) + 360) % 360,
  }
}

/** PDF 使用者空間的點 → 視覺座標（visualToPdf 的反函數） */
export function pdfToVisual(g: PageGeometry, px: number, py: number): { x: number; y: number } {
  const r = normRotation(g.rotation)
  const x = px - g.x
  const y = py - g.y
  switch (r) {
    case 90:
      return { x: y, y: x }
    case 180:
      return { x: g.width - x, y }
    case 270:
      return { x: g.height - y, y: g.width - x }
    default:
      return { x, y: g.height - y }
  }
}

/** PDF 矩形 → 視覺座標的外接矩形 */
export function rectToVisual(
  g: PageGeometry,
  r: { x: number; y: number; width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  const a = pdfToVisual(g, r.x, r.y)
  const b = pdfToVisual(g, r.x + r.width, r.y + r.height)
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}
