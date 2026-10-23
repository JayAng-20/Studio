/**
 * 長圖拼接的純幾何（可在 Node 測試）：
 * 內容座標＝輸出像素（縮放 1），左上原點；畫布＝所有圖片的外接框＋外距。
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Placed extends Box {
  id: string
}

export interface Guide {
  /** 'v'：垂直線（x 固定）；'h'：水平線（y 固定） */
  axis: 'v' | 'h'
  pos: number
  from: number
  to: number
}

export const bounds = (items: Box[]): Box => {
  if (!items.length) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.min(...items.map((i) => i.x))
  const y = Math.min(...items.map((i) => i.y))
  const r = Math.max(...items.map((i) => i.x + i.w))
  const b = Math.max(...items.map((i) => i.y + i.h))
  return { x, y, w: r - x, h: b - y }
}

/** 讓外接框左上角回到 (0, 0) */
export function normalize<T extends Box>(items: T[]): T[] {
  if (!items.length) return items
  const b = bounds(items)
  if (Math.abs(b.x) < 0.01 && Math.abs(b.y) < 0.01) return items
  return items.map((i) => ({ ...i, x: i.x - b.x, y: i.y - b.y }))
}

export type Align = 'start' | 'center' | 'end'

/** 依序直向（或橫向）堆疊，對齊方式與間距可調；不改變尺寸 */
export function arrange<T extends Box>(items: T[], dir: 'vertical' | 'horizontal', gap: number, align: Align): T[] {
  if (!items.length) return items
  const cross = dir === 'vertical' ? Math.max(...items.map((i) => i.w)) : Math.max(...items.map((i) => i.h))
  let cur = 0
  return items.map((i) => {
    const size = dir === 'vertical' ? i.w : i.h
    const off = align === 'start' ? 0 : align === 'center' ? (cross - size) / 2 : cross - size
    const next =
      dir === 'vertical' ? { ...i, x: off, y: cur } : { ...i, x: cur, y: off }
    cur += (dir === 'vertical' ? i.h : i.w) + gap
    return next
  })
}

/** 統一寬度（直式）或高度（橫式），等比縮放 */
export function matchSize<T extends Box>(items: T[], dir: 'vertical' | 'horizontal', target: number): T[] {
  return items.map((i) =>
    dir === 'vertical'
      ? { ...i, w: target, h: (i.h * target) / i.w }
      : { ...i, h: target, w: (i.w * target) / i.h },
  )
}

/**
 * 拖曳時的吸附：把移動中的框對齊其他框的邊、中線，或「貼齊＋間距」；
 * 回傳修正後的位置與要顯示的參考線。threshold 為內容座標的距離。
 */
export function snapMove(
  moving: Box,
  others: Box[],
  threshold: number,
  gap: number,
): { x: number; y: number; guides: Guide[] } {
  const xsMe = [
    { v: moving.x, k: 0 },
    { v: moving.x + moving.w / 2, k: 0.5 },
    { v: moving.x + moving.w, k: 1 },
  ]
  const ysMe = [
    { v: moving.y, k: 0 },
    { v: moving.y + moving.h / 2, k: 0.5 },
    { v: moving.y + moving.h, k: 1 },
  ]
  const xs: number[] = []
  const ys: number[] = []
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w, o.x + o.w + gap, o.x - gap)
    ys.push(o.y, o.y + o.h / 2, o.y + o.h, o.y + o.h + gap, o.y - gap)
  }
  if (others.length) {
    const b = bounds(others)
    xs.push(b.x, b.x + b.w / 2, b.x + b.w)
    ys.push(b.y, b.y + b.h / 2, b.y + b.h)
  }
  const best = (mine: typeof xsMe, cands: number[]) => {
    let d = threshold + 1
    let delta = 0
    let line = NaN
    for (const m of mine)
      for (const c of cands) {
        const dd = Math.abs(c - m.v)
        if (dd < d) {
          d = dd
          delta = c - m.v
          line = c
        }
      }
    return d <= threshold ? { delta, line } : null
  }
  const bx = best(xsMe, xs)
  const by = best(ysMe, ys)
  const x = moving.x + (bx?.delta ?? 0)
  const y = moving.y + (by?.delta ?? 0)
  const guides: Guide[] = []
  const all = [...others, { x, y, w: moving.w, h: moving.h }]
  if (bx) {
    const b = bounds(all)
    guides.push({ axis: 'v', pos: bx.line, from: b.y, to: b.y + b.h })
  }
  if (by) {
    const b = bounds(all)
    guides.push({ axis: 'h', pos: by.line, from: b.x, to: b.x + b.w })
  }
  return { x, y, guides }
}

/** 等比縮放時吸附到其他圖片的寬度（或高度） */
export function snapResize(
  box: Box,
  nextW: number,
  others: Box[],
  threshold: number,
): { w: number; h: number; matched: boolean } {
  const ratio = box.h / box.w
  for (const o of others) {
    if (Math.abs(o.w - nextW) <= threshold) return { w: o.w, h: o.w * ratio, matched: true }
    if (Math.abs(o.h - nextW * ratio) <= threshold) return { w: o.h / ratio, h: o.h, matched: true }
  }
  return { w: nextW, h: nextW * ratio, matched: false }
}

/** 瀏覽器畫布上限：單邊 32767、面積約 2.68 億像素（行動裝置較小） */
export const MAX_SIDE = 32767
export const MAX_AREA = 268_000_000

/** 匯出尺寸：超過上限時自動降低倍率 */
export function exportScale(w: number, h: number, wanted: number, maxArea = MAX_AREA): number {
  let s = wanted
  if (w * s > MAX_SIDE) s = MAX_SIDE / w
  if (h * s > MAX_SIDE) s = Math.min(s, MAX_SIDE / h)
  if (w * h * s * s > maxArea) s = Math.min(s, Math.sqrt(maxArea / (w * h)))
  return s
}
