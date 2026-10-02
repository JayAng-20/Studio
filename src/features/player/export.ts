/**
 * A–B 區間匯出：@ffmpeg/ffmpeg 單執行緒版（GitHub Pages 無法設定 COOP／COEP）。
 * core 與 wasm 由 npm 套件以 ?url 打包進站，使用時才延遲載入。
 * 預設 -c copy（快，但起點對齊關鍵影格）；精準剪裁才重新編碼。
 */
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { outputName, splitExt } from '@/lib/filename'
import { ffmpegTime, fileTime } from './logic/timecode'

let instance: FFmpeg | null = null
let loading: Promise<FFmpeg> | null = null

async function getFFmpeg(): Promise<FFmpeg> {
  if (instance?.loaded) return instance
  if (loading) return loading
  loading = (async () => {
    const [{ FFmpeg }, core, wasm] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/core?url'),
      import('@ffmpeg/core/wasm?url'),
    ])
    const ff = new FFmpeg()
    await ff.load({ coreURL: core.default, wasmURL: wasm.default })
    instance = ff
    return ff
  })()
  try {
    return await loading
  } finally {
    loading = null
  }
}

/** 結束 ffmpeg（取消或離開模組時） */
export function disposeFFmpeg() {
  try {
    instance?.terminate()
  } catch (e) {
    console.error(e)
  }
  instance = null
}

export const isFFmpegLoaded = () => !!instance?.loaded

const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'weba'])

/** 決定輸出副檔名與參數 */
export function clipPlan(
  name: string,
  start: number,
  end: number,
  precise: boolean,
): { inName: string; outExt: string; args: (inName: string, outName: string) => string[] } {
  const { ext } = splitExt(name)
  const inExt = ext || 'mp4'
  const inName = `input.${inExt}`
  const dur = ffmpegTime(end - start)
  const ss = ffmpegTime(start)
  const isAudio = AUDIO_EXT.has(inExt)
  if (!precise) {
    return {
      inName,
      outExt: inExt,
      // -ss 放在 -i 前：快速跳到最近的關鍵影格後直接複製
      args: (i, o) => [
        '-ss',
        ss,
        '-i',
        i,
        '-t',
        dur,
        '-map',
        '0',
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        '-y',
        o,
      ],
    }
  }
  // 重新編碼時 -ss 放在 -i 前（輸入端跳轉）仍是逐格精準，而且不必解碼起點之前的畫面
  if (isAudio) {
    const outExt = inExt === 'mp3' ? 'mp3' : inExt === 'wav' ? 'wav' : 'm4a'
    const codec =
      outExt === 'mp3'
        ? ['-c:a', 'libmp3lame', '-q:a', '2']
        : outExt === 'wav'
          ? ['-c:a', 'pcm_s16le']
          : ['-c:a', 'aac', '-b:a', '192k']
    return {
      inName,
      outExt,
      args: (i, o) => ['-ss', ss, '-i', i, '-t', dur, '-vn', ...codec, '-y', o],
    }
  }
  return {
    inName,
    outExt: 'mp4',
    // 單執行緒 WebAssembly 很慢：用 ultrafast 換取速度，以較低的 CRF 補畫質
    args: (i, o) => [
      '-ss',
      ss,
      '-i',
      i,
      '-t',
      dur,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      '-y',
      o,
    ],
  }
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
}

/** 從 ffmpeg 的 log 取出 time=00:00:03.52 */
export function parseLogTime(line: string): number | null {
  const m = /time=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export async function exportClip(opts: {
  file: File
  start: number
  end: number
  precise: boolean
  template: string
  signal: AbortSignal
  progress: (p: number | null) => void
  onLoaded?: () => void
}): Promise<{ blob: Blob; name: string }> {
  const { file, start, end, precise, signal, progress } = opts
  const abortErr = () => new DOMException('canceled', 'AbortError')
  if (signal.aborted) throw abortErr()
  progress(null)
  const onAbort = () => disposeFFmpeg()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const ff = await getFFmpeg()
    if (signal.aborted) throw abortErr()
    opts.onLoaded?.()
    const plan = clipPlan(file.name, start, end, precise)
    const outFile = `output.${plan.outExt}`
    const total = Math.max(0.1, end - start)
    const onLog = ({ message }: { message: string }) => {
      const tm = parseLogTime(message)
      if (tm !== null) progress(Math.min(0.99, tm / total))
    }
    ff.on('log', onLog)
    try {
      await ff.writeFile(plan.inName, new Uint8Array(await file.arrayBuffer()))
      if (signal.aborted) throw abortErr()
      progress(0)
      const code = await ff.exec(plan.args(plan.inName, outFile))
      if (signal.aborted) throw abortErr()
      if (code !== 0) throw new Error(`ffmpeg exited with ${code}`)
      const data = await ff.readFile(outFile)
      if (typeof data === 'string' || !data.byteLength) throw new Error('empty output')
      const blob = new Blob([data.slice()], {
        type: MIME[plan.outExt] ?? 'application/octet-stream',
      })
      const name = outputName(
        file.name,
        `clip_${fileTime(start)}-${fileTime(end)}`,
        plan.outExt,
        opts.template,
      )
      progress(1)
      return { blob, name }
    } finally {
      ff.off('log', onLog)
      // 清掉記憶體檔案系統裡的暫存
      if (instance === ff) {
        await ff.deleteFile(plan.inName).catch(() => {})
        await ff.deleteFile(outFile).catch(() => {})
      }
    }
  } catch (e) {
    if (signal.aborted) throw abortErr()
    throw e
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
