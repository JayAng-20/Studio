/**
 * 進階編碼器（@jsquash：MozJPEG、libwebp、libavif、oxipng）與 AVIF 解碼器。
 * WASM 以 Vite 打包（?url），第一次使用時才下載並編譯，下載進度透過 onProgress 回報。
 * 直接載入各 codec 的 emscripten 膠水程式並自行提供 instantiateWasm，
 * 避免在不同環境（開發伺服器、預先打包）下找不到 .wasm 的問題。
 */
import mozjpegWasmUrl from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url'
import webpWasmUrl from '@jsquash/webp/codec/enc/webp_enc.wasm?url'
import webpSimdWasmUrl from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url'
import avifEncWasmUrl from '@jsquash/avif/codec/enc/avif_enc.wasm?url'
import avifDecWasmUrl from '@jsquash/avif/codec/dec/avif_dec.wasm?url'
import oxipngWasmUrl from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url'
import { EngineError, type CodecId } from '../types'
import { wasmSupported } from './wasm'

export type CodecProgress = (codec: CodecId, loaded: number, total: number, done?: boolean) => void

let progressSink: CodecProgress = () => {}
/** 設定下載進度的接收者（Worker 會轉送給主執行緒） */
export function setCodecProgress(fn: CodecProgress) {
  progressSink = fn
}

export { wasmSupported }

/** 偵測 WASM SIMD（與 wasm-feature-detect 相同的最小模組） */
function simdSupported(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    )
  } catch {
    return false
  }
}

/** 下載 WASM 並回報進度，再編譯成 Module */
async function compileWasm(codec: CodecId, url: string): Promise<WebAssembly.Module> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  let bytes: Uint8Array
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    progressSink(codec, 0, total)
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      progressSink(codec, loaded, total)
    }
    bytes = new Uint8Array(loaded)
    let o = 0
    for (const c of chunks) {
      bytes.set(c, o)
      o += c.length
    }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer())
  }
  const mod = await WebAssembly.compile(bytes as Uint8Array<ArrayBuffer>)
  progressSink(codec, bytes.length, bytes.length, true)
  return mod
}

interface EmscriptenFactoryOptions {
  noInitialRun?: boolean
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    cb: (instance: WebAssembly.Instance) => void,
  ) => WebAssembly.Exports
}
type EmscriptenFactory<M> = (opts: EmscriptenFactoryOptions) => Promise<M>

function instantiate<M>(factory: EmscriptenFactory<M>, wasm: WebAssembly.Module): Promise<M> {
  return factory({
    noInitialRun: true,
    instantiateWasm: (imports, cb) => {
      const instance = new WebAssembly.Instance(wasm, imports)
      cb(instance)
      return instance.exports
    },
  })
}

/** 同一個 codec 只載入一次；失敗時清除快取讓下次可重試 */
function lazy<T>(codec: CodecId, load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null
  return () => {
    if (!wasmSupported()) return Promise.reject(new EngineError('codec-load', `${codec}: WebAssembly 不可用`))
    p ??= load().catch((e) => {
      p = null
      console.error(e)
      throw new EngineError('codec-load', `${codec} 載入失敗`)
    })
    return p
  }
}

// ───────────── MozJPEG ─────────────

interface JpegModule {
  encode(data: BufferSource, w: number, h: number, opts: Record<string, unknown>): Uint8Array
}
const JPEG_DEFAULTS = {
  quality: 75,
  baseline: false,
  arithmetic: false,
  progressive: true,
  optimize_coding: true,
  smoothing: 0,
  color_space: 3,
  quant_table: 3,
  trellis_multipass: false,
  trellis_opt_zero: false,
  trellis_opt_table: false,
  trellis_loops: 1,
  auto_subsample: true,
  chroma_subsample: 2,
  separate_chroma_quality: false,
  chroma_quality: 75,
}
const loadMozjpeg = lazy('mozjpeg', async () => {
  const [glue, wasm] = await Promise.all([
    import('@jsquash/jpeg/codec/enc/mozjpeg_enc.js'),
    compileWasm('mozjpeg', mozjpegWasmUrl),
  ])
  return instantiate(glue.default as unknown as EmscriptenFactory<JpegModule>, wasm)
})

export async function encodeMozjpeg(img: ImageData, quality: number): Promise<Uint8Array> {
  const m = await loadMozjpeg()
  const out = m.encode(img.data, img.width, img.height, { ...JPEG_DEFAULTS, quality, chroma_quality: quality })
  if (!out) throw new EngineError('encode', 'mozjpeg')
  return out.slice()
}

// ───────────── WebP ─────────────

interface WebpModule {
  encode(data: BufferSource, w: number, h: number, opts: Record<string, unknown>): Uint8Array | null
}
const WEBP_DEFAULTS = {
  quality: 75,
  target_size: 0,
  target_PSNR: 0,
  method: 4,
  sns_strength: 50,
  filter_strength: 60,
  filter_sharpness: 0,
  filter_type: 1,
  partitions: 0,
  segments: 4,
  pass: 1,
  show_compressed: 0,
  preprocessing: 0,
  autofilter: 0,
  partition_limit: 0,
  alpha_compression: 1,
  alpha_filtering: 1,
  alpha_quality: 100,
  lossless: 0,
  exact: 0,
  image_hint: 0,
  emulate_jpeg_size: 0,
  thread_level: 0,
  low_memory: 0,
  near_lossless: 100,
  use_delta_palette: 0,
  use_sharp_yuv: 0,
}
const loadWebp = lazy('webp', async () => {
  const simd = simdSupported()
  const [glue, wasm] = await Promise.all([
    simd ? import('@jsquash/webp/codec/enc/webp_enc_simd.js') : import('@jsquash/webp/codec/enc/webp_enc.js'),
    compileWasm('webp', simd ? webpSimdWasmUrl : webpWasmUrl),
  ])
  return instantiate(glue.default as unknown as EmscriptenFactory<WebpModule>, wasm)
})

export async function encodeWebpWasm(img: ImageData, quality: number, lossless = false): Promise<Uint8Array> {
  const m = await loadWebp()
  const out = m.encode(img.data, img.width, img.height, {
    ...WEBP_DEFAULTS,
    quality,
    lossless: lossless ? 1 : 0,
    exact: lossless ? 1 : 0,
  })
  if (!out) throw new EngineError('encode', 'webp')
  return out.slice()
}

// ───────────── AVIF ─────────────

interface AvifEncModule {
  encode(data: BufferSource, w: number, h: number, opts: Record<string, unknown>): Uint8Array | null
}
const AVIF_DEFAULTS = {
  quality: 50,
  qualityAlpha: -1,
  denoiseLevel: 0,
  tileColsLog2: 0,
  tileRowsLog2: 0,
  speed: 6,
  subsample: 1,
  chromaDeltaQ: false,
  sharpness: 0,
  tune: 0,
  enableSharpYUV: false,
  bitDepth: 8,
}
const loadAvifEnc = lazy('avif', async () => {
  const [glue, wasm] = await Promise.all([
    import('@jsquash/avif/codec/enc/avif_enc.js'),
    compileWasm('avif', avifEncWasmUrl),
  ])
  return instantiate(glue.default as unknown as EmscriptenFactory<AvifEncModule>, wasm)
})

export async function encodeAvifWasm(img: ImageData, quality: number): Promise<Uint8Array> {
  const m = await loadAvifEnc()
  const out = m.encode(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.width, img.height, {
    ...AVIF_DEFAULTS,
    quality,
  })
  if (!out) throw new EngineError('encode', 'avif')
  return out.slice()
}

interface AvifDecModule {
  decode(data: BufferSource, bitDepth: 8): ImageData | null
}
const loadAvifDec = lazy('avif-dec', async () => {
  const [glue, wasm] = await Promise.all([
    import('@jsquash/avif/codec/dec/avif_dec.js'),
    compileWasm('avif-dec', avifDecWasmUrl),
  ])
  return instantiate(glue.default as unknown as EmscriptenFactory<AvifDecModule>, wasm)
})

/** 瀏覽器無法解碼 AVIF 時的備援 */
export async function decodeAvifWasm(buffer: ArrayBuffer): Promise<ImageData> {
  const m = await loadAvifDec()
  const out = m.decode(buffer, 8)
  if (!out) throw new EngineError('decode', 'avif')
  return out
}

// ───────────── oxipng ─────────────

interface OxipngModule {
  optimise(data: Uint8Array, level: number, interlace: boolean, optimizeAlpha: boolean): Uint8Array
}
const loadOxipng = lazy('oxipng', async () => {
  const [glue, wasm] = await Promise.all([
    import('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js'),
    compileWasm('oxipng', oxipngWasmUrl),
  ])
  await (glue.default as unknown as (m: WebAssembly.Module) => Promise<unknown>)(wasm)
  return glue as unknown as OxipngModule
})

/** 無損最佳化 PNG（level 2：速度與壓縮率的平衡點）；optimizeAlpha 讓全透明像素可被改寫以利壓縮 */
export async function optimizePng(png: Uint8Array, level = 2): Promise<Uint8Array> {
  const m = await loadOxipng()
  return m.optimise(png, level, false, true).slice()
}
