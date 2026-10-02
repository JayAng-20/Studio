/** 顏色工具：格式轉換與主色擷取（k-means，純函式） */

export interface Rgb {
  r: number
  g: number
  b: number
}

export const toHex = ({ r, g, b }: Rgb) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase()

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export const rgbString = (c: Rgb) => `rgb(${c.r}, ${c.g}, ${c.b})`
export const hslString = (c: Rgb) => {
  const { h, s, l } = toHsl(c)
  return `hsl(${h}, ${s}%, ${l}%)`
}

/** 相對亮度（決定色票上的文字用黑或白） */
export const isLight = ({ r, g, b }: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b > 150

export interface Swatch {
  hex: string
  rgb: Rgb
  /** 佔比 0 到 1 */
  ratio: number
}

/**
 * 主色擷取：對取樣像素做 k-means（k-means++ 以固定亂數種子初始化，結果穩定），
 * 合併非常接近的顏色，依佔比排序。忽略幾乎透明的像素。
 */
export function extractPalette(data: Uint8ClampedArray, k = 6, maxSamples = 6000): Swatch[] {
  const total = data.length / 4
  const stride = Math.max(1, Math.floor(total / maxSamples))
  const pts: number[] = []
  for (let i = 0; i < total; i += stride) {
    const o = i * 4
    if (data[o + 3] < 128) continue
    pts.push(data[o], data[o + 1], data[o + 2])
  }
  const n = pts.length / 3
  if (!n) return []
  let seed = 1234567
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const kk = Math.min(k, n)
  const centers: number[] = []
  const first = Math.floor(rand() * n)
  centers.push(pts[first * 3], pts[first * 3 + 1], pts[first * 3 + 2])
  const d2 = new Float64Array(n).fill(Infinity)
  while (centers.length / 3 < kk) {
    const c = centers.length - 3
    let sum = 0
    for (let i = 0; i < n; i++) {
      const dr = pts[i * 3] - centers[c]
      const dg = pts[i * 3 + 1] - centers[c + 1]
      const db = pts[i * 3 + 2] - centers[c + 2]
      d2[i] = Math.min(d2[i], dr * dr + dg * dg + db * db)
      sum += d2[i]
    }
    if (sum === 0) break
    let target = rand() * sum
    let pick = n - 1
    for (let i = 0; i < n; i++) {
      target -= d2[i]
      if (target <= 0) {
        pick = i
        break
      }
    }
    centers.push(pts[pick * 3], pts[pick * 3 + 1], pts[pick * 3 + 2])
  }
  const m = centers.length / 3
  const assign = new Int32Array(n)
  for (let iter = 0; iter < 12; iter++) {
    const sums = new Float64Array(m * 4)
    let moved = 0
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < m; c++) {
        const dr = pts[i * 3] - centers[c * 3]
        const dg = pts[i * 3 + 1] - centers[c * 3 + 1]
        const db = pts[i * 3 + 2] - centers[c * 3 + 2]
        const d = dr * dr + dg * dg + db * db
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (assign[i] !== best) moved++
      assign[i] = best
      sums[best * 4] += pts[i * 3]
      sums[best * 4 + 1] += pts[i * 3 + 1]
      sums[best * 4 + 2] += pts[i * 3 + 2]
      sums[best * 4 + 3]++
    }
    for (let c = 0; c < m; c++) {
      const cnt = sums[c * 4 + 3]
      if (!cnt) continue
      centers[c * 3] = sums[c * 4] / cnt
      centers[c * 3 + 1] = sums[c * 4 + 1] / cnt
      centers[c * 3 + 2] = sums[c * 4 + 2] / cnt
    }
    if (iter > 0 && moved === 0) break
  }
  const counts = new Array(m).fill(0)
  for (let i = 0; i < n; i++) counts[assign[i]]++
  const out: Swatch[] = []
  for (let c = 0; c < m; c++) {
    if (!counts[c]) continue
    const rgb = {
      r: Math.round(centers[c * 3]),
      g: Math.round(centers[c * 3 + 1]),
      b: Math.round(centers[c * 3 + 2]),
    }
    const near = out.find((s) => Math.hypot(s.rgb.r - rgb.r, s.rgb.g - rgb.g, s.rgb.b - rgb.b) < 18)
    if (near) near.ratio += counts[c] / n
    else out.push({ hex: toHex(rgb), rgb, ratio: counts[c] / n })
  }
  return out.sort((a, b) => b.ratio - a.ratio)
}
