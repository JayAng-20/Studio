/**
 * ffmpeg.wasm（單執行緒 core，打包進站台，不走 CDN）：裁切（-c copy）與轉 MP4。
 * 這個檔案只在使用者第一次按「裁切」或「轉成 MP4」時才動態載入。
 */
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'
import { extensionFor } from './core'

export type EngineProgress = (phase: 'load' | 'run', p: number | null) => void

let loading: Promise<FFmpeg> | null = null

const abortError = () => new DOMException('canceled', 'AbortError')

/** 下載 wasm 並回報進度（約 30 MB；之後由瀏覽器快取） */
async function fetchWithProgress(
  url: string,
  onProgress: (p: number | null) => void,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`fetch ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const parts: Uint8Array<ArrayBuffer>[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value as Uint8Array<ArrayBuffer>)
    got += value.byteLength
    onProgress(total ? got / total : null)
  }
  return URL.createObjectURL(new Blob(parts, { type: 'application/wasm' }))
}

async function load(onProgress: EngineProgress, signal: AbortSignal): Promise<FFmpeg> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const ff = new FFmpeg()
  const wasmBlobURL = await fetchWithProgress(wasmURL, (p) => onProgress('load', p), signal)
  try {
    await ff.load({ coreURL, wasmURL: wasmBlobURL }, { signal })
  } finally {
    URL.revokeObjectURL(wasmBlobURL)
  }
  return ff
}

async function getFFmpeg(onProgress: EngineProgress, signal: AbortSignal): Promise<FFmpeg> {
  if (!loading) {
    loading = load(onProgress, signal)
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

/** 取消時直接終止 Worker（下次使用會重新載入） */
function reset(ff: FFmpeg | null) {
  try {
    ff?.terminate()
  } catch {
    /* 忽略 */
  }
  loading = null
}

async function run(
  input: Blob,
  args: (inName: string, outName: string) => string[],
  outExt: string,
  outMime: string,
  expectedDuration: number,
  onProgress: EngineProgress,
  signal: AbortSignal,
): Promise<Blob> {
  if (signal.aborted) throw abortError()
  let ff: FFmpeg | null = null
  const onAbort = () => reset(ff)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    ff = await getFFmpeg(onProgress, signal)
    if (signal.aborted) throw abortError()
    onProgress('run', 0)
    const inName = `in.${extensionFor(input.type)}`
    const outName = `out.${outExt}`
    await ff.writeFile(inName, new Uint8Array(await input.arrayBuffer()))
    const progress = ({ time }: { progress: number; time: number }) => {
      // time 是輸出時間（微秒）
      if (expectedDuration > 0 && time > 0)
        onProgress('run', Math.min(0.99, time / 1e6 / expectedDuration))
    }
    ff.on('progress', progress)
    let code: number
    try {
      code = await ff.exec(args(inName, outName))
    } finally {
      ff.off('progress', progress)
    }
    if (signal.aborted) throw abortError()
    if (code !== 0) throw new Error(`ffmpeg exit ${code}`)
    const data = await ff.readFile(outName)
    await ff.deleteFile(inName).catch(() => {})
    await ff.deleteFile(outName).catch(() => {})
    if (typeof data === 'string' || !data.byteLength) throw new Error('ffmpeg empty output')
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: outMime })
  } catch (e) {
    if (signal.aborted) throw abortError()
    // 出錯後 FS 狀態不確定，重設比較保險
    reset(ff)
    throw e
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

const sec = (v: number) => v.toFixed(3)

/** 裁切：不重新編碼（-c copy），起點可能對齊到最近的關鍵影格 */
export function trimVideo(
  input: Blob,
  start: number,
  end: number,
  onProgress: EngineProgress,
  signal: AbortSignal,
): Promise<Blob> {
  const ext = extensionFor(input.type)
  const len = Math.max(0.1, end - start)
  return run(
    input,
    (i, o) => [
      '-ss',
      sec(start),
      '-i',
      i,
      '-t',
      sec(len),
      '-map',
      '0',
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      ...(ext === 'mp4' ? ['-movflags', '+faststart'] : []),
      o,
    ],
    ext,
    ext === 'mp4' ? 'video/mp4' : 'video/webm',
    len,
    onProgress,
    signal,
  )
}

/** 轉 MP4（H.264＋AAC）：重新編碼，較慢 */
export function convertToMp4(
  input: Blob,
  duration: number,
  onProgress: EngineProgress,
  signal: AbortSignal,
): Promise<Blob> {
  return run(
    input,
    (i, o) => [
      '-i',
      i,
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      o,
    ],
    'mp4',
    'video/mp4',
    duration,
    onProgress,
    signal,
  )
}
