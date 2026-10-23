/**
 * 幾何：矩陣＋樣式 → 路徑字串。SVG 與 Canvas 共用同一份幾何，輸出完全一致。
 * 座標單位為「模組」，含邊距；最後由 viewBox 或 ctx.scale 放大到輸出尺寸。
 */
import { isFinder, type QrMatrix } from './matrix'
import type { EyeShape, ModuleShape, QrStyle } from './style'

/** 數字輸出：最多 3 位小數，去掉尾零，縮短 SVG 字串 */
const f = (n: number) => String(Math.round(n * 1000) / 1000)

type Corners = [number, number, number, number] // 左上、右上、右下、左下

/** 各角半徑可不同的圓角矩形；ccw=true 時反向繞行（挖空用） */
export function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  [tl, tr, br, bl]: Corners,
  ccw = false,
): string {
  if (!ccw) {
    return (
      `M${f(x + tl)} ${f(y)}H${f(x + w - tr)}` +
      (tr ? `A${f(tr)} ${f(tr)} 0 0 1 ${f(x + w)} ${f(y + tr)}` : '') +
      `V${f(y + h - br)}` +
      (br ? `A${f(br)} ${f(br)} 0 0 1 ${f(x + w - br)} ${f(y + h)}` : '') +
      `H${f(x + bl)}` +
      (bl ? `A${f(bl)} ${f(bl)} 0 0 1 ${f(x)} ${f(y + h - bl)}` : '') +
      `V${f(y + tl)}` +
      (tl ? `A${f(tl)} ${f(tl)} 0 0 1 ${f(x + tl)} ${f(y)}` : '') +
      'Z'
    )
  }
  return (
    `M${f(x + tl)} ${f(y)}` +
    (tl ? `A${f(tl)} ${f(tl)} 0 0 0 ${f(x)} ${f(y + tl)}` : '') +
    `V${f(y + h - bl)}` +
    (bl ? `A${f(bl)} ${f(bl)} 0 0 0 ${f(x + bl)} ${f(y + h)}` : '') +
    `H${f(x + w - br)}` +
    (br ? `A${f(br)} ${f(br)} 0 0 0 ${f(x + w)} ${f(y + h - br)}` : '') +
    `V${f(y + tr)}` +
    (tr ? `A${f(tr)} ${f(tr)} 0 0 0 ${f(x + w - tr)} ${f(y)}` : '') +
    'Z'
  )
}

function circle(cx: number, cy: number, r: number, ccw = false): string {
  const s = ccw ? 0 : 1
  return (
    `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 ${s} ${f(cx + r)} ${f(cy)}` +
    `A${f(r)} ${f(r)} 0 1 ${s} ${f(cx - r)} ${f(cy)}Z`
  )
}

/** 定位點外框或內點的形狀；corner 決定葉形的朝向 */
function eyeShape(
  shape: EyeShape,
  x: number,
  y: number,
  size: number,
  corner: 'tl' | 'tr' | 'bl',
  ccw = false,
): string {
  switch (shape) {
    case 'square':
      return roundedRect(x, y, size, size, [0, 0, 0, 0], ccw)
    case 'rounded': {
      const r = size * 0.3
      return roundedRect(x, y, size, size, [r, r, r, r], ccw)
    }
    case 'circle':
      return circle(x + size / 2, y + size / 2, size / 2, ccw)
    case 'leaf': {
      const r = size * 0.45
      // 朝外的角與朝中心的角做大圓角，另外兩角保持直角
      const c: Corners = corner === 'tr' ? [0, r, 0, r] : [r, 0, r, 0]
      return roundedRect(x, y, size, size, c, ccw)
    }
  }
}

/** 單一模組的路徑（動畫逐點顯示時用） */
export function modulePath(
  shape: ModuleShape,
  x: number,
  y: number,
  nb: { t: boolean; r: boolean; b: boolean; l: boolean },
): string {
  if (shape === 'dots') return circle(x + 0.5, y + 0.5, 0.42)
  if (shape === 'square') return `M${x} ${y}h1v1h-1Z`
  const r = 0.5
  return roundedRect(x, y, 1, 1, [
    !nb.t && !nb.l ? r : 0,
    !nb.t && !nb.r ? r : 0,
    !nb.b && !nb.r ? r : 0,
    !nb.b && !nb.l ? r : 0,
  ])
}

export interface LogoBox {
  x: number
  y: number
  w: number
  h: number
  /** 墊底區塊（含留白） */
  plate: { x: number; y: number; w: number; h: number; r: number } | null
}

export interface Dot {
  /** 含邊距的座標（模組） */
  x: number
  y: number
  /** 與中心的正規化距離 0–1（漣漪動畫延遲用） */
  dist: number
  d: string
}

export interface Geometry {
  n: number
  margin: number
  /** 含邊距的邊長（模組） */
  total: number
  /** 所有一般模組合併成一條路徑 */
  modules: string
  /** 三個定位點外框（evenodd） */
  eyeFrames: string
  /** 三個定位點內點 */
  eyeBalls: string
  /** 各定位點的距離（動畫用） */
  eyes: Array<{ frame: string; ball: string; dist: number }>
  dots: Dot[]
  logo: LogoBox | null
}

/** Logo 區塊：置中、寬度佔符號邊長的 scale 比例；依原圖比例調整高度，並對齊到模組格線 */
export function logoBox(n: number, margin: number, style: QrStyle): LogoBox | null {
  const logo = style.logo
  if (!logo) return null
  const side = n * logo.scale
  const aspect = logo.width / logo.height
  const w = aspect >= 1 ? side : side * aspect
  const h = aspect >= 1 ? side / aspect : side
  const cx = margin + n / 2
  const cy = margin + n / 2
  const pad = 0.6
  const plate = logo.plate
    ? (() => {
        const pw = w + pad * 2
        const ph = h + pad * 2
        return { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph, r: Math.min(pw, ph) * 0.18 }
      })()
    : null
  return { x: cx - w / 2, y: cy - h / 2, w, h, plate }
}

export function buildGeometry(m: QrMatrix, style: QrStyle): Geometry {
  const { n, data } = m
  const margin = style.margin
  const total = n + margin * 2
  const dark = (r: number, c: number) =>
    r >= 0 && c >= 0 && r < n && c < n && data[r * n + c] === 1 && !isFinder(n, r, c)

  const logo = logoBox(n, margin, style)
  // 被 Logo 蓋住的模組直接挖掉（留一點邊）
  const hole = logo ? (logo.plate ?? { x: logo.x, y: logo.y, w: logo.w, h: logo.h }) : null
  const covered = (r: number, c: number) => {
    if (!hole) return false
    const x = c + margin
    const y = r + margin
    return x + 1 > hole.x && x < hole.x + hole.w && y + 1 > hole.y && y < hole.y + hole.h
  }
  const on = (r: number, c: number) => dark(r, c) && !covered(r, c)

  const center = n / 2
  const maxDist = Math.hypot(center, center)
  const dots: Dot[] = []
  let modules = ''
  for (let r = 0; r < n; r++) {
    // 方形：同一列連續模組合併成一段，路徑更短
    let runStart = -1
    for (let c = 0; c <= n; c++) {
      const isOn = c < n && on(r, c)
      if (isOn) {
        const x = c + margin
        const y = r + margin
        const d = modulePath(style.shape, x, y, {
          t: on(r - 1, c),
          r: on(r, c + 1),
          b: on(r + 1, c),
          l: on(r, c - 1),
        })
        dots.push({ x, y, dist: Math.hypot(c + 0.5 - center, r + 0.5 - center) / maxDist, d })
        if (style.shape !== 'square') modules += d
        else if (runStart < 0) runStart = c
      }
      if (style.shape === 'square' && !isOn && runStart >= 0) {
        modules += `M${runStart + margin} ${r + margin}h${c - runStart}v1h-${c - runStart}Z`
        runStart = -1
      }
    }
  }

  const eyePos: Array<[number, number, 'tl' | 'tr' | 'bl']> = [
    [0, 0, 'tl'],
    [n - 7, 0, 'tr'],
    [0, n - 7, 'bl'],
  ]
  const eyes = eyePos.map(([c, r, corner]) => {
    const x = c + margin
    const y = r + margin
    const frame =
      eyeShape(style.eyeFrame, x, y, 7, corner) +
      eyeShape(style.eyeFrame, x + 1, y + 1, 5, corner, true)
    const ball = eyeShape(style.eyeBall, x + 2, y + 2, 3, corner)
    const dist = Math.hypot(c + 3.5 - center, r + 3.5 - center) / maxDist
    return { frame, ball, dist }
  })

  return {
    n,
    margin,
    total,
    modules,
    eyeFrames: eyes.map((e) => e.frame).join(''),
    eyeBalls: eyes.map((e) => e.ball).join(''),
    eyes,
    dots,
    logo,
  }
}

/** 漸層座標（模組單位，涵蓋符號區域） */
export function gradientCoords(geo: Geometry, angleDeg: number) {
  const c = geo.margin + geo.n / 2
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const half = (geo.n / 2) * (Math.abs(cos) + Math.abs(sin))
  return {
    x1: c - cos * half,
    y1: c - sin * half,
    x2: c + cos * half,
    y2: c + sin * half,
    cx: c,
    cy: c,
    r: (geo.n / 2) * Math.SQRT2,
  }
}
