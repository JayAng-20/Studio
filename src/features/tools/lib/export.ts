/**
 * 匯出：原圖＋EditState → 檔案 Blob。Worker 與主執行緒共用（環境由 env 提供）。
 * - 畫面沒改又沒選壓縮：直接沿用原檔位元組，只做無損的中繼資料處理（不重新壓縮）。
 * - 其他情況：重新繪製並編碼；保留中繼資料時把原 EXIF（方向改 1、去掉縮圖）放回去。
 * - 移除 GPS／全部時，輸出前再檢查一次確實不含 GPS。
 */
import {
  containsGps,
  extractExif,
  injectExif,
  prepareExifForReencode,
  stripMetadata,
} from '@/lib/tools-metadata'
import { searchQuality } from '@/lib/tools-quality-search'
import {
  renderEdit,
  watermarkActive,
  ctx2d,
  type AnyCanvas,
  type Drawable,
  type MakeCanvas,
} from './render'
import { isLossy, isPassthrough, metaEditable } from './state'
import type { Container, EditState, EncodeMime } from './types'

export interface ExportJob {
  /** 解碼快取用（文件 id） */
  key: string
  /** 可解碼的來源（HEIC 會先轉成瀏覽器可解的格式） */
  source: Blob
  /** 原檔（沿用原檔與讀取 EXIF 用） */
  original: Blob
  container: Container
  srcW: number
  srcH: number
  state: EditState
  /** 由主執行緒依能力決定的實際編碼格式 */
  mime: EncodeMime
}

export interface ExportResult {
  blob: Blob
  mime: string
  width: number
  height: number
  /** 實際使用的品質（1 到 100）；沿用原檔或 PNG 時為 null */
  quality: number | null
  /** 目標大小是否達成 */
  reached: boolean
  passthrough: boolean
  /** 中繼資料無法依設定保留時的說明 */
  metaNote: 'unsupported' | 'too-large' | null
}

export interface ExportEnv {
  make: MakeCanvas
  decode: (key: string, blob: Blob) => Promise<Drawable>
  decodeOnce: (blob: Blob) => Promise<ImageBitmap>
  signal?: AbortSignal
}

export class GpsLeakError extends Error {
  constructor() {
    super('輸出仍含 GPS')
    this.name = 'GpsLeakError'
  }
}

export class EncodeError extends Error {
  constructor(public mime: string) {
    super(`無法編碼 ${mime}`)
    this.name = 'EncodeError'
  }
}

/** 預設高品質（未選壓縮但畫面有編輯時） */
export const DEFAULT_REENCODE_QUALITY = 92

const throwIfAborted = (s?: AbortSignal) => {
  if (s?.aborted) throw new DOMException('Aborted', 'AbortError')
}

export async function encodeCanvas(c: AnyCanvas, mime: string, quality?: number): Promise<Blob> {
  let blob: Blob | null
  if ('convertToBlob' in c) blob = await c.convertToBlob({ type: mime, quality })
  else
    blob = await new Promise<Blob | null>((res) =>
      (c as HTMLCanvasElement).toBlob(res, mime, quality),
    )
  // 不支援的格式會默默退回 PNG
  if (!blob || blob.type !== mime) throw new EncodeError(mime)
  return blob
}

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

export async function runExport(job: ExportJob, env: ExportEnv): Promise<ExportResult> {
  const { state, container, srcW, srcH } = job
  const signal = env.signal

  // 沿用原檔：只做無損的中繼資料處理
  if (isPassthrough(state, srcW, srcH, container)) {
    let bytes: Uint8Array = await bytesOf(job.original)
    if (state.meta !== 'keep')
      bytes = stripMetadata(bytes, state.meta === 'strip-gps' ? 'gps' : 'all')
    if (state.meta !== 'keep' && containsGps(bytes)) throw new GpsLeakError()
    return {
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: job.original.type || job.mime }),
      mime: job.original.type || job.mime,
      width: srcW,
      height: srcH,
      quality: null,
      reached: true,
      passthrough: true,
      metaNote: null,
    }
  }

  throwIfAborted(signal)
  const source = await env.decode(job.key, job.source)
  let wmImage: ImageBitmap | null = null
  if (watermarkActive(state.watermark) && state.watermark.kind === 'image' && state.watermark.image)
    wmImage = await env.decodeOnce(state.watermark.image)
  throwIfAborted(signal)

  let canvas = renderEdit({
    source,
    srcW,
    srcH,
    state,
    stage: 'final',
    make: env.make,
    watermarkImage: wmImage,
  })
  wmImage?.close()
  const width = canvas.width
  const height = canvas.height

  // JPEG 不支援透明：先鋪白底
  if (job.mime === 'image/jpeg') {
    const flat = env.make(width, height)
    const ctx = ctx2d(flat)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(canvas, 0, 0)
    canvas.width = 0
    canvas.height = 0
    canvas = flat
  }

  // 要放回去的 EXIF
  let tiff: Uint8Array | null = null
  let metaNote: ExportResult['metaNote'] = null
  if (state.meta !== 'strip-all') {
    if (metaEditable(container)) {
      const raw = extractExif(await bytesOf(job.original))
      if (raw) {
        try {
          tiff = prepareExifForReencode(raw, {
            stripGps: state.meta === 'strip-gps',
            w: width,
            h: height,
          })
        } catch (e) {
          console.error(e)
          metaNote = 'unsupported'
        }
      }
    } else if (container === 'heic' || container === 'avif') {
      metaNote = 'unsupported'
    }
  }
  const overhead = tiff ? tiff.length + 32 : 0

  const lossy = isLossy(job.mime)
  let blob: Blob
  let quality: number | null = null
  let reached = true
  try {
    if (lossy && state.output.mode === 'target') {
      const target = Math.max(1024, state.output.targetKB * 1024 - overhead)
      const r = await searchQuality(
        (q) => encodeCanvas(canvas, job.mime, q / 100),
        (b) => b.size,
        target,
        { min: 3, max: 95, signal },
      )
      blob = r.result
      quality = r.quality
      reached = r.reached
    } else {
      quality = lossy
        ? state.output.mode === 'quality'
          ? state.output.quality
          : DEFAULT_REENCODE_QUALITY
        : null
      blob = await encodeCanvas(canvas, job.mime, quality === null ? undefined : quality / 100)
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
  throwIfAborted(signal)

  if (tiff) {
    try {
      const out = injectExif(await bytesOf(blob), tiff, { w: width, h: height })
      blob = new Blob([out as Uint8Array<ArrayBuffer>], { type: job.mime })
    } catch (e) {
      console.error(e)
      metaNote = 'too-large'
    }
  }
  if (state.meta !== 'keep' && containsGps(await bytesOf(blob))) throw new GpsLeakError()
  return { blob, mime: job.mime, width, height, quality, reached, passthrough: false, metaNote }
}
