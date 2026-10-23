/**
 * 裁切／縮放／旋轉的幾何計算（純函式，可單元測試）。
 *
 * 座標系：
 * - 原圖（source）：解碼後（已套用 EXIF 方向）的寬高 srcW × srcH。
 * - 框架（frame）：依 rot／flip 轉正後的原圖，寬高為 orientedSize()。拉直是在框架內
 *   以中心旋轉並放大到填滿框架，所以框架大小不受拉直影響。
 * - 裁切與遮蔽區域都存在框架座標。
 */
import type { AspectId, EditState, Geometry, Rect, ResizeSpec, Rot } from './types'

/** 單邊上限：大部分瀏覽器 canvas 的安全範圍 */
export const MAX_SIDE = 16384
/** 裁切框最小邊長（框架像素） */
export const MIN_CROP = 8

export const clampNum = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function orientedSize(w: number, h: number, rot: Rot): { w: number; h: number } {
  return rot % 180 === 0 ? { w, h } : { w: h, h: w }
}

export const frameOf = (g: Geometry, srcW: number, srcH: number) => orientedSize(srcW, srcH, g.rot)

/**
 * 拉直時的放大倍率：把 fw×fh 的圖旋轉 angle 度後，要放大多少才能完全蓋住同大小的框架。
 * s = cos|θ| + max(fw/fh, fh/fw)·sin|θ|
 */
export function coverScale(fw: number, fh: number, angleDeg: number): number {
  const a = Math.abs((angleDeg * Math.PI) / 180)
  if (a === 0 || fw <= 0 || fh <= 0) return 1
  return Math.cos(a) + Math.max(fw / fh, fh / fw) * Math.sin(a)
}

export const fullRect = (fw: number, fh: number): Rect => ({ x: 0, y: 0, w: fw, h: fh })

/** 把矩形限制在框架內（大小至少 min） */
export function clampRect(r: Rect, fw: number, fh: number, min = 1): Rect {
  const w = clampNum(r.w, Math.min(min, fw), fw)
  const h = clampNum(r.h, Math.min(min, fh), fh)
  const x = clampNum(r.x, 0, fw - w)
  const y = clampNum(r.y, 0, fh - h)
  return { x, y, w, h }
}

/** 目前的裁切範圍（沒有裁切時是整個框架） */
export function cropRect(g: Geometry, srcW: number, srcH: number): Rect {
  const f = frameOf(g, srcW, srcH)
  return g.crop ? clampRect(g.crop, f.w, f.h) : fullRect(f.w, f.h)
}

export const isFullRect = (r: Rect, fw: number, fh: number, eps = 0.5) =>
  Math.abs(r.x) < eps && Math.abs(r.y) < eps && Math.abs(r.w - fw) < eps && Math.abs(r.h - fh) < eps

/** 把框架座標的矩形跟著框架順時針（dir=1）或逆時針（dir=−1）轉 90° */
export function rotateRect(r: Rect, fw: number, fh: number, dir: 1 | -1): Rect {
  return dir === 1
    ? { x: fh - r.y - r.h, y: r.x, w: r.h, h: r.w }
    : { x: r.y, y: fw - r.x - r.w, w: r.h, h: r.w }
}

export function flipRect(r: Rect, fw: number, fh: number, axis: 'h' | 'v'): Rect {
  return axis === 'h' ? { ...r, x: fw - r.x - r.w } : { ...r, y: fh - r.y - r.h }
}

const normRot = (deg: number) => (((deg % 360) + 360) % 360) as Rot

/**
 * 畫面順時針／逆時針轉 90°。
 * 可見變換是 F·R(rot)；當只有一個軸翻轉時，R90·F = F·R(−90)，所以 rot 要反向加。
 */
export function rotateGeometry(g: Geometry, srcW: number, srcH: number, dir: 1 | -1): Geometry {
  const f = frameOf(g, srcW, srcH)
  const oneFlip = g.flipH !== g.flipV
  return {
    ...g,
    rot: normRot(g.rot + dir * (oneFlip ? -90 : 90)),
    crop: g.crop ? rotateRect(g.crop, f.w, f.h, dir) : null,
  }
}

/**
 * 畫面水平／垂直翻轉。拉直是在可見空間，翻轉後方向相反（F·Rθ = R−θ·F）。
 * 兩軸都翻轉等於轉 180°，正規化成只有 rot，讓之後的旋轉計算維持簡單。
 */
export function flipGeometry(g: Geometry, srcW: number, srcH: number, axis: 'h' | 'v'): Geometry {
  const f = frameOf(g, srcW, srcH)
  let flipH = axis === 'h' ? !g.flipH : g.flipH
  let flipV = axis === 'v' ? !g.flipV : g.flipV
  let rot = g.rot
  if (flipH && flipV) {
    flipH = false
    flipV = false
    rot = normRot(rot + 180)
  }
  return {
    rot,
    flipH,
    flipV,
    angle: g.angle === 0 ? 0 : -g.angle,
    crop: g.crop ? flipRect(g.crop, f.w, f.h, axis) : null,
  }
}

/** 轉 90° 時，像素尺寸也要交換寬高 */
export function rotateResize(spec: ResizeSpec): ResizeSpec {
  if (!spec || spec.mode !== 'px') return spec
  return { ...spec, width: spec.height, height: spec.width }
}

/** EditState 層級的旋轉：幾何、遮蔽區域、輸出尺寸一起轉 */
export function rotateState(s: EditState, srcW: number, srcH: number, dir: 1 | -1): EditState {
  const f = frameOf(s.geometry, srcW, srcH)
  return {
    ...s,
    geometry: rotateGeometry(s.geometry, srcW, srcH, dir),
    redactions: s.redactions.map((r) => ({ ...r, rect: rotateRect(r.rect, f.w, f.h, dir) })),
    resize: rotateResize(s.resize),
    ...rotateAspect(s),
  }
}

/** 轉 90° 後裁切框比例也跟著轉：16:9 ⇄ 9:16，其他固定比例切換直式旗標 */
function rotateAspect(s: EditState): Pick<EditState, 'aspect' | 'aspectFlip'> {
  if (s.aspect === '16:9') return { aspect: '9:16', aspectFlip: false }
  if (s.aspect === '9:16') return { aspect: '16:9', aspectFlip: false }
  if (s.aspect === '4:3' || s.aspect === '3:2' || s.aspect === 'custom')
    return { aspect: s.aspect, aspectFlip: !s.aspectFlip }
  return { aspect: s.aspect, aspectFlip: s.aspectFlip }
}

/** 這個比例可以切換直式／橫式嗎 */
export const aspectFlippable = (a: AspectId) => a === '4:3' || a === '3:2' || a === 'custom'

export function flipState(s: EditState, srcW: number, srcH: number, axis: 'h' | 'v'): EditState {
  const f = frameOf(s.geometry, srcW, srcH)
  return {
    ...s,
    geometry: flipGeometry(s.geometry, srcW, srcH, axis),
    redactions: s.redactions.map((r) => ({ ...r, rect: flipRect(r.rect, f.w, f.h, axis) })),
  }
}

export const ASPECTS: Record<Exclude<AspectId, 'free' | 'original' | 'custom'>, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
}

/** 比例值（寬／高）；自由裁切回傳 null */
export function aspectRatioOf(
  aspect: AspectId,
  custom: [number, number],
  flip: boolean,
  fw: number,
  fh: number,
): number | null {
  if (aspect === 'free') return null
  if (aspect === 'original') return fw / fh
  let r: number
  if (aspect === 'custom') {
    const [a, b] = custom
    if (!(a > 0 && b > 0)) return null
    r = a / b
  } else r = ASPECTS[aspect]
  return flip && aspectFlippable(aspect) ? 1 / r : r
}

/** EditState 的目前比例 */
export const stateRatio = (s: EditState, fw: number, fh: number) =>
  aspectRatioOf(s.aspect, s.customAspect, s.aspectFlip, fw, fh)

/** 指定比例下、能放進框架的最大矩形，盡量以 around 的中心為中心 */
export function fitAspect(ratio: number, fw: number, fh: number, around?: Rect): Rect {
  let w = fw
  let h = w / ratio
  if (h > fh) {
    h = fh
    w = h * ratio
  }
  const cx = around ? around.x + around.w / 2 : fw / 2
  const cy = around ? around.y + around.h / 2 : fh / 2
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }, fw, fh)
}

/** 平移裁切框（不超出框架） */
export function moveRect(r: Rect, dx: number, dy: number, fw: number, fh: number): Rect {
  return {
    ...r,
    x: clampNum(r.x + dx, 0, fw - r.w),
    y: clampNum(r.y + dy, 0, fh - r.h),
  }
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/**
 * 拖曳把手改變裁切框大小。固定比例時：角落把手以較大的一邊為準、對角固定；
 * 邊把手以另一軸的中心為準等比例延伸。永遠不超出框架、不小於 min。
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  opts: { ratio: number | null; fw: number; fh: number; min?: number },
): Rect {
  const { ratio, fw, fh } = opts
  const min = Math.min(opts.min ?? MIN_CROP, fw, fh)
  const hasW = handle.includes('w')
  const hasE = handle.includes('e')
  const hasN = handle.includes('n')
  const hasS = handle.includes('s')
  let x0 = start.x
  let y0 = start.y
  let x1 = start.x + start.w
  let y1 = start.y + start.h
  if (hasW) x0 = clampNum(x0 + dx, 0, x1 - min)
  if (hasE) x1 = clampNum(x1 + dx, x0 + min, fw)
  if (hasN) y0 = clampNum(y0 + dy, 0, y1 - min)
  if (hasS) y1 = clampNum(y1 + dy, y0 + min, fh)
  if (!ratio) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }

  const corner = (hasW || hasE) && (hasN || hasS)
  if (corner) {
    let w = x1 - x0
    let h = y1 - y0
    if (w / ratio > h) h = w / ratio
    else w = h * ratio
    // 對角固定，限制在框架內
    const maxW = hasE ? fw - start.x : start.x + start.w
    const maxH = hasS ? fh - start.y : start.y + start.h
    if (w > maxW) {
      w = maxW
      h = w / ratio
    }
    if (h > maxH) {
      h = maxH
      w = h * ratio
    }
    if (w < min || h < min) {
      const k = Math.max(min / w, min / h)
      w *= k
      h *= k
    }
    const ax = hasE ? start.x : start.x + start.w
    const ay = hasS ? start.y : start.y + start.h
    return { x: hasE ? ax : ax - w, y: hasS ? ay : ay - h, w, h }
  }
  if (hasW || hasE) {
    let w = x1 - x0
    let h = w / ratio
    const cy = start.y + start.h / 2
    const maxH = 2 * Math.min(cy, fh - cy)
    if (h > maxH) {
      h = maxH
      w = h * ratio
    }
    const ax = hasE ? start.x : start.x + start.w
    return { x: hasE ? ax : ax - w, y: cy - h / 2, w, h }
  }
  let h = y1 - y0
  let w = h * ratio
  const cx = start.x + start.w / 2
  const maxW = 2 * Math.min(cx, fw - cx)
  if (w > maxW) {
    w = maxW
    h = w / ratio
  }
  const ay = hasS ? start.y : start.y + start.h
  return { x: cx - w / 2, y: hasS ? ay : ay - h, w, h }
}

export interface SnapResult {
  rect: Rect
  /** 吸附到的參考線（框架座標），用來畫輔助線 */
  guideX: number | null
  guideY: number | null
  /** 自由裁切時吸附到的常用比例 */
  ratioLabel: string | null
}

function bestSnap(values: number[], targets: number[], thr: number) {
  let best: { delta: number; target: number } | null = null
  for (const v of values)
    for (const t of targets) {
      const d = t - v
      if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.delta)))
        best = { delta: d, target: t }
    }
  return best
}

/** 平移時：邊緣吸附框架邊界、中心吸附框架中線 */
export function snapMove(r: Rect, fw: number, fh: number, thr: number): SnapResult {
  const sx = bestSnap([r.x, r.x + r.w / 2, r.x + r.w], [0, fw / 2, fw], thr)
  const sy = bestSnap([r.y, r.y + r.h / 2, r.y + r.h], [0, fh / 2, fh], thr)
  const rect = {
    ...r,
    x: clampNum(r.x + (sx?.delta ?? 0), 0, fw - r.w),
    y: clampNum(r.y + (sy?.delta ?? 0), 0, fh - r.h),
  }
  const guideX = sx && sx.target > 0 && sx.target < fw ? sx.target : null
  const guideY = sy && sy.target > 0 && sy.target < fh ? sy.target : null
  return { rect, guideX, guideY, ratioLabel: null }
}

export const SNAP_RATIOS: Array<[string, number]> = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
]

/**
 * 縮放時：移動中的邊吸附框架邊界與中線；自由比例時，接近常用比例（±2.5%）就吸附過去。
 */
export function snapResize(
  r: Rect,
  handle: Handle,
  fw: number,
  fh: number,
  thr: number,
  ratio: number | null,
): SnapResult {
  let { x, y, w, h } = r
  let guideX: number | null = null
  let guideY: number | null = null
  let ratioLabel: string | null = null
  if (!ratio) {
    if (handle.includes('w')) {
      const s = bestSnap([x], [0, fw / 2], thr)
      if (s) {
        w -= s.delta
        x += s.delta
        guideX = s.target > 0 ? s.target : null
      }
    } else if (handle.includes('e')) {
      const s = bestSnap([x + w], [fw / 2, fw], thr)
      if (s) {
        w += s.delta
        guideX = s.target < fw ? s.target : null
      }
    }
    if (handle.includes('n')) {
      const s = bestSnap([y], [0, fh / 2], thr)
      if (s) {
        h -= s.delta
        y += s.delta
        guideY = s.target > 0 ? s.target : null
      }
    } else if (handle.includes('s')) {
      const s = bestSnap([y + h], [fh / 2, fh], thr)
      if (s) {
        h += s.delta
        guideY = s.target < fh ? s.target : null
      }
    }
    // 常用比例磁吸：調整「另一個」維度，固定拖曳中的那一邊
    const q = w / h
    for (const [label, k] of SNAP_RATIOS) {
      if (Math.abs(q / k - 1) > 0.025) continue
      const horizontalOnly = handle === 'e' || handle === 'w'
      let nx = x
      let ny = y
      let nw = w
      let nh = h
      if (horizontalOnly) nw = h * k
      else nh = w / k
      if (handle.includes('w')) nx = x + w - nw
      if (handle.includes('n')) ny = y + h - nh
      if (nx >= -0.5 && ny >= -0.5 && nx + nw <= fw + 0.5 && ny + nh <= fh + 0.5) {
        x = nx
        y = ny
        w = nw
        h = nh
        ratioLabel = label
      }
      break
    }
  }
  return { rect: clampRect({ x, y, w, h }, fw, fh), guideX, guideY, ratioLabel }
}

/** 依縮放設定算出輸出尺寸（cw×ch＝裁切後大小） */
export function resizeTarget(spec: ResizeSpec, cw: number, ch: number): { w: number; h: number } {
  let w = cw
  let h = ch
  if (spec?.mode === 'percent') {
    w = (cw * spec.percent) / 100
    h = (ch * spec.percent) / 100
  } else if (spec?.mode === 'px') {
    if (spec.lock) {
      const k = Math.min(spec.width / cw, spec.height / ch)
      w = cw * k
      h = ch * k
    } else {
      w = spec.width
      h = spec.height
    }
  }
  // 單邊不超過上限（等比例縮回）
  const over = Math.max(w / MAX_SIDE, h / MAX_SIDE, 1)
  return {
    w: Math.max(1, Math.round(w / over)),
    h: Math.max(1, Math.round(h / over)),
  }
}

/** 最終輸出尺寸 */
export function outputSize(s: EditState, srcW: number, srcH: number): { w: number; h: number } {
  const c = cropRect(s.geometry, srcW, srcH)
  return resizeTarget(s.resize, c.w, c.h)
}

/** 依目標比例做置中的最大裁切（批次套用常用尺寸時使用） */
export function centeredCrop(ratio: number, fw: number, fh: number): Rect | null {
  const r = fitAspect(ratio, fw, fh)
  return isFullRect(r, fw, fh, 1) ? null : r
}

/** 框架座標 → 輸出座標的縮放與位移 */
export function frameToOutput(crop: Rect, out: { w: number; h: number }) {
  const sx = out.w / crop.w
  const sy = out.h / crop.h
  return {
    sx,
    sy,
    map: (r: Rect): Rect => ({
      x: (r.x - crop.x) * sx,
      y: (r.y - crop.y) * sy,
      w: r.w * sx,
      h: r.h * sy,
    }),
  }
}
