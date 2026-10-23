/** GIF 製作的參數型別、預設值與品質預設檔 */
import type { DitherMode } from './dither'
import type { Fps } from './timeline'

export type OutputFormat = 'gif' | 'apng' | 'webp'
export type PaletteMode = 'global' | 'frame'
export type PresetId = 'small' | 'balanced' | 'high'
export type FitMode = 'contain' | 'cover'

export const WIDTH_PRESETS = { sm: 320, md: 480, lg: 640 } as const
export type WidthPreset = keyof typeof WIDTH_PRESETS
export const WIDTH_OPTIONS = [240, 320, 400, 480, 560, 640] as const
export const WIDTH_MIN = 64
export const WIDTH_MAX = 1920
export const COLORS_MIN = 16
export const COLORS_MAX = 256

export interface GifSettings {
  fps: Fps
  /** 輸出寬度（px），或 original＝裁切後的原始寬度 */
  width: number | 'original'
  loop: 'infinite' | number
  speed: number
  reverse: boolean
  pingpong: boolean
  colors: number
  dither: DitherMode
  palette: PaletteMode
  /** 影格差異最佳化：沒變化的像素寫成透明 */
  optimize: boolean
  /** 差異容許值（RGB 距離平方），由預設檔決定 */
  tolerance: number
  format: OutputFormat
  webpQuality: number
  webpLossless: boolean
  /** 圖片模式：尺寸不同時的擺放方式 */
  fit: FitMode
  background: string
}

/** 每個預設檔會設定的欄位 */
type PresetFields = Pick<
  GifSettings,
  'fps' | 'width' | 'colors' | 'dither' | 'palette' | 'optimize' | 'tolerance'
>

export const PRESETS: Record<PresetId, PresetFields> = {
  small: {
    fps: 10,
    width: 320,
    colors: 64,
    dither: 'bayer',
    palette: 'global',
    optimize: true,
    tolerance: 192,
  },
  balanced: {
    fps: 12,
    width: 480,
    colors: 128,
    dither: 'bayer',
    palette: 'global',
    optimize: true,
    tolerance: 48,
  },
  high: {
    fps: 20,
    width: 640,
    colors: 256,
    dither: 'fs',
    palette: 'frame',
    optimize: true,
    tolerance: 0,
  },
}

export const DEFAULT_SETTINGS: GifSettings = {
  ...PRESETS.balanced,
  loop: 'infinite',
  speed: 1,
  reverse: false,
  pingpong: false,
  format: 'gif',
  webpQuality: 90,
  webpLossless: false,
  fit: 'contain',
  background: '#FFFFFF',
}

/** 目前設定符合哪個預設檔（都不符合時為 null，顯示「自訂」） */
export function matchPreset(s: GifSettings): PresetId | null {
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const p = PRESETS[id]
    if (
      p.fps === s.fps &&
      p.width === s.width &&
      p.colors === s.colors &&
      p.dither === s.dither &&
      p.palette === s.palette &&
      p.optimize === s.optimize
    )
      return id
  }
  return null
}

/** 正規化：補上新版本加入的欄位、修正超出範圍的值（讀取 localStorage 時使用） */
export function normalizeSettings(raw: Partial<GifSettings> | undefined): GifSettings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) }
  if (s.width !== 'original')
    s.width = Math.round(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Number(s.width) || 480)))
  s.colors = Math.round(Math.min(COLORS_MAX, Math.max(COLORS_MIN, Number(s.colors) || 128)))
  s.speed = Math.min(3, Math.max(0.5, Number(s.speed) || 1))
  if (s.loop !== 'infinite') s.loop = Math.round(Math.min(99, Math.max(1, Number(s.loop) || 1)))
  s.webpQuality = Math.round(Math.min(100, Math.max(1, Number(s.webpQuality) || 90)))
  return s
}

export const MIME: Record<OutputFormat, string> = {
  gif: 'image/gif',
  apng: 'image/png',
  webp: 'image/webp',
}
export const EXT: Record<OutputFormat, string> = { gif: 'gif', apng: 'png', webp: 'webp' }

/** 文字疊加圖層 */
export interface TextLayer {
  id: string
  text: string
  /** 字級：佔輸出高度的比例（0.04–0.3） */
  size: number
  color: string
  strokeColor: string
  /** 描邊粗細：佔字級的比例（0–0.25） */
  stroke: number
  bold: boolean
  /** 文字中心點（0–1，相對輸出畫面） */
  x: number
  y: number
  /** 顯示區間（輸出時間，秒）；end 為 null 表示到最後 */
  start: number
  end: number | null
}

/** 裁切範圍（0–1，相對原始畫面） */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

export type CropRatio = 'free' | 'original' | 'square' | 'r43' | 'r169' | 'r916'

/** 比例（寬／高，以像素計）；free 為 null，original 依原始畫面 */
export function cropRatioValue(r: CropRatio, baseW: number, baseH: number): number | null {
  switch (r) {
    case 'free':
      return null
    case 'original':
      return baseW / baseH
    case 'square':
      return 1
    case 'r43':
      return 4 / 3
    case 'r169':
      return 16 / 9
    case 'r916':
      return 9 / 16
  }
}

/** 依比例在原始畫面中置中取最大範圍 */
export function fitCropToRatio(
  ratio: number | null,
  baseW: number,
  baseH: number,
  prev: CropRect,
): CropRect {
  if (ratio === null) return prev
  // 正規化座標的寬高比 = ratio × baseH / baseW
  const k = (ratio * baseH) / baseW
  let w = 1
  let h = w / k
  if (h > 1) {
    h = 1
    w = k
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

export interface ChromaKey {
  enabled: boolean
  color: string
  /** 0–100 */
  tolerance: number
}

export const DEFAULT_CHROMA: ChromaKey = { enabled: false, color: '#00FF00', tolerance: 30 }

/** 影格計畫：每格的來源（影片秒數或圖片索引）與延遲 */
export interface PlanItem {
  id: string
  src: number
  delayCs: number
}
