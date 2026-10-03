/** 載入圖片：判斷容器、（HEIC）轉碼、解碼、建立預覽代理圖與縮圖、讀取 EXIF */
import { decodeImage } from '@/lib/image'
import { containsGps, extractExif } from '@/lib/tools-metadata'
import { splitExt } from '@/lib/filename'
import type { Container } from './lib/types'

/** 預覽代理圖的長邊上限：夠清楚又不吃太多記憶體 */
export const PROXY_MAX = 1800
export const THUMB_MAX = 160

export async function sniffFile(file: Blob & { name?: string }): Promise<Container> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const s = (a: number, b: number) => String.fromCharCode(...head.subarray(a, b))
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpeg'
  if (head[0] === 0x89 && s(1, 4) === 'PNG') return 'png'
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'webp'
  if (s(0, 3) === 'GIF') return 'gif'
  if (s(0, 2) === 'BM') return 'bmp'
  if (s(4, 8) === 'ftyp') {
    const brand = s(8, 12)
    if (/avif|avis/.test(brand)) return 'avif'
    if (/hei|hev|mif1|msf1/.test(brand)) return 'heic'
  }
  const ext = splitExt(file.name ?? '').ext
  if (ext === 'svg' || file.type === 'image/svg+xml') return 'svg'
  if (ext === 'heic' || ext === 'heif') return 'heic'
  return 'other'
}

/** HEIC 轉成瀏覽器可解碼的 JPEG（首次使用才載入解碼器） */
async function heicToJpeg(file: Blob): Promise<Blob> {
  const { heicTo } = await (await import('@/lib/heic')).loadHeic()
  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.96 })
}

export interface LoadedImage {
  source: Blob
  container: Container
  srcW: number
  srcH: number
  proxy: ImageBitmap
}

export async function loadImage(file: File): Promise<LoadedImage> {
  const container = await sniffFile(file)
  let source: Blob = file
  let bmp: ImageBitmap
  try {
    bmp = await decodeImage(file)
  } catch (e) {
    // 瀏覽器不能直接解 HEIC：改用 WASM 解碼器
    if (container !== 'heic') throw e
    source = await heicToJpeg(file)
    bmp = await decodeImage(source)
  }
  const srcW = bmp.width
  const srcH = bmp.height
  const long = Math.max(srcW, srcH)
  let proxy = bmp
  if (long > PROXY_MAX) {
    const k = PROXY_MAX / long
    proxy = await createImageBitmap(bmp, {
      resizeWidth: Math.max(1, Math.round(srcW * k)),
      resizeHeight: Math.max(1, Math.round(srcH * k)),
      resizeQuality: 'high',
    })
    bmp.close()
  }
  return { source, container, srcW, srcH, proxy }
}

export interface ExifSummary {
  date?: Date
  make?: string
  model?: string
  lens?: string
  exposure?: number
  fNumber?: number
  iso?: number
  focal?: number
  focal35?: number
  latitude?: number
  longitude?: number
  altitude?: number
  software?: string
  orientation?: number
  /** 讀到的 EXIF 欄位數 */
  fieldCount: number
}

const str = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.replace(/\0/g, '').trim() : undefined
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export async function readExif(
  file: File,
  container: Container,
): Promise<{ exif: ExifSummary | null; hasGps: boolean }> {
  let exif: ExifSummary | null = null
  const bytes =
    container === 'jpeg' || container === 'png' || container === 'webp'
      ? new Uint8Array(await file.arrayBuffer())
      : null
  // exifr 支援 JPEG／PNG／HEIC／AVIF／TIFF；WebP 先取出 EXIF 區塊（TIFF）再交給它
  let input: Blob | Uint8Array | null = null
  if (container === 'jpeg' || container === 'png' || container === 'heic' || container === 'avif')
    input = file
  else if (container === 'webp' && bytes) input = extractExif(bytes)
  if (input)
    try {
      const exifr = (await import('exifr')).default
      const raw = (await exifr.parse(input, {
        tiff: true,
        exif: true,
        gps: true,
        ifd1: false,
        xmp: false,
        icc: false,
        iptc: false,
        translateValues: false,
        reviveValues: true,
        mergeOutput: true,
      })) as Record<string, unknown> | undefined
      if (raw && Object.keys(raw).length) {
        const date = raw.DateTimeOriginal ?? raw.CreateDate ?? raw.ModifyDate
        const make = str(raw.Make)
        let model = str(raw.Model)
        // 型號常常已含廠牌，避免「Apple Apple iPhone」
        if (make && model?.toLowerCase().startsWith(make.toLowerCase()))
          model = model.slice(make.length).trim()
        exif = {
          date: date instanceof Date && !Number.isNaN(date.getTime()) ? date : undefined,
          make,
          model,
          lens: str(raw.LensModel) ?? str(raw.LensMake),
          exposure: num(raw.ExposureTime),
          fNumber: num(raw.FNumber),
          iso: num(raw.ISO) ?? num(raw.ISOSpeedRatings) ?? num(raw.PhotographicSensitivity),
          focal: num(raw.FocalLength),
          focal35: num(raw.FocalLengthIn35mmFormat),
          latitude: num(raw.latitude),
          longitude: num(raw.longitude),
          altitude: num(raw.GPSAltitude),
          software: str(raw.Software),
          orientation: num(raw.Orientation),
          fieldCount: Object.keys(raw).length,
        }
      }
    } catch (e) {
      // 沒有 EXIF 或格式不支援：視為沒有
      console.error(e)
    }
  let hasGps = exif?.latitude !== undefined || exif?.longitude !== undefined
  if (!hasGps && bytes) {
    try {
      hasGps = containsGps(bytes)
    } catch (e) {
      console.error(e)
    }
  }
  return { exif, hasGps }
}
