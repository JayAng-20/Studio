/**
 * 轉檔流程（Worker 與主執行緒共用）：解碼 → 縮放 → 編碼 → EXIF。
 * 只使用 OffscreenCanvas／HTMLCanvasElement 共通的 API。
 */
import { computeOutputSize, fitPixels, stepDownPlan, type Size } from '../lib/resize'
import { encodeIco } from '@/lib/convert-ico'
import { encodeBmp } from '@/lib/convert-bmp'
import { searchQualityForSize } from '@/lib/convert-targetSize'
import {
  extractExif,
  hasGps,
  insertExifJpeg,
  insertExifPng,
  insertExifWebp,
  MAX_JPEG_EXIF,
  sanitizeTiff,
} from '@/lib/convert-exif'
import { convertAnimated } from './animation'
import {
  decodeAvifWasm,
  encodeAvifWasm,
  encodeMozjpeg,
  encodeWebpWasm,
  optimizePng,
  wasmSupported,
} from './codecs'

export { setCodecProgress } from './codecs'
import {
  EngineError,
  FORMATS,
  type ConvertJob,
  type ConvertOptions,
  type ConvertResult,
  type EncoderId,
  type ExifOutcome,
  type ThumbJob,
  type ThumbResult,
  type WarningCode,
} from '../types'

export type Surface = OffscreenCanvas | HTMLCanvasElement
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type Report = (p: number) => void

const isOffscreen = (s: Surface): s is OffscreenCanvas =>
  typeof OffscreenCanvas !== 'undefined' && s instanceof OffscreenCanvas

export function createSurface(w: number, h: number): Surface {
  const width = Math.max(1, Math.round(w))
  const height = Math.max(1, Math.round(h))
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

export function ctxOf(s: Surface, willRead = false): Ctx {
  const c = isOffscreen(s)
    ? s.getContext('2d', { willReadFrequently: willRead })
    : s.getContext('2d', { willReadFrequently: willRead })
  if (!c) throw new EngineError('memory', '無法建立 2D context')
  return c
}

export function releaseSurface(s: Surface | null | undefined) {
  if (!s) return
  s.width = 0
  s.height = 0
}

export function surfaceToBlob(s: Surface, type: string, quality?: number): Promise<Blob> {
  if (isOffscreen(s)) return s.convertToBlob({ type, quality })
  return new Promise((resolve, reject) =>
    s.toBlob(
      (b) => (b ? resolve(b) : reject(new EngineError('memory', 'toBlob 失敗'))),
      type,
      quality,
    ),
  )
}

const encodeCache = new Map<string, Promise<boolean>>()
/** 這個環境的 Canvas 是否真的能編碼此格式（不支援時會默默輸出 PNG） */
export function canvasCanEncode(mime: string): Promise<boolean> {
  if (mime === 'image/png') return Promise.resolve(true)
  let p = encodeCache.get(mime)
  if (!p) {
    p = (async () => {
      try {
        const s = createSurface(2, 2)
        const c = ctxOf(s)
        c.fillStyle = '#fff'
        c.fillRect(0, 0, 2, 2)
        const b = await surfaceToBlob(s, mime, 0.8)
        releaseSurface(s)
        return b.type === mime
      } catch {
        return false
      }
    })()
    encodeCache.set(mime, p)
  }
  return p
}

/** Canvas 面積是否可用（iOS Safari 有約 16.7 MP 的上限，超過會畫出空白） */
function surfaceUsable(w: number, h: number): boolean {
  if (w * h <= 16_777_216) return true
  try {
    const s = createSurface(w, h)
    const c = ctxOf(s, true)
    c.fillStyle = '#000'
    c.fillRect(w - 1, h - 1, 1, 1)
    const ok = c.getImageData(w - 1, h - 1, 1, 1).data[3] === 255
    releaseSurface(s)
    return ok
  } catch {
    return false
  }
}

/** 單邊縮放倍率，讓結果能放進 Canvas */
function fitCanvas(size: Size, warnings: WarningCode[]): Size {
  let cur = size
  // 主流瀏覽器的單邊上限
  const MAX_SIDE = 16384
  if (Math.max(cur.width, cur.height) > MAX_SIDE) {
    const s = MAX_SIDE / Math.max(cur.width, cur.height)
    cur = {
      width: Math.max(1, Math.floor(cur.width * s)),
      height: Math.max(1, Math.floor(cur.height * s)),
    }
    warnings.push('downscaled-canvas')
  }
  if (!surfaceUsable(cur.width, cur.height)) {
    const f = fitPixels(cur, 16_777_216)
    cur = { width: f.width, height: f.height }
    if (!warnings.includes('downscaled-canvas')) warnings.push('downscaled-canvas')
  }
  return cur
}

const isMemoryError = (e: unknown) => {
  const msg = String((e as Error)?.message ?? e).toLowerCase()
  return (e as Error)?.name === 'RangeError' || /memory|allocation|too large|out of/.test(msg)
}

// ───────────── 解碼 ─────────────

async function decodeFile(
  file: Blob,
  source: ConvertJob['source'],
  srcSize: Size | undefined,
  maxPixels: number,
  warnings: WarningCode[],
): Promise<ImageBitmap> {
  const opts: ImageBitmapOptions = { imageOrientation: 'from-image' }
  if (srcSize && srcSize.width * srcSize.height > maxPixels) {
    const f = fitPixels(srcSize, maxPixels)
    // 只指定寬度：高度由瀏覽器依比例計算，不受方向影響
    opts.resizeWidth = f.width
    opts.resizeQuality = 'high'
    warnings.push('downscaled-pixels')
  }
  try {
    return await createImageBitmap(file, opts)
  } catch (e) {
    if (source === 'avif' && wasmSupported()) {
      const img = await decodeAvifWasm(await file.arrayBuffer())
      return createImageBitmap(img)
    }
    if (srcSize && srcSize.width * srcSize.height > 40_000_000 && isMemoryError(e))
      throw new EngineError('memory', String(e))
    console.error(e)
    throw new EngineError('decode', String((e as Error)?.message ?? e))
  }
}

// ───────────── 繪製（分段縮小以保持畫質） ─────────────

export function render(
  src: CanvasImageSource & { width: number; height: number },
  dst: Size,
  opts: { background?: string } = {},
): Surface {
  const plan = stepDownPlan({ width: src.width, height: src.height }, dst)
  let cur: CanvasImageSource = src
  let prev: Surface | null = null
  let out: Surface | null = null
  plan.forEach((step, i) => {
    const last = i === plan.length - 1
    const s = createSurface(step.width, step.height)
    const c = ctxOf(s, last)
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    if (last && opts.background) {
      c.fillStyle = opts.background
      c.fillRect(0, 0, step.width, step.height)
    }
    c.drawImage(cur, 0, 0, step.width, step.height)
    releaseSurface(prev)
    prev = s
    cur = s
    out = s
  })
  if (!out) throw new EngineError('memory')
  return out
}

/** 把圖等比放進 size×size 的透明方塊中央（ICO 用） */
function renderSquare(src: Surface | ImageBitmap, size: number): Surface {
  const scale = Math.min(size / src.width, size / src.height)
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))
  const scaled = w === src.width && h === src.height ? null : render(src, { width: w, height: h })
  const s = createSurface(size, size)
  const c = ctxOf(s)
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'
  c.drawImage(scaled ?? src, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h)
  releaseSurface(scaled)
  return s
}

const blobBytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

function imageDataOf(s: Surface): ImageData {
  return ctxOf(s, true).getImageData(0, 0, s.width, s.height)
}

// ───────────── 編碼 ─────────────

interface Encoded {
  bytes: Uint8Array
  encoder: EncoderId
  quality?: number
  met?: boolean
}

type Encoder = { id: EncoderId; encode: (q: number) => Promise<Uint8Array> }

async function lossyEncoders(s: Surface, opts: ConvertOptions): Promise<Encoder[]> {
  const { mime } = FORMATS[opts.format]
  const canvasOK = await canvasCanEncode(mime)
  let data: ImageData | null = null
  const getData = () => (data ??= imageDataOf(s))
  const canvas: Encoder = {
    id: 'canvas',
    encode: async (q) => {
      const b = await surfaceToBlob(s, mime, q / 100)
      if (b.type !== mime) throw new EngineError('unsupported', mime)
      return blobBytes(b)
    },
  }
  const wasm: Encoder | null = !wasmSupported()
    ? null
    : opts.format === 'jpeg'
      ? { id: 'mozjpeg', encode: (q) => encodeMozjpeg(getData(), q) }
      : opts.format === 'webp'
        ? { id: 'webp-wasm', encode: (q) => encodeWebpWasm(getData(), q) }
        : opts.format === 'avif'
          ? { id: 'avif-wasm', encode: (q) => encodeAvifWasm(getData(), q) }
          : null
  const list: Encoder[] = []
  if (canvasOK) list.push(canvas)
  if (wasm && (!canvasOK || opts.encoder === 'best')) list.push(wasm)
  if (!list.length) throw new EngineError('unsupported', mime)
  return list
}

async function encodeLossy(s: Surface, opts: ConvertOptions, report: Report): Promise<Encoded> {
  const encoders = await lossyEncoders(s, opts)
  if (opts.targetOn) {
    // 目標大小：只用一個編碼器搜尋（最佳模式的 JPEG 用 MozJPEG，每位元組畫質較好）
    const primary =
      (opts.format === 'jpeg' &&
        opts.encoder === 'best' &&
        encoders.find((e) => e.id === 'mozjpeg')) ||
      encoders[0]
    const target = Math.max(1, opts.targetKB) * 1024
    const run = (enc: Encoder) =>
      searchQualityForSize(enc.encode, (b) => b.length, target, {
        maxAttempts: 9,
        onAttempt: ({ attempt }) => report(Math.min(0.95, attempt / 9)),
      })
    let r
    let used = primary
    try {
      r = await run(primary)
    } catch (e) {
      const fallback = encoders.find((x) => x !== primary)
      if (!fallback || !(e instanceof EngineError) || e.code !== 'codec-load') throw e
      console.error(e)
      used = fallback
      r = await run(fallback)
    }
    return { bytes: r.output, encoder: used.id, quality: r.quality, met: r.met }
  }
  let best: Encoded | null = null
  let lastError: unknown = null
  for (let i = 0; i < encoders.length; i++) {
    const e = encoders[i]
    try {
      const bytes = await e.encode(opts.quality)
      if (!best || bytes.length < best.bytes.length)
        best = { bytes, encoder: e.id, quality: opts.quality }
    } catch (err) {
      console.error(err)
      lastError = err
    }
    report((i + 1) / encoders.length)
  }
  if (!best)
    throw lastError instanceof EngineError
      ? lastError
      : new EngineError('encode', String(lastError))
  return best
}

async function encodePng(s: Surface, opts: ConvertOptions, report: Report): Promise<Encoded> {
  const png = await blobBytes(await surfaceToBlob(s, 'image/png'))
  report(0.4)
  if (opts.encoder === 'best' && wasmSupported()) {
    try {
      const level = s.width * s.height > 24_000_000 ? 1 : 2
      const o = await optimizePng(png, level)
      report(1)
      if (o.length < png.length) return { bytes: o, encoder: 'oxipng' }
    } catch (e) {
      console.error(e)
    }
  }
  return { bytes: png, encoder: 'canvas' }
}

async function encodeIcoFrom(
  src: ImageBitmap | Surface,
  opts: ConvertOptions,
  report: Report,
): Promise<Encoded> {
  const sizes = [...new Set(opts.icoSizes)].filter((n) => n >= 1 && n <= 256).sort((a, b) => b - a)
  if (!sizes.length) sizes.push(256, 48, 32, 16)
  // 先畫最大尺寸，較小的尺寸從它縮小（品質好、速度快）
  const largest = renderSquare(src, sizes[0])
  const images: Array<{ width: number; height: number; png: Uint8Array }> = []
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i]
    const s = i === 0 ? largest : render(largest, { width: size, height: size })
    let png: Uint8Array = await blobBytes(await surfaceToBlob(s, 'image/png'))
    if (opts.encoder === 'best' && wasmSupported()) {
      try {
        const o = await optimizePng(png, 2)
        if (o.length < png.length) png = o
      } catch (e) {
        console.error(e)
      }
    }
    images.push({ width: size, height: size, png })
    if (s !== largest) releaseSurface(s)
    report((i + 1) / sizes.length)
  }
  releaseSurface(largest)
  return { bytes: encodeIco(images), encoder: 'ico' }
}

async function encodeGifStatic(s: Surface): Promise<Encoded> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
  const d = imageDataOf(s)
  const palette = quantize(d.data, 256, { format: 'rgba4444', oneBitAlpha: true })
  const index = applyPalette(d.data, palette, 'rgba4444')
  const ti = palette.findIndex((c) => c[3] === 0)
  const enc = GIFEncoder()
  enc.writeFrame(index, s.width, s.height, {
    palette,
    transparent: ti >= 0,
    transparentIndex: Math.max(0, ti),
  })
  enc.finish()
  return { bytes: enc.bytes(), encoder: 'gifenc' }
}

// ───────────── EXIF ─────────────

async function applyExif(
  bytes: Uint8Array,
  file: Blob,
  opts: ConvertOptions,
  size: Size,
  warnings: WarningCode[],
): Promise<{ bytes: Uint8Array; exif: ExifOutcome }> {
  if (opts.exif === 'strip') return { bytes, exif: 'stripped' }
  if (!FORMATS[opts.format].exif) {
    warnings.push('exif-unsupported')
    return { bytes, exif: 'unsupported' }
  }
  const raw = await extractExif(file)
  if (!raw) {
    warnings.push('exif-none')
    return { bytes, exif: 'none' }
  }
  const tiff = sanitizeTiff(raw, {
    resetOrientation: true,
    dropGps: opts.exif === 'keep-no-gps',
    dropThumbnail: true,
    pixelSize: size,
  })
  if (opts.exif === 'keep' && hasGps(tiff)) warnings.push('gps-kept')
  try {
    if (opts.format === 'jpeg') {
      if (tiff.length > MAX_JPEG_EXIF) {
        warnings.push('exif-too-large')
        return { bytes, exif: 'too-large' }
      }
      return { bytes: insertExifJpeg(bytes, tiff), exif: 'kept' }
    }
    if (opts.format === 'png') return { bytes: insertExifPng(bytes, tiff), exif: 'kept' }
    if (opts.format === 'webp') return { bytes: insertExifWebp(bytes, tiff), exif: 'kept' }
  } catch (e) {
    console.error(e)
  }
  warnings.push('exif-unsupported')
  return { bytes, exif: 'unsupported' }
}

// ───────────── 對外：轉檔 ─────────────

const toBuffer = (b: Uint8Array): ArrayBuffer =>
  b.byteOffset === 0 && b.byteLength === b.buffer.byteLength && b.buffer instanceof ArrayBuffer
    ? b.buffer
    : (b.slice().buffer as ArrayBuffer)

export async function convertImage(job: ConvertJob, report: Report): Promise<ConvertResult> {
  const { options: opts } = job
  const warnings: WarningCode[] = []
  let bmp: ImageBitmap | null = null
  let surface: Surface | null = null
  try {
    report(0.02)
    // 動畫逐格轉換（輸出 GIF／WebP 且來源為動畫時）
    if (job.animated && !job.bitmap && opts.keepAnimation && FORMATS[opts.format].animation) {
      const env = { createSurface, ctxOf, surfaceToBlob, canvasCanEncode, releaseSurface }
      const anim = await convertAnimated(job, env, (p) => report(0.04 + p * 0.9))
      if (anim) {
        let out = anim
        if (opts.format === 'webp' && opts.exif !== 'strip') {
          const w = [...anim.warnings]
          const ex = await applyExif(new Uint8Array(anim.buffer), job.file, opts, anim, w)
          out = { ...anim, buffer: toBuffer(ex.bytes), exif: ex.exif, warnings: w }
        } else if (opts.exif !== 'strip') {
          out = { ...anim, exif: 'unsupported', warnings: [...anim.warnings, 'exif-unsupported'] }
        }
        report(1)
        return out
      }
    }
    bmp =
      job.bitmap ??
      (await decodeFile(job.file, job.source, job.srcSize, job.limits.maxPixels, warnings))
    const srcW = job.srcSize?.width ?? bmp.width
    const srcH = job.srcSize?.height ?? bmp.height
    report(0.15)

    let encoded: Encoded
    let outSize: Size
    if (opts.format === 'ico') {
      encoded = await encodeIcoFrom(bmp, opts, (p) => report(0.2 + p * 0.75))
      const max = Math.max(...opts.icoSizes.filter((n) => n <= 256), 16)
      outSize = { width: max, height: max }
    } else {
      // 縮放（以實際解碼尺寸計算；SVG 已在主執行緒依目標尺寸點陣化）
      const decoded = { width: bmp.width, height: bmp.height }
      let target: Size = job.preScaled ? decoded : computeOutputSize(decoded, opts.resize)
      const limited = fitPixels(target, job.limits.maxPixels)
      if (limited.limited) {
        target = limited
        if (!warnings.includes('downscaled-pixels')) warnings.push('downscaled-pixels')
      }
      target = fitCanvas(target, warnings)
      const flatten = opts.format === 'jpeg'
      surface = render(bmp, target, { background: flatten ? opts.background : undefined })
      bmp.close()
      bmp = null
      outSize = { width: surface.width, height: surface.height }
      report(0.3)
      const sub: Report = (p) => report(0.3 + p * 0.62)
      switch (opts.format) {
        case 'jpeg':
        case 'webp':
        case 'avif':
          encoded = await encodeLossy(surface, opts, sub)
          break
        case 'png':
          encoded = await encodePng(surface, opts, sub)
          break
        case 'bmp': {
          encoded = { bytes: encodeBmp(imageDataOf(surface), { alpha: 'auto' }), encoder: 'bmp' }
          break
        }
        case 'gif':
          encoded = await encodeGifStatic(surface)
          break
        default:
          throw new EngineError('unsupported', opts.format)
      }
    }
    if (opts.targetOn && FORMATS[opts.format].target && encoded.met === false)
      warnings.push('target-unmet')
    report(0.94)
    const withExif = await applyExif(encoded.bytes, job.file, opts, outSize, warnings)
    report(1)
    return {
      buffer: toBuffer(withExif.bytes),
      mime: FORMATS[opts.format].mime,
      width: outSize.width,
      height: outSize.height,
      srcWidth: srcW,
      srcHeight: srcH,
      encoder: encoded.encoder,
      quality: FORMATS[opts.format].quality ? encoded.quality : undefined,
      exif: withExif.exif,
      warnings,
    }
  } catch (e) {
    if (e instanceof EngineError) throw e
    if (isMemoryError(e)) throw new EngineError('memory', String(e))
    throw new EngineError('encode', String((e as Error)?.message ?? e))
  } finally {
    bmp?.close()
    releaseSurface(surface)
  }
}

// ───────────── 對外：縮圖／預覽 ─────────────

export async function makeThumb(job: ThumbJob): Promise<ThumbResult> {
  let bmp: ImageBitmap | null = job.bitmap ?? null
  let s: Surface | null = null
  try {
    if (!bmp) {
      if (!job.file) throw new EngineError('decode')
      try {
        // 已知尺寸時直接以縮小尺寸解碼（只指定寬度，高度由瀏覽器依比例計算），省下大量記憶體
        const known = job.srcSize
        const opts: ImageBitmapOptions = { imageOrientation: 'from-image' }
        if (known && Math.max(known.width, known.height) > job.maxSide * 2) {
          opts.resizeWidth = Math.max(
            1,
            Math.round((job.maxSide * 1.5 * known.width) / Math.max(known.width, known.height)),
          )
          opts.resizeQuality = 'medium'
        }
        bmp = await createImageBitmap(job.file, opts)
      } catch (e) {
        if (job.source === 'avif' && wasmSupported()) {
          bmp = await createImageBitmap(await decodeAvifWasm(await job.file.arrayBuffer()))
        } else {
          console.error(e)
          throw new EngineError('decode', String(e))
        }
      }
    }
    const srcWidth = job.srcSize?.width ?? bmp.width
    const srcHeight = job.srcSize?.height ?? bmp.height
    const scale = Math.min(1, job.maxSide / Math.max(bmp.width, bmp.height))
    const dst = {
      width: Math.max(1, Math.round(bmp.width * scale)),
      height: Math.max(1, Math.round(bmp.height * scale)),
    }
    s = render(bmp, dst)
    bmp.close()
    bmp = null
    let blob: Blob
    if (job.lossless) blob = await surfaceToBlob(s, 'image/png')
    else if (await canvasCanEncode('image/webp')) blob = await surfaceToBlob(s, 'image/webp', 0.82)
    else blob = await surfaceToBlob(s, 'image/png')
    return {
      buffer: await blob.arrayBuffer(),
      mime: blob.type,
      width: dst.width,
      height: dst.height,
      srcWidth,
      srcHeight,
    }
  } catch (e) {
    if (e instanceof EngineError) throw e
    throw new EngineError(isMemoryError(e) ? 'memory' : 'decode', String(e))
  } finally {
    bmp?.close()
    releaseSurface(s)
  }
}
