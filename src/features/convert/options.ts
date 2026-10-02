/** 轉檔選項：預設值、儲存、簽章（判斷結果是否過期） */
import { DEFAULT_RESIZE } from './lib/resize'
import { FORMATS, ICO_SIZES, OUTPUT_ORDER, type ConvertOptions, type OutputFormat } from './types'
import { readJSON, writeJSON } from '@/lib/storage'
import { clamp } from '@/lib/format'

/** 本機儲存位置（建議整合者加入 STORAGE_KEYS，讓「重設全部」一併清除） */
export const OPTIONS_KEY = 'jayang:convert-options'

/** 儲存的選項：template 為 null 時跟隨「設定 → 下載檔名規則」 */
export type StoredOptions = Omit<ConvertOptions, 'template'> & { template: string | null }

export function defaultOptions(quality = 85): StoredOptions {
  return {
    format: 'jpeg',
    quality,
    targetOn: false,
    targetKB: 500,
    resize: { ...DEFAULT_RESIZE },
    background: '#FFFFFF',
    exif: 'strip',
    encoder: 'best',
    icoSizes: [16, 32, 48, 256],
    template: null,
    keepAnimation: true,
  }
}

/** 讀取並驗證（舊版或被竄改的資料一律回到預設值） */
export function loadOptions(quality: number): StoredOptions {
  const d = defaultOptions(quality)
  const raw = readJSON<Partial<StoredOptions> | null>(OPTIONS_KEY, null)
  if (!raw || typeof raw !== 'object') return d
  const num = (v: unknown, lo: number, hi: number, fb: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : fb
  const r = (raw.resize ?? {}) as Partial<StoredOptions['resize']>
  return {
    format: OUTPUT_ORDER.includes(raw.format as OutputFormat) ? (raw.format as OutputFormat) : d.format,
    quality: num(raw.quality, 1, 100, d.quality),
    targetOn: typeof raw.targetOn === 'boolean' ? raw.targetOn : d.targetOn,
    targetKB: num(raw.targetKB, 5, 100_000, d.targetKB),
    resize: {
      mode: ['none', 'width', 'height', 'long', 'percent'].includes(r.mode as string)
        ? (r.mode as StoredOptions['resize']['mode'])
        : d.resize.mode,
      width: num(r.width, 1, 30_000, d.resize.width),
      height: num(r.height, 1, 30_000, d.resize.height),
      long: num(r.long, 1, 30_000, d.resize.long),
      percent: num(r.percent, 1, 1000, d.resize.percent),
      upscale: typeof r.upscale === 'boolean' ? r.upscale : d.resize.upscale,
    },
    background: typeof raw.background === 'string' && /^#[0-9a-f]{6}$/i.test(raw.background) ? raw.background : d.background,
    exif: ['strip', 'keep-no-gps', 'keep'].includes(raw.exif as string) ? (raw.exif as StoredOptions['exif']) : d.exif,
    encoder: raw.encoder === 'fast' || raw.encoder === 'best' ? raw.encoder : d.encoder,
    icoSizes:
      Array.isArray(raw.icoSizes) && raw.icoSizes.length
        ? raw.icoSizes.filter((n): n is number => (ICO_SIZES as readonly number[]).includes(n as number))
        : d.icoSizes,
    template: typeof raw.template === 'string' && raw.template.trim() ? raw.template : null,
    keepAnimation: typeof raw.keepAnimation === 'boolean' ? raw.keepAnimation : d.keepAnimation,
  }
}

export function saveOptions(o: StoredOptions) {
  writeJSON(OPTIONS_KEY, o)
}

/** 影響編碼結果的選項簽章（命名模板不算：改名不必重新轉換） */
export function optionsKey(o: Omit<ConvertOptions, 'template'>): string {
  const f = FORMATS[o.format]
  return JSON.stringify([
    o.format,
    f.quality && !o.targetOn ? o.quality : null,
    f.target && o.targetOn ? o.targetKB : null,
    o.format === 'ico' ? null : o.resize.mode === 'none' ? 'none' : o.resize,
    o.format === 'jpeg' ? o.background : null,
    f.exif ? o.exif : 'strip',
    o.format === 'bmp' || o.format === 'gif' ? null : o.encoder,
    o.format === 'ico' ? [...o.icoSizes].sort((a, b) => a - b) : null,
    f.animation ? o.keepAnimation : null,
  ])
}
