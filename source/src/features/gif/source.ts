/** 影片與圖片來源：探測、seek 取樣、解碼 */
import { decodeImage } from '@/lib/image'

export class SourceError extends Error {
  constructor(public code: 'decode' | 'seek' | 'image') {
    super(code)
    this.name = 'SourceError'
  }
}

const abortError = () => new DOMException('aborted', 'AbortError')

/** 建立一個隱藏的 <video>（掛在畫面外，避免部分瀏覽器不解碼離線的影片） */
export function createHiddenVideo(url: string): HTMLVideoElement {
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.crossOrigin = 'anonymous'
  v.setAttribute('aria-hidden', 'true')
  v.tabIndex = -1
  Object.assign(v.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '2px',
    height: '2px',
    opacity: '0',
    pointerEvents: 'none',
  })
  v.src = url
  document.body.appendChild(v)
  return v
}

export function disposeVideo(v: HTMLVideoElement | null | undefined) {
  if (!v) return
  try {
    v.pause()
    v.removeAttribute('src')
    v.load()
  } catch {
    /* 已釋放 */
  }
  v.remove()
}

function once(
  target: EventTarget,
  ok: string,
  fail: string[] = ['error'],
  timeout = 15000,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer)
      target.removeEventListener(ok, onOk)
      fail.forEach((f) => target.removeEventListener(f, onFail))
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onOk = () => done(resolve)
    const onFail = () => done(() => reject(new SourceError('decode')))
    const onAbort = () => done(() => reject(abortError()))
    const timer = setTimeout(() => done(() => reject(new SourceError('seek'))), timeout)
    target.addEventListener(ok, onOk)
    fail.forEach((f) => target.addEventListener(f, onFail))
    signal?.addEventListener('abort', onAbort)
  })
}

/**
 * 取得影片長度。MediaRecorder 產生的 WebM 常沒有 duration（Infinity）：
 * 先 seek 到極大值讓瀏覽器掃描到結尾，再讀 duration；仍失敗就用已緩衝的結尾或 fallback。
 */
export async function resolveDuration(v: HTMLVideoElement, fallback?: number): Promise<number> {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration
  try {
    const changed = once(v, 'durationchange', ['error'], 8000)
    v.currentTime = 1e101
    await changed
    // 有些瀏覽器第一次 durationchange 仍為 Infinity，再等 seeked
    if (!Number.isFinite(v.duration))
      await once(v, 'seeked', ['error'], 8000).catch(() => undefined)
  } catch {
    /* 退回下方的估計 */
  }
  let d = v.duration
  if (!Number.isFinite(d) || d <= 0) {
    const b = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0
    const bf = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0
    d = Math.max(b, bf, fallback ?? 0)
  }
  // 回到開頭
  try {
    const seeked = once(v, 'seeked', ['error'], 8000)
    v.currentTime = 0
    await seeked
  } catch {
    /* 忽略 */
  }
  return Number.isFinite(d) && d > 0 ? d : (fallback ?? 0)
}

export interface VideoInfo {
  width: number
  height: number
  duration: number
}

/** 探測影片：尺寸與長度；瀏覽器不能解碼時丟 SourceError('decode') */
export async function probeVideo(url: string, fallbackDuration?: number): Promise<VideoInfo> {
  const v = createHiddenVideo(url)
  try {
    if (v.readyState < 1) await once(v, 'loadedmetadata', ['error'], 20000)
    // 有些格式只有聲音或解不開畫面
    if (!v.videoWidth || !v.videoHeight) {
      if (v.readyState < 2) await once(v, 'loadeddata', ['error'], 8000).catch(() => undefined)
      if (!v.videoWidth || !v.videoHeight) throw new SourceError('decode')
    }
    const duration = await resolveDuration(v, fallbackDuration)
    return { width: v.videoWidth, height: v.videoHeight, duration }
  } finally {
    disposeVideo(v)
  }
}

/**
 * 以 seek 取樣影片畫面。一次只處理一個 seek（排隊），避免互相干擾。
 */
export class VideoGrabber {
  readonly video: HTMLVideoElement
  private queue: Promise<unknown> = Promise.resolve()
  private ready: Promise<void>
  duration = 0

  constructor(url: string, duration: number) {
    this.video = createHiddenVideo(url)
    this.duration = duration
    this.ready =
      this.video.readyState >= 2
        ? Promise.resolve()
        : once(this.video, 'loadeddata', ['error'], 20000)
  }

  /** seek 到 t 秒後回傳 video（已可 drawImage） */
  seek(t: number, signal?: AbortSignal): Promise<HTMLVideoElement> {
    const job = this.queue.then(async () => {
      if (signal?.aborted) throw abortError()
      await this.ready
      const v = this.video
      const max = Math.max(0, (Number.isFinite(v.duration) ? v.duration : this.duration) - 0.001)
      const target = Math.min(Math.max(0, t), max)
      if (Math.abs(v.currentTime - target) < 0.0005 && v.readyState >= 2) return v
      // 機器忙碌時 seek 可能很慢：逾時就重試一次（再次指定時間）
      for (let attempt = 0; ; attempt++) {
        const seeked = once(v, 'seeked', ['error'], attempt ? 15000 : 8000, signal)
        v.currentTime = target
        try {
          await seeked
          break
        } catch (e) {
          if (attempt >= 1 || !(e instanceof SourceError) || e.code !== 'seek') throw e
        }
      }
      // 少數瀏覽器在 seeked 當下畫面尚未更新；等一個影格回呼（有支援時）
      if (v.readyState < 2) await once(v, 'canplay', ['error'], 3000, signal).catch(() => undefined)
      return v
    })
    this.queue = job.catch(() => undefined)
    return job
  }

  dispose() {
    disposeVideo(this.video)
  }
}

/** 解碼多張圖片；失敗的圖片回報索引 */
export async function decodeImages(
  files: File[],
  signal?: AbortSignal,
): Promise<{ bitmaps: Array<ImageBitmap | null>; failed: number[] }> {
  const bitmaps: Array<ImageBitmap | null> = []
  const failed: number[] = []
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) {
      bitmaps.forEach((b) => b?.close())
      throw abortError()
    }
    try {
      bitmaps.push(await decodeImage(files[i]))
    } catch (e) {
      console.error(e)
      bitmaps.push(null)
      failed.push(i)
    }
  }
  return { bitmaps, failed }
}
