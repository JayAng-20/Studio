/**
 * 調整與濾鏡的像素運算（純函式，主執行緒預覽與 Worker 匯出共用同一套，結果一致）。
 * 參數都是相對量（不受解析度影響），所以縮小的預覽與原尺寸匯出看起來一樣。
 */
import type { Adjust, FilterId, FilterSel } from './types'

export interface PixelParams {
  brightness: number
  contrast: number
  saturation: number
  temperature: number
  grayscale: number
  sepia: number
  fade: number
  vignette: number
  sharpen: number
  blur: number
}

const ZERO: PixelParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  grayscale: 0,
  sepia: 0,
  fade: 0,
  vignette: 0,
  sharpen: 0,
  blur: 0,
}

/** 預設濾鏡：疊加在使用者調整之上，強度 0 到 100% */
export const FILTERS: Record<FilterId, Partial<PixelParams>> = {
  none: {},
  vivid: { saturation: 35, contrast: 14, brightness: 4 },
  warm: { temperature: 32, saturation: 8, brightness: 4 },
  cool: { temperature: -30, saturation: -4, contrast: 6 },
  vintage: { sepia: 38, fade: 22, contrast: -6, vignette: 32, saturation: -10 },
  fade: { fade: 30, saturation: -22, contrast: -10, brightness: 6 },
  cinema: { contrast: 18, saturation: -12, temperature: 10, fade: 10, vignette: 26 },
  mono: { grayscale: 100, contrast: 10 },
  noir: { grayscale: 100, contrast: 42, brightness: -6, vignette: 40 },
}

export const FILTER_IDS = Object.keys(FILTERS) as FilterId[]

export function effectiveParams(adjust: Adjust, filter: FilterSel): PixelParams {
  const p: PixelParams = { ...ZERO, ...adjust }
  const f = FILTERS[filter.id]
  const k = filter.strength / 100
  for (const key of Object.keys(f) as (keyof PixelParams)[]) p[key] += (f[key] ?? 0) * k
  p.grayscale = Math.min(100, p.grayscale)
  p.sepia = Math.min(100, p.sepia)
  return p
}

export const isNeutral = (p: PixelParams) =>
  (Object.keys(ZERO) as (keyof PixelParams)[]).every((k) => Math.abs(p[k]) < 0.01)

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** 每個通道相同的色調曲線：亮度（gamma）→ 對比 → 褪色（提升暗部） */
function toneLut(p: PixelParams): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  const gamma = Math.pow(2, (-p.brightness / 100) * 0.9)
  const c = p.contrast / 100
  const cf = c >= 0 ? 1 + c * 1.1 : 1 + c * 0.85
  const f = Math.max(0, p.fade) / 100
  for (let i = 0; i < 256; i++) {
    let v = 255 * Math.pow(i / 255, gamma)
    v = (v - 128) * cf + 128
    v = v * (1 - f * 0.28) + 255 * f * 0.2
    lut[i] = clamp255(v)
  }
  return lut
}

/** 顏色運算：曲線、飽和、色溫、褐色、灰階、暗角 */
export function applyColor(data: Uint8ClampedArray, w: number, h: number, p: PixelParams) {
  const lut = toneLut(p)
  const sat = 1 + p.saturation / 100
  const temp = p.temperature / 100
  const tr = temp * 38
  const tg = temp * 6
  const tb = -temp * 38
  const gray = p.grayscale / 100
  const sep = p.sepia / 100
  const vig = Math.max(0, p.vignette) / 100
  const cx = w / 2
  const cy = h / 2
  const inv = 1 / Math.hypot(cx, cy)
  const needSat = Math.abs(sat - 1) > 1e-3
  for (let y = 0; y < h; y++) {
    const dy = (y - cy) * inv
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let r = lut[data[i]]
      let g = lut[data[i + 1]]
      let b = lut[data[i + 2]]
      if (needSat) {
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
        r = l + (r - l) * sat
        g = l + (g - l) * sat
        b = l + (b - l) * sat
      }
      if (temp) {
        r += tr
        g += tg
        b += tb
      }
      if (sep) {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b
        const sg = 0.349 * r + 0.686 * g + 0.168 * b
        const sb = 0.272 * r + 0.534 * g + 0.131 * b
        r += (sr - r) * sep
        g += (sg - g) * sep
        b += (sb - b) * sep
      }
      if (gray) {
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
        r += (l - r) * gray
        g += (l - g) * gray
        b += (l - b) * gray
      }
      if (vig) {
        const dx = (x - cx) * inv
        const d = Math.sqrt(dx * dx + dy * dy)
        // smoothstep(0.45, 1.05, d)
        const t = Math.min(1, Math.max(0, (d - 0.45) / 0.6))
        const m = 1 - vig * 0.65 * t * t * (3 - 2 * t)
        r *= m
        g *= m
        b *= m
      }
      data[i] = clamp255(r)
      data[i + 1] = clamp255(g)
      data[i + 2] = clamp255(b)
    }
  }
}

/** 以三次方框模糊近似高斯模糊的方框大小 */
function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal)
  if (wl % 2 === 0) wl--
  const wu = wl + 2
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)
  const m = Math.round(mIdeal)
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu))
}

/** 單向方框模糊（邊緣延伸），src → dst */
function boxPass(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
) {
  const len = horizontal ? w : h
  const lines = horizontal ? h : w
  const step = horizontal ? 4 : w * 4
  const iarr = 1 / (r + r + 1)
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w * 4 : line * 4
    for (let c = 0; c < 4; c++) {
      const first = src[base + c]
      const last = src[base + (len - 1) * step + c]
      let acc = (r + 1) * first
      for (let j = 0; j < r; j++) acc += src[base + Math.min(j, len - 1) * step + c]
      for (let j = 0; j < len; j++) {
        const addIdx = j + r
        const subIdx = j - r - 1
        acc += addIdx < len ? src[base + addIdx * step + c] : last
        acc -= subIdx >= 0 ? src[base + subIdx * step + c] : first
        dst[base + j * step + c] = acc * iarr
      }
    }
  }
}

/** 高斯模糊（近似），回傳新陣列 */
export function gaussianBlur(data: Uint8ClampedArray, w: number, h: number, sigma: number) {
  const out = new Uint8ClampedArray(data)
  if (sigma < 0.3) return out
  const tmp = new Uint8ClampedArray(data.length)
  for (const size of boxesForGauss(sigma)) {
    const r = (size - 1) / 2
    if (r < 1) continue
    boxPass(out, tmp, w, h, r, true)
    boxPass(tmp, out, w, h, r, false)
  }
  return out
}

/** 模糊半徑與銳利化：以長邊為基準換算，預覽與原尺寸一致 */
export function applyDetail(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  p: Pick<PixelParams, 'blur' | 'sharpen'>,
) {
  const long = Math.max(w, h)
  if (p.blur > 0.01) {
    const sigma = (p.blur / 100) * long * 0.012
    data.set(gaussianBlur(data, w, h, sigma))
  }
  if (p.sharpen > 0.01) {
    const sigma = Math.max(0.6, long / 1600)
    const blurred = gaussianBlur(data, w, h, sigma)
    const amount = (p.sharpen / 100) * 1.6
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255(data[i] + (data[i] - blurred[i]) * amount)
      data[i + 1] = clamp255(data[i + 1] + (data[i + 1] - blurred[i + 1]) * amount)
      data[i + 2] = clamp255(data[i + 2] + (data[i + 2] - blurred[i + 2]) * amount)
    }
  }
}

/** 馬賽克：把區域切成 block×block 的方格，每格填平均色 */
export function mosaic(data: Uint8ClampedArray, w: number, h: number, block: number) {
  const b = Math.max(2, Math.round(block))
  for (let by = 0; by < h; by += b) {
    for (let bx = 0; bx < w; bx += b) {
      const ex = Math.min(w, bx + b)
      const ey = Math.min(h, by + b)
      let r = 0
      let g = 0
      let bl = 0
      let a = 0
      let n = 0
      for (let y = by; y < ey; y++)
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4
          r += data[i]
          g += data[i + 1]
          bl += data[i + 2]
          a += data[i + 3]
          n++
        }
      r /= n
      g /= n
      bl /= n
      a /= n
      for (let y = by; y < ey; y++)
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4
          data[i] = r
          data[i + 1] = g
          data[i + 2] = bl
          data[i + 3] = a
        }
    }
  }
}
