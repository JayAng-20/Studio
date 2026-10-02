/**
 * 不支援格式的診斷：依副檔名、MIME、MediaError.code 與 canPlayType 判斷原因與建議。
 * 回傳 i18n 鍵的片段（由介面組成文字），不直接產生使用者字串。
 */
import { splitExt } from '@/lib/filename'

export type UnsupportedReason =
  | 'mkv'
  | 'avi'
  | 'legacy'
  | 'hevc'
  | 'dolby'
  | 'apac'
  | 'audioCodec'
  | 'network'
  | 'hls'
  | 'decode'
  | 'unknown'

export interface Diagnosis {
  reason: UnsupportedReason
  /** 顯示用的格式名（例如 MKV、AVI、WMV） */
  format: string
  /** 建議（i18n 鍵的最後一段） */
  tips: Array<'convertMp4' | 'iphoneCompat' | 'otherDevice' | 'checkUrl' | 'remux' | 'audioConvert'>
  /** canPlayType 的檢查結果（MIME → '' | 'maybe' | 'probably'） */
  probe: Array<{ mime: string; result: string }>
}

/** MediaError 的代碼（不依賴執行環境的常數） */
export const MEDIA_ERR = { aborted: 1, network: 2, decode: 3, srcNotSupported: 4 } as const

const LEGACY_VIDEO = new Set([
  'wmv',
  'flv',
  'rmvb',
  'rm',
  'asf',
  'vob',
  'mpg',
  'mpeg',
  'ts',
  'mts',
  'm2ts',
  '3gp',
  'divx',
  'f4v',
])
const LEGACY_AUDIO = new Set([
  'wma',
  'ape',
  'ac3',
  'eac3',
  'dts',
  'amr',
  'mka',
  'aiff',
  'aif',
  'alac',
  'tta',
  'wv',
  'mid',
  'midi',
])

/** 依副檔名猜測要用 canPlayType 檢查的 MIME */
export function probeMimes(name: string, type: string): string[] {
  const { ext } = splitExt(name)
  const list = new Set<string>()
  if (type) list.add(type)
  const byExt: Record<string, string[]> = {
    mkv: ['video/x-matroska', 'video/webm; codecs="vp9,opus"'],
    avi: ['video/x-msvideo'],
    wmv: ['video/x-ms-wmv'],
    flv: ['video/x-flv'],
    mov: ['video/quicktime', 'video/mp4; codecs="hvc1"'],
    mp4: ['video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="hvc1"'],
    m4v: ['video/mp4; codecs="avc1.42E01E"'],
    webm: ['video/webm; codecs="vp9"'],
    ts: ['video/mp2t'],
    m3u8: ['application/vnd.apple.mpegurl'],
    flac: ['audio/flac'],
    ogg: ['audio/ogg; codecs="vorbis"'],
    opus: ['audio/ogg; codecs="opus"'],
    m4a: ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="ec-3"'],
    wma: ['audio/x-ms-wma'],
    ac3: ['audio/ac3'],
    aiff: ['audio/aiff'],
  }
  for (const m of byExt[ext] ?? []) list.add(m)
  return [...list]
}

export function diagnose(input: {
  name: string
  type: string
  errorCode: number | null
  canPlayType: (mime: string) => string
  isUrl?: boolean
  isHls?: boolean
  /** 載入後沒有畫面（videoWidth 為 0） */
  noVideoTrack?: boolean
}): Diagnosis {
  const { ext } = splitExt(input.name.split('?')[0])
  const probe = probeMimes(input.name, input.type).map((mime) => ({
    mime,
    result: safeCanPlay(input.canPlayType, mime),
  }))
  const base = { probe }
  if (input.isUrl && input.errorCode === MEDIA_ERR.network) {
    return {
      ...base,
      reason: input.isHls ? 'hls' : 'network',
      format: ext.toUpperCase(),
      tips: ['checkUrl'],
    }
  }
  if (input.isHls) return { ...base, reason: 'hls', format: 'HLS', tips: ['checkUrl'] }
  if (ext === 'mkv') return { ...base, reason: 'mkv', format: 'MKV', tips: ['remux', 'convertMp4'] }
  if (ext === 'avi') return { ...base, reason: 'avi', format: 'AVI', tips: ['convertMp4'] }
  if (LEGACY_VIDEO.has(ext))
    return { ...base, reason: 'legacy', format: ext.toUpperCase(), tips: ['convertMp4'] }
  if (LEGACY_AUDIO.has(ext)) {
    const dolby = ext === 'ac3' || ext === 'eac3'
    return {
      ...base,
      reason: dolby ? 'dolby' : 'audioCodec',
      format: ext.toUpperCase(),
      tips: ['audioConvert'],
    }
  }
  if (input.noVideoTrack || ext === 'mov' || ext === 'heic' || ext === 'hevc') {
    // iPhone 影片：HEVC 畫面、杜比視界或空間音訊（APAC）
    return {
      ...base,
      reason: 'hevc',
      format: ext.toUpperCase() || 'HEVC',
      tips: ['iphoneCompat', 'convertMp4', 'otherDevice'],
    }
  }
  if (ext === 'm4a' || ext === 'mp4' || ext === 'm4v') {
    return {
      ...base,
      reason: input.errorCode === MEDIA_ERR.decode ? 'decode' : 'apac',
      format: ext.toUpperCase(),
      tips: ['iphoneCompat', 'convertMp4', 'otherDevice'],
    }
  }
  if (input.errorCode === MEDIA_ERR.decode) {
    return { ...base, reason: 'decode', format: ext.toUpperCase(), tips: ['convertMp4'] }
  }
  return {
    ...base,
    reason: 'unknown',
    format: ext.toUpperCase(),
    tips: ['convertMp4', 'otherDevice'],
  }
}

function safeCanPlay(fn: (m: string) => string, mime: string): string {
  try {
    return fn(mime) || ''
  } catch {
    return ''
  }
}

/** 一看就知道瀏覽器大多不支援的副檔名（加入清單時先標示） */
export function likelyUnsupported(name: string): boolean {
  const { ext } = splitExt(name)
  return ext === 'avi' || LEGACY_VIDEO.has(ext) || LEGACY_AUDIO.has(ext)
}
