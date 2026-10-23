/**
 * 圖片工具的編輯狀態：全部「非破壞性」。原圖永遠不變，畫面與匯出都由
 * 原圖＋EditState 重新算出，所以復原／重做只是在狀態快照之間切換。
 */

export type Rot = 0 | 90 | 180 | 270

/** 矩形（像素，座標系見各欄位說明） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type AspectId = 'free' | 'original' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16' | 'custom'

/**
 * 幾何：先依 rot／flip 轉正（「框架」＝轉正後的原圖大小），
 * 再以 angle 拉直（自動放大填滿框架，不留空角），最後在框架座標內裁切。
 */
export interface Geometry {
  rot: Rot
  flipH: boolean
  flipV: boolean
  /** 拉直角度（度），−45 到 45 */
  angle: number
  /** 裁切範圍（框架像素座標）；null＝整張 */
  crop: Rect | null
}

export type ResizeSpec =
  | null
  | { mode: 'percent'; percent: number }
  /** lock：等比例，套用到其他圖片時「等比例縮到 width×height 以內」 */
  | { mode: 'px'; width: number; height: number; lock: boolean }

export interface Adjust {
  /** −100 到 100 */
  brightness: number
  contrast: number
  saturation: number
  /** −100（冷）到 100（暖） */
  temperature: number
  /** 0 到 100 */
  sharpen: number
  blur: number
  grayscale: number
}

export type FilterId =
  'none' | 'vivid' | 'warm' | 'cool' | 'vintage' | 'fade' | 'cinema' | 'mono' | 'noir'

export interface FilterSel {
  id: FilterId
  /** 0 到 100 */
  strength: number
}

export type WatermarkKind = 'text' | 'image'

export interface Watermark {
  enabled: boolean
  kind: WatermarkKind
  text: string
  color: string
  bold: boolean
  shadow: boolean
  /** 文字大小：短邊的百分比 */
  textSize: number
  /** 浮水印圖片（Blob 可被結構化複製送進 Worker） */
  image: Blob | null
  imageName: string
  /** 圖片寬度：輸出寬度的百分比 */
  imageSize: number
  /** 九宮格位置 0 到 8（左上→右下） */
  position: number
  /** 邊距：短邊的百分比 */
  margin: number
  /** 0 到 100 */
  opacity: number
  /** 度 */
  rotation: number
  tile: boolean
  /** 平鋪間距：短邊的百分比 */
  tileGap: number
}

export type RedactMode = 'mosaic' | 'black'

export interface Redaction {
  id: string
  /** 框架像素座標（跟著內容走：之後再裁切也會停在原處） */
  rect: Rect
  mode: RedactMode
}

export type OutputFormat = 'original' | 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif'
export type EncodeMime = Exclude<OutputFormat, 'original'>

/** 壓縮方式：none＝未編輯時保留原檔、有編輯時高品質重新編碼 */
export type CompressMode = 'none' | 'quality' | 'target'

export interface OutputSpec {
  format: OutputFormat
  mode: CompressMode
  /** 1 到 100 */
  quality: number
  /** 目標大小（KB） */
  targetKB: number
}

/** 中繼資料處理 */
export type MetaMode = 'keep' | 'strip-gps' | 'strip-all'

export interface EditState {
  geometry: Geometry
  aspect: AspectId
  /** 比例改成直式（4:3 → 3:4）；16:9 與 9:16 各自獨立，不使用這個旗標 */
  aspectFlip: boolean
  /** 自訂比例 [寬, 高] */
  customAspect: [number, number]
  resize: ResizeSpec
  adjust: Adjust
  filter: FilterSel
  watermark: Watermark
  redactions: Redaction[]
  /** 馬賽克格子大小：長邊的千分比 */
  mosaicSize: number
  output: OutputSpec
  meta: MetaMode
}

export const defaultAdjust = (): Adjust => ({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  sharpen: 0,
  blur: 0,
  grayscale: 0,
})

export const defaultWatermark = (): Watermark => ({
  enabled: false,
  kind: 'text',
  text: '',
  color: '#FFFFFF',
  bold: true,
  shadow: true,
  textSize: 6,
  image: null,
  imageName: '',
  imageSize: 22,
  position: 8,
  margin: 4,
  opacity: 80,
  rotation: 0,
  tile: false,
  tileGap: 12,
})

export const defaultEditState = (quality = 85): EditState => ({
  geometry: { rot: 0, flipH: false, flipV: false, angle: 0, crop: null },
  aspect: 'free',
  aspectFlip: false,
  customAspect: [5, 4],
  resize: null,
  adjust: defaultAdjust(),
  filter: { id: 'none', strength: 100 },
  watermark: defaultWatermark(),
  redactions: [],
  mosaicSize: 22,
  output: { format: 'original', mode: 'none', quality, targetKB: 300 },
  meta: 'keep',
})

/** 原圖的容器格式（決定能不能無損改中繼資料） */
export type Container = 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'avif' | 'heic' | 'svg' | 'other'
