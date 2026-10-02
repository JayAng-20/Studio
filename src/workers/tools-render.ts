/// <reference lib="webworker" />
/**
 * 圖片工具的匯出 Worker：在背景解碼原圖、套用編輯、編碼（含目標大小搜尋）與中繼資料處理，
 * 讓主執行緒在大圖處理時仍保持流暢。解碼結果快取最近兩張（估算時會反覆使用）。
 */
import { runExport, type ExportJob } from '@/features/tools/lib/export'

interface Req {
  id: number
  job: ExportJob
}

const cache = new Map<string, ImageBitmap>()
const CACHE_MAX = 2

async function decode(key: string, blob: Blob): Promise<ImageBitmap> {
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  cache.set(key, bmp)
  while (cache.size > CACHE_MAX) {
    const [k, v] = cache.entries().next().value as [string, ImageBitmap]
    v.close()
    cache.delete(k)
  }
  return bmp
}

const controllers = new Map<number, AbortController>()

self.onmessage = async (e: MessageEvent<Req | { cancel: number } | { drop: string }>) => {
  const msg = e.data
  if ('cancel' in msg) {
    controllers.get(msg.cancel)?.abort()
    return
  }
  if ('drop' in msg) {
    cache.get(msg.drop)?.close()
    cache.delete(msg.drop)
    return
  }
  const ctrl = new AbortController()
  controllers.set(msg.id, ctrl)
  try {
    const result = await runExport(msg.job, {
      make: (w, h) => new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))),
      decode,
      decodeOnce: (b) => createImageBitmap(b),
      signal: ctrl.signal,
    })
    self.postMessage({ id: msg.id, ok: true, result })
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error'
    const message = err instanceof Error ? err.message : String(err)
    self.postMessage({ id: msg.id, ok: false, name, message })
  } finally {
    controllers.delete(msg.id)
  }
}
