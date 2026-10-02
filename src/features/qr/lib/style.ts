/** QR 樣式定義與預設值 */

export type Ecc = 'L' | 'M' | 'Q' | 'H'
export const ECC_LEVELS: Ecc[] = ['L', 'M', 'Q', 'H']

export type ModuleShape = 'square' | 'rounded' | 'dots'
export type EyeShape = 'square' | 'rounded' | 'circle' | 'leaf'
export type FillType = 'solid' | 'linear' | 'radial'

export interface FillStyle {
  type: FillType
  color: string
  color2: string
  /** 線性漸層角度（度，0 = 左到右，90 = 上到下） */
  angle: number
}

export interface LogoStyle {
  /** data URL（已縮到 512 px 以內） */
  src: string
  width: number
  height: number
  /** 佔 QR 寬度的比例（0.12–0.3） */
  scale: number
  /** 在 Logo 後面墊一塊背景色 */
  plate: boolean
}

export interface QrStyle {
  fg: FillStyle
  bg: string
  bgTransparent: boolean
  shape: ModuleShape
  eyeFrame: EyeShape
  eyeBall: EyeShape
  /** 定位點使用不同顏色 */
  eyeCustom: boolean
  eyeColor: string
  /** 邊距（模組數） */
  margin: number
  /** 輸出尺寸（px） */
  size: number
  ecc: Ecc
  logo: LogoStyle | null
}

export const SIZE_MIN = 256
export const SIZE_MAX = 2048
export const MARGIN_MAX = 8
export const LOGO_MIN = 0.12
export const LOGO_MAX = 0.3
/** Logo 超過這個比例時提示風險較高 */
export const LOGO_WARN = 0.24

export function defaultStyle(): QrStyle {
  return {
    fg: { type: 'solid', color: '#0F172A', color2: '#2F6BEA', angle: 45 },
    bg: '#FFFFFF',
    bgTransparent: false,
    shape: 'square',
    eyeFrame: 'square',
    eyeBall: 'square',
    eyeCustom: false,
    eyeColor: '#2F6BEA',
    margin: 4,
    size: 1024,
    ecc: 'M',
    logo: null,
  }
}

/** 樣式中所有前景色（對比檢查用） */
export function foregroundColors(s: QrStyle): string[] {
  const list = [s.fg.color]
  if (s.fg.type !== 'solid') list.push(s.fg.color2)
  if (s.eyeCustom) list.push(s.eyeColor)
  return list
}

/** 從儲存資料還原樣式：缺少或型別不對的欄位用預設值補上 */
export function sanitizeStyle(input: unknown): QrStyle {
  const d = defaultStyle()
  if (!input || typeof input !== 'object') return d
  const o = input as Record<string, unknown>
  const hex = (v: unknown, f: string) =>
    typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : f
  const pick = <T extends string>(v: unknown, list: readonly T[], f: T): T =>
    typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : f
  const num = (v: unknown, min: number, max: number, f: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : f
  const fg = (o.fg && typeof o.fg === 'object' ? o.fg : {}) as Record<string, unknown>
  const shapes = ['square', 'rounded', 'circle', 'leaf'] as const
  let logo: LogoStyle | null = null
  if (o.logo && typeof o.logo === 'object') {
    const l = o.logo as Record<string, unknown>
    if (typeof l.src === 'string' && l.src.startsWith('data:image/')) {
      logo = {
        src: l.src,
        width: num(l.width, 1, 4096, 1),
        height: num(l.height, 1, 4096, 1),
        scale: num(l.scale, LOGO_MIN, LOGO_MAX, 0.2),
        plate: l.plate !== false,
      }
    }
  }
  return {
    fg: {
      type: pick(fg.type, ['solid', 'linear', 'radial'] as const, d.fg.type),
      color: hex(fg.color, d.fg.color),
      color2: hex(fg.color2, d.fg.color2),
      angle: num(fg.angle, 0, 360, d.fg.angle),
    },
    bg: hex(o.bg, d.bg),
    bgTransparent: o.bgTransparent === true,
    shape: pick(o.shape, ['square', 'rounded', 'dots'] as const, d.shape),
    eyeFrame: pick(o.eyeFrame, shapes, d.eyeFrame),
    eyeBall: pick(o.eyeBall, shapes, d.eyeBall),
    eyeCustom: o.eyeCustom === true,
    eyeColor: hex(o.eyeColor, d.eyeColor),
    margin: Math.round(num(o.margin, 0, MARGIN_MAX, d.margin)),
    size: Math.round(num(o.size, SIZE_MIN, SIZE_MAX, d.size)),
    ecc: logo ? 'H' : pick(o.ecc, ['L', 'M', 'Q', 'H'] as const, d.ecc),
    logo,
  }
}
