/**
 * 需要在主執行緒解碼的格式：
 * - HEIC／HEIF：heic-to（libheif WASM，約 3 MB），第一次使用才下載，並回報下載進度。
 * - SVG：只能用 <img> 點陣化；直接以目標尺寸繪製，保持向量清晰。
 */
import heicUrl from 'heic-to?url'
import { EngineError } from '../types'

type HeicModule = typeof import('heic-to')

export type HeicProgress = (
  state: 'loading' | 'ready' | 'error',
  loaded: number,
  total: number,
) => void

let heicMod: Promise<HeicModule> | null = null
const heicListeners = new Set<HeicProgress>()

/** 訂閱 HEIC 解碼器的載入進度 */
export function onHeicProgress(fn: HeicProgress) {
  heicListeners.add(fn)
  return () => heicListeners.delete(fn)
}
const emit = (s: 'loading' | 'ready' | 'error', l: number, t: number) =>
  heicListeners.forEach((fn) => fn(s, l, t))

/** 下載解碼器（含進度），再從記憶體中的 Blob URL 載入模組，避免重複下載 */
export function loadHeic(): Promise<HeicModule> {
  heicMod ??= (async () => {
    // 先通知「載入中」，連線建立前也看得到進度條
    emit('loading', 0, 0)
    const res = await fetch(heicUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    const chunks: Uint8Array[] = []
    let loaded = 0
    emit('loading', 0, total)
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.length
        emit('loading', loaded, total)
      }
    } else {
      const buf = new Uint8Array(await res.arrayBuffer())
      chunks.push(buf)
      loaded = buf.length
    }
    const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: 'text/javascript' }))
    try {
      const mod = (await import(/* @vite-ignore */ url)) as HeicModule
      emit('ready', loaded, loaded)
      return mod
    } finally {
      URL.revokeObjectURL(url)
    }
  })().catch((e) => {
    console.error(e)
    heicMod = null
    emit('error', 0, 0)
    throw new EngineError('heic-load', String(e))
  })
  return heicMod
}

export const heicLoaded = () => heicMod !== null

/** 解碼 HEIC：先試瀏覽器原生（例如 Safari），失敗才用 heic-to */
export async function decodeHeic(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    /* 多數瀏覽器不支援原生 HEIC，改用 WASM */
  }
  const { heicTo } = await loadHeic()
  try {
    return await heicTo({ blob: file, type: 'bitmap' })
  } catch (e) {
    console.error(e)
    throw new EngineError('decode', String(e))
  }
}

/** SVG 點陣化：size 未提供時用原始尺寸（沒有尺寸資訊時用 fallback） */
export async function rasterizeSvg(
  file: Blob,
  size?: { width: number; height: number },
  fallback = 1024,
): Promise<ImageBitmap> {
  const blob = file.type === 'image/svg+xml' ? file : new Blob([file], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const canvas = document.createElement('canvas')
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    try {
      await img.decode()
    } catch (e) {
      console.error(e)
      throw new EngineError('decode', 'svg')
    }
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    let w = size?.width ?? nw
    let h = size?.height ?? nh
    if (!w || !h) {
      // 沒有寬高也沒有 viewBox：以 fallback 為長邊
      const ratio = nw && nh ? nw / nh : 1
      w = ratio >= 1 ? fallback : Math.round(fallback * ratio)
      h = ratio >= 1 ? Math.round(fallback / ratio) : fallback
    }
    canvas.width = Math.max(1, Math.round(w))
    canvas.height = Math.max(1, Math.round(h))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new EngineError('memory')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await createImageBitmap(canvas)
  } finally {
    URL.revokeObjectURL(url)
    canvas.width = 0
    canvas.height = 0
  }
}
