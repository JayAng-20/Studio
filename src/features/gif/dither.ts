/**
 * 調色盤對應與抖色（純函式，Worker 與測試共用）。
 * - none：最近色
 * - fs：Floyd–Steinberg 誤差擴散（蛇形掃描，減少方向性紋路）
 * - bayer：8×8 排序式抖色（逐格穩定，適合搭配影格差異最佳化）
 */

export type DitherMode = 'none' | 'fs' | 'bayer'
/** [r, g, b] 或 [r, g, b, a] */
export type Palette = number[][]

/** 8×8 Bayer 矩陣（0–63） */
export const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
] as const

/**
 * 最近色查詢：以每通道 6 bit 為鍵快取結果（262,144 格），
 * 第一次遇到某個色格時才暴力搜尋整個調色盤。
 * skip 為不可被選到的索引（例如保留給透明的那一格）。
 */
export function createNearest(
  palette: Palette,
  skip = -1,
): (r: number, g: number, b: number) => number {
  const n = palette.length
  const pr = new Int32Array(n)
  const pg = new Int32Array(n)
  const pb = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    pr[i] = palette[i][0]
    pg[i] = palette[i][1]
    pb[i] = palette[i][2]
  }
  const cache = new Int16Array(1 << 18).fill(-1)
  return (r: number, g: number, b: number) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2)
    const hit = cache[key]
    if (hit >= 0) return hit
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      if (i === skip) continue
      const dr = r - pr[i]
      const dg = g - pg[i]
      const db = b - pb[i]
      // 依人眼敏感度加權（綠 > 紅 > 藍）
      const d = dr * dr * 3 + dg * dg * 4 + db * db * 2
      if (d < bestD) {
        bestD = d
        best = i
        if (d === 0) break
      }
    }
    cache[key] = best
    return best
  }
}

/** Bayer 抖動幅度：顏色越少，幅度越大 */
export function bayerSpread(colors: number): number {
  const levels = Math.cbrt(Math.max(2, colors))
  return Math.min(72, Math.max(10, (255 / levels) * 0.85))
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

export interface IndexOptions {
  /** 透明格索引；alpha < 128 的像素會直接寫入此索引 */
  transparentIndex?: number
}

/**
 * 把 RGBA 像素對應到調色盤索引。
 * 回傳每像素 1 byte 的索引陣列（長度 = width × height）。
 */
export function indexPixels(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  palette: Palette,
  mode: DitherMode,
  opts: IndexOptions = {},
): Uint8Array {
  const tIndex = opts.transparentIndex ?? -1
  const nearest = createNearest(palette, tIndex)
  const out = new Uint8Array(width * height)
  if (mode === 'fs') return floydSteinberg(rgba, width, height, palette, nearest, out, tIndex)

  const spread = mode === 'bayer' ? bayerSpread(palette.length) : 0
  for (let y = 0; y < height; y++) {
    const row = (y & 7) << 3
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const o = p << 2
      if (tIndex >= 0 && rgba[o + 3] < 128) {
        out[p] = tIndex
        continue
      }
      if (spread) {
        const k = (BAYER8[row | (x & 7)] / 64 - 0.5) * spread
        out[p] = nearest(
          clamp255(rgba[o] + k),
          clamp255(rgba[o + 1] + k),
          clamp255(rgba[o + 2] + k),
        )
      } else {
        out[p] = nearest(rgba[o], rgba[o + 1], rgba[o + 2])
      }
    }
  }
  return out
}

function floydSteinberg(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  palette: Palette,
  nearest: (r: number, g: number, b: number) => number,
  out: Uint8Array,
  tIndex: number,
): Uint8Array {
  // 兩列誤差緩衝（目前列、下一列），每像素 3 通道；左右各多留一格免邊界判斷
  const w = width + 2
  let cur = new Float32Array(w * 3)
  let next = new Float32Array(w * 3)
  for (let y = 0; y < height; y++) {
    const ltr = (y & 1) === 0
    const dir = ltr ? 1 : -1
    for (let i = 0; i < width; i++) {
      const x = ltr ? i : width - 1 - i
      const p = y * width + x
      const o = p << 2
      const e = (x + 1) * 3
      if (tIndex >= 0 && rgba[o + 3] < 128) {
        out[p] = tIndex
        continue
      }
      const r = clamp255(rgba[o] + cur[e])
      const g = clamp255(rgba[o + 1] + cur[e + 1])
      const b = clamp255(rgba[o + 2] + cur[e + 2])
      const idx = nearest(r | 0, g | 0, b | 0)
      out[p] = idx
      const c = palette[idx]
      const er = r - c[0]
      const eg = g - c[1]
      const eb = b - c[2]
      // 7/16 往前、3/16 下一列後方、5/16 正下方、1/16 下一列前方
      const f = e + dir * 3
      const bk = e - dir * 3
      cur[f] += (er * 7) / 16
      cur[f + 1] += (eg * 7) / 16
      cur[f + 2] += (eb * 7) / 16
      next[bk] += (er * 3) / 16
      next[bk + 1] += (eg * 3) / 16
      next[bk + 2] += (eb * 3) / 16
      next[e] += (er * 5) / 16
      next[e + 1] += (eg * 5) / 16
      next[e + 2] += (eb * 5) / 16
      next[f] += er / 16
      next[f + 1] += eg / 16
      next[f + 2] += eb / 16
    }
    const tmp = cur
    cur = next
    next = tmp
    next.fill(0)
  }
  return out
}

/** 色鍵去背：與 key 顏色距離小於 tolerance（0–100）的像素設為全透明。回傳被去背的像素數 */
export function applyChromaKey(
  rgba: Uint8Array | Uint8ClampedArray,
  key: [number, number, number],
  tolerance: number,
): number {
  // 0–100 對應到 0–約 180 的 RGB 歐氏距離（平方比較）
  const radius = (Math.max(0, Math.min(100, tolerance)) / 100) * 180
  const r2 = radius * radius
  let count = 0
  for (let o = 0; o < rgba.length; o += 4) {
    const dr = rgba[o] - key[0]
    const dg = rgba[o + 1] - key[1]
    const db = rgba[o + 2] - key[2]
    if (dr * dr + dg * dg + db * db <= r2) {
      rgba[o + 3] = 0
      count++
    }
  }
  return count
}

/** 十六進位色碼 → [r, g, b] */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/**
 * 從多個影格均勻抽樣像素，合成一張「樣本圖」給全域調色盤量化使用。
 * 只取不透明像素；budget 為最多抽樣的像素數。
 */
export function samplePixels(
  frames: Array<Uint8Array | Uint8ClampedArray>,
  budget = 400_000,
): Uint8Array {
  const total = frames.reduce((a, f) => a + f.length / 4, 0)
  const step = Math.max(1, Math.floor(total / budget))
  const out = new Uint8Array(Math.ceil(total / step) * 4 + 4)
  let w = 0
  let offset = 0
  for (const f of frames) {
    const px = f.length / 4
    // 每張影格的起點錯開，避免每格都取到同一欄
    for (let p = (step - (offset % step)) % step; p < px; p += step) {
      const o = p << 2
      if (f[o + 3] < 128) continue
      out[w++] = f[o]
      out[w++] = f[o + 1]
      out[w++] = f[o + 2]
      out[w++] = 255
    }
    offset += px
  }
  // 用 slice 複製：gifenc 以 new Uint32Array(rgba.buffer) 讀取，subarray 會讀到整個緩衝區
  return out.slice(0, Math.max(4, w))
}
