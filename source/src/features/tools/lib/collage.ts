/** 拼貼版面計算（純函式） */
import type { Rect } from './types'

export type CollageLayout = 'row' | 'column' | 'grid' | 'featured'

export interface CollagePlan {
  width: number
  height: number
  cells: Rect[]
  /** 這格是否需要裁切填滿（row／column 依原比例排列，不裁切） */
  cover: boolean
}

export function planCollage(
  layout: CollageLayout,
  aspects: number[],
  width: number,
  gap: number,
): CollagePlan {
  const n = aspects.length
  const W = Math.max(64, Math.round(width))
  const g = Math.max(0, gap)
  if (!n) return { width: W, height: W, cells: [], cover: true }
  if (layout === 'row') {
    const sum = aspects.reduce((a, b) => a + b, 0)
    const h = (W - g * (n + 1)) / sum
    let x = g
    const cells = aspects.map((a) => {
      const r = { x, y: g, w: h * a, h }
      x += h * a + g
      return r
    })
    return { width: W, height: Math.round(h + 2 * g), cells, cover: false }
  }
  if (layout === 'column') {
    const w = W - 2 * g
    let y = g
    const cells = aspects.map((a) => {
      const r = { x: g, y, w, h: w / a }
      y += w / a + g
      return r
    })
    return { width: W, height: Math.round(y), cells, cover: false }
  }
  if (layout === 'featured' && n >= 2) {
    const H = Math.round(W * 0.66)
    const lw = (W - 3 * g) * 0.62
    const rw = W - 3 * g - lw
    const rest = n - 1
    const rh = (H - g * (rest + 1)) / rest
    const cells: Rect[] = [{ x: g, y: g, w: lw, h: H - 2 * g }]
    for (let i = 0; i < rest; i++) cells.push({ x: 2 * g + lw, y: g + i * (rh + g), w: rw, h: rh })
    return { width: W, height: H, cells, cover: true }
  }
  // 格狀：正方形格子，最後一列置中
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const cw = (W - g * (cols + 1)) / cols
  const cells: Rect[] = []
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols)
    const inRow = row === rows - 1 ? n - row * cols : cols
    const offset = ((cols - inRow) * (cw + g)) / 2
    const col = i % cols
    cells.push({ x: g + offset + col * (cw + g), y: g + row * (cw + g), w: cw, h: cw })
  }
  return { width: W, height: Math.round(rows * cw + (rows + 1) * g), cells, cover: true }
}

/** 填滿（cover）時要從來源裁出的範圍 */
export function coverSource(sw: number, sh: number, cell: { w: number; h: number }): Rect {
  const target = cell.w / cell.h
  const src = sw / sh
  if (src > target) {
    const w = sh * target
    return { x: (sw - w) / 2, y: 0, w, h: sh }
  }
  const h = sw / target
  return { x: 0, y: (sh - h) / 2, w: sw, h }
}
