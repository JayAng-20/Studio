/**
 * 動畫逐格轉換（P2）：動態 GIF／APNG／動態 WebP → 動態 GIF 或動態 WebP。
 * - 解碼：優先用 WebCodecs ImageDecoder（逐格、已合成）；不支援時 GIF 改用內建的 JS 解碼器，
 *   APNG／WebP 則回傳 null，由呼叫端退回「只轉第一格」。
 * - 編碼：逐格串流處理（GIF 每格各自調色盤；WebP 每格編碼後只保留壓縮資料），記憶體用量與格數無關。
 */
import { computeOutputSize, fitPixels, type Size } from '../lib/resize'
import { compositeGif, parseGif } from '../lib/gifDecode'
import { extractFrameChunks, muxAnimatedWebp, type WebpFrame } from '../lib/webpMux'
import { encodeWebpWasm } from './codecs'
import { wasmSupported } from './wasm'
import { EngineError, FORMATS, type ConvertJob, type ConvertResult } from '../types'
import type { Report, Surface } from './pipeline'

/** 單一動畫最多處理的格數（避免超長動畫耗盡時間與記憶體） */
export const MAX_FRAMES = 1000
/** 小於這個值的延遲，瀏覽器多半以 100 ms 播放 */
const MIN_DELAY = 20
const DEFAULT_DELAY = 100

interface FrameSource {
  width: number
  height: number
  count: number
  /** 0 表示無限循環 */
  loop: number
  frames(): AsyncGenerator<{ image: CanvasImageSource; duration: number; done: () => void }>
}

const MIME: Partial<Record<ConvertJob['source'], string>> = {
  gif: 'image/gif',
  apng: 'image/png',
  webp: 'image/webp',
}

type Env = {
  createSurface: (w: number, h: number) => Surface
  ctxOf: (
    s: Surface,
    willRead?: boolean,
  ) => OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  surfaceToBlob: (s: Surface, type: string, q?: number) => Promise<Blob>
  canvasCanEncode: (mime: string) => Promise<boolean>
  releaseSurface: (s: Surface | null | undefined) => void
}

async function imageDecoderSource(job: ConvertJob): Promise<FrameSource | null> {
  const type = MIME[job.source]
  if (!type || typeof ImageDecoder === 'undefined') return null
  try {
    if (!(await ImageDecoder.isTypeSupported(type))) return null
  } catch {
    return null
  }
  const decoder = new ImageDecoder({ data: await job.file.arrayBuffer(), type })
  await decoder.tracks.ready
  const track = decoder.tracks.selectedTrack
  if (!track || track.frameCount < 2) {
    decoder.close()
    return null
  }
  const first = await decoder.decode({ frameIndex: 0 })
  const width = first.image.displayWidth
  const height = first.image.displayHeight
  first.image.close()
  const rep = track.repetitionCount
  return {
    width,
    height,
    count: Math.min(MAX_FRAMES, track.frameCount),
    loop: !Number.isFinite(rep) ? 0 : Math.max(0, Math.round(rep)),
    async *frames() {
      try {
        for (let i = 0; i < Math.min(MAX_FRAMES, track.frameCount); i++) {
          const { image } = await decoder.decode({ frameIndex: i })
          const ms = (image.duration ?? 0) / 1000
          yield { image, duration: ms, done: () => image.close() }
        }
      } finally {
        decoder.close()
      }
    },
  }
}

async function gifJsSource(job: ConvertJob, env: Env): Promise<FrameSource | null> {
  if (job.source !== 'gif') return null
  const gif = parseGif(new Uint8Array(await job.file.arrayBuffer()))
  if (gif.frames.length < 2) return null
  return {
    width: gif.width,
    height: gif.height,
    count: Math.min(MAX_FRAMES, gif.frames.length),
    loop: gif.loop,
    async *frames() {
      const s = env.createSurface(gif.width, gif.height)
      const c = env.ctxOf(s, true)
      try {
        for (const f of compositeGif(gif)) {
          if (f.index >= MAX_FRAMES) break
          c.putImageData(new ImageData(f.rgba, gif.width, gif.height), 0, 0)
          yield { image: s, duration: f.delay, done: () => {} }
        }
      } finally {
        env.releaseSurface(s)
      }
    },
  }
}

const normDelay = (ms: number) => (ms >= MIN_DELAY ? ms : DEFAULT_DELAY)

/** 把一格畫到輸出尺寸的畫布上（每格重畫，透明區保持透明） */
function drawFrame(env: Env, target: Surface, image: CanvasImageSource) {
  const c = env.ctxOf(target, true)
  c.clearRect(0, 0, target.width, target.height)
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'
  c.drawImage(image, 0, 0, target.width, target.height)
  return c
}

/**
 * 轉換動畫；來源不是動畫或無法逐格解碼時回傳 null（呼叫端改轉第一格）。
 */
export async function convertAnimated(
  job: ConvertJob,
  env: Env,
  report: Report,
): Promise<ConvertResult | null> {
  const opts = job.options
  const src = (await imageDecoderSource(job)) ?? (await gifJsSource(job, env))
  if (!src) return null
  let size: Size = computeOutputSize({ width: src.width, height: src.height }, opts.resize)
  const limited = fitPixels(size, Math.min(job.limits.maxPixels, 16_777_216))
  const warnings: ConvertResult['warnings'] = []
  if (limited.limited) {
    size = limited
    warnings.push('downscaled-pixels')
  }
  const target = env.createSurface(size.width, size.height)
  const total = src.count
  let i = 0
  try {
    if (opts.format === 'gif') {
      const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
      const enc = GIFEncoder()
      for await (const f of src.frames()) {
        const c = drawFrame(env, target, f.image)
        f.done()
        const d = c.getImageData(0, 0, size.width, size.height)
        const palette = quantize(d.data, 256, { format: 'rgba4444', oneBitAlpha: true })
        const index = applyPalette(d.data, palette, 'rgba4444')
        const ti = palette.findIndex((p) => p[3] === 0)
        enc.writeFrame(index, size.width, size.height, {
          palette,
          delay: normDelay(f.duration),
          transparent: ti >= 0,
          transparentIndex: Math.max(0, ti),
          // 每格都是完整畫面：有透明時先清除上一格，避免殘影
          dispose: ti >= 0 ? 2 : 1,
          repeat: src.loop,
        })
        i++
        report(Math.min(0.98, i / total))
      }
      enc.finish()
      const bytes = enc.bytes()
      return result(bytes, 'image/gif', 'gifenc')
    }
    if (opts.format === 'webp') {
      const canvasOK = await env.canvasCanEncode('image/webp')
      if (!canvasOK && !wasmSupported()) throw new EngineError('unsupported', 'webp')
      const frames: WebpFrame[] = []
      for await (const f of src.frames()) {
        const c = drawFrame(env, target, f.image)
        f.done()
        let bytes: Uint8Array
        if (canvasOK) {
          const b = await env.surfaceToBlob(target, 'image/webp', opts.quality / 100)
          bytes = new Uint8Array(await b.arrayBuffer())
        } else {
          bytes = await encodeWebpWasm(c.getImageData(0, 0, size.width, size.height), opts.quality)
        }
        const fr = extractFrameChunks(bytes)
        frames.push({
          ...fr,
          width: size.width,
          height: size.height,
          duration: normDelay(f.duration),
        })
        i++
        report(Math.min(0.95, i / total))
      }
      const bytes = muxAnimatedWebp(frames, {
        width: size.width,
        height: size.height,
        loop: src.loop,
      })
      return result(bytes, 'image/webp', 'webp-anim')
    }
    return null
  } finally {
    env.releaseSurface(target)
  }

  function result(
    bytes: Uint8Array,
    mime: string,
    encoder: ConvertResult['encoder'],
  ): ConvertResult {
    return {
      buffer: (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.slice().buffer) as ArrayBuffer,
      mime,
      width: size.width,
      height: size.height,
      srcWidth: src!.width,
      srcHeight: src!.height,
      encoder,
      quality: FORMATS[opts.format].quality ? opts.quality : undefined,
      exif: 'stripped',
      warnings,
      frames: i,
    }
  }
}
