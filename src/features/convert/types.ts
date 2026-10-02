/** 圖片互轉：主執行緒與 Worker 共用的型別 */
import type { ResizeSpec } from './lib/resize'
import type { SourceFormat } from './lib/probe'

export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'ico' | 'bmp' | 'gif'
export type ExifMode = 'strip' | 'keep-no-gps' | 'keep'
/** best：瀏覽器與進階編碼器都試，取較小者；fast：只用瀏覽器（必要時才用進階編碼器） */
export type EncoderMode = 'best' | 'fast'

export interface ConvertOptions {
  format: OutputFormat
  /** 1 到 100 */
  quality: number
  /** 目標大小模式 */
  targetOn: boolean
  targetKB: number
  resize: ResizeSpec
  /** 透明背景轉 JPG 時的底色（#RRGGBB） */
  background: string
  exif: ExifMode
  encoder: EncoderMode
  icoSizes: number[]
  /** 命名模板 */
  template: string
  /** 動畫（GIF／APNG／動態 WebP）逐格轉換 */
  keepAnimation: boolean
}

export interface FormatInfo {
  mime: string
  ext: string
  /** 有品質設定 */
  quality: boolean
  /** 可指定目標大小 */
  target: boolean
  /** 可寫入 EXIF */
  exif: boolean
  /** 可保留透明 */
  alpha: boolean
  /** 可輸出動畫 */
  animation: boolean
}

export const FORMATS: Record<OutputFormat, FormatInfo> = {
  jpeg: {
    mime: 'image/jpeg',
    ext: 'jpg',
    quality: true,
    target: true,
    exif: true,
    alpha: false,
    animation: false,
  },
  png: {
    mime: 'image/png',
    ext: 'png',
    quality: false,
    target: false,
    exif: true,
    alpha: true,
    animation: false,
  },
  webp: {
    mime: 'image/webp',
    ext: 'webp',
    quality: true,
    target: true,
    exif: true,
    alpha: true,
    animation: true,
  },
  avif: {
    mime: 'image/avif',
    ext: 'avif',
    quality: true,
    target: true,
    exif: false,
    alpha: true,
    animation: false,
  },
  ico: {
    mime: 'image/x-icon',
    ext: 'ico',
    quality: false,
    target: false,
    exif: false,
    alpha: true,
    animation: false,
  },
  bmp: {
    mime: 'image/bmp',
    ext: 'bmp',
    quality: false,
    target: false,
    exif: false,
    alpha: true,
    animation: false,
  },
  gif: {
    mime: 'image/gif',
    ext: 'gif',
    quality: false,
    target: false,
    exif: false,
    alpha: true,
    animation: true,
  },
}

export const OUTPUT_ORDER: OutputFormat[] = ['jpeg', 'png', 'webp', 'avif', 'ico', 'bmp', 'gif']
export const ICO_SIZES = [16, 32, 48, 64, 128, 256] as const

export type EncoderId =
  | 'canvas'
  | 'mozjpeg'
  | 'webp-wasm'
  | 'avif-wasm'
  | 'oxipng'
  | 'ico'
  | 'bmp'
  | 'gifenc'
  | 'webp-anim'

export type WarningCode =
  /** 超過像素上限，已先縮小 */
  | 'downscaled-pixels'
  /** 超過瀏覽器 Canvas 上限，已先縮小 */
  | 'downscaled-canvas'
  /** 最低品質仍超過目標大小 */
  | 'target-unmet'
  /** 輸出格式無法寫入 EXIF */
  | 'exif-unsupported'
  /** EXIF 超過 64 KB，JPEG 無法容納 */
  | 'exif-too-large'
  /** 原檔沒有 EXIF */
  | 'exif-none'
  /** 已保留位置資訊 */
  | 'gps-kept'
  /** 動畫只取第一格 */
  | 'first-frame'
  /** 透明背景已填上底色 */
  | 'flattened'
  /** 記憶體不足，已自動縮小後重新轉換 */
  | 'memory-retry'

export type ErrorCode =
  'decode' | 'memory' | 'encode' | 'codec-load' | 'heic-load' | 'unsupported' | 'crash' | 'unknown'

export type ExifOutcome = 'stripped' | 'kept' | 'none' | 'unsupported' | 'too-large'

export interface EngineLimits {
  /** 解碼與輸出的像素上限 */
  maxPixels: number
}

export interface ConvertJob {
  id: string
  file: File
  /** 主執行緒已解碼（HEIC、SVG）時直接提供 */
  bitmap?: ImageBitmap
  /** bitmap 已是最終尺寸（SVG 依目標尺寸點陣化），不要再縮放 */
  preScaled?: boolean
  source: SourceFormat
  /** 檔頭判斷為動畫（GIF／APNG／動態 WebP） */
  animated?: boolean
  /** 由檔頭取得的顯示尺寸 */
  srcSize?: { width: number; height: number }
  options: ConvertOptions
  limits: EngineLimits
}

export interface ConvertResult {
  buffer: ArrayBuffer
  mime: string
  width: number
  height: number
  srcWidth: number
  srcHeight: number
  encoder: EncoderId
  /** 實際使用的品質（目標大小模式時為搜尋結果） */
  quality?: number
  exif: ExifOutcome
  warnings: WarningCode[]
  frames?: number
}

export interface ThumbJob {
  id: string
  file?: File
  bitmap?: ImageBitmap
  source: SourceFormat
  srcSize?: { width: number; height: number }
  /** 最長邊 */
  maxSide: number
  /** 預覽用：無損 PNG */
  lossless?: boolean
}

export interface ThumbResult {
  buffer: ArrayBuffer
  mime: string
  width: number
  height: number
  srcWidth: number
  srcHeight: number
}

export type CodecId = 'mozjpeg' | 'webp' | 'avif' | 'avif-dec' | 'oxipng'

export type WorkerRequest = { type: 'convert'; job: ConvertJob } | { type: 'thumb'; job: ThumbJob }

export type WorkerResponse =
  | { type: 'progress'; id: string; value: number }
  | { type: 'codec'; codec: CodecId; loaded: number; total: number; done?: boolean }
  | { type: 'convert-done'; id: string; result: ConvertResult }
  | { type: 'thumb-done'; id: string; result: ThumbResult }
  | { type: 'error'; id: string; code: ErrorCode; message: string }

/** 帶錯誤代碼的例外（Worker 與主執行緒共用） */
export class EngineError extends Error {
  constructor(
    public code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'EngineError'
  }
}
