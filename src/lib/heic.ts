/**
 * HEIC／HEIF 解碼器（heic-to，libheif WASM，約 3 MB）：全站共用同一份檔案，
 * 第一次使用才下載並回報進度，之後重複使用同一個模組。
 */
import heicUrl from 'heic-to?url'

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
    throw e
  })
  return heicMod
}

export const heicLoaded = () => heicMod !== null
