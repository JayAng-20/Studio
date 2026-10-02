/**
 * 螢幕錄影的純函式（不碰 DOM，可在 node 環境測試）：
 * 格式清單、位元率對應、計時格式、碼錶、標記、容量門檻、偏好設定解析、檔名。
 */

/* ===================== 格式 ===================== */

export type FormatId = 'mp4' | 'webm-vp9' | 'webm-vp8' | 'webm-av1'

export interface FormatDef {
  id: FormatId
  container: 'mp4' | 'webm'
  /** 依偏好排序的候選 MIME；第一個被支援的會被採用 */
  candidates: string[]
}

export const FORMAT_DEFS: FormatDef[] = [
  {
    id: 'mp4',
    container: 'mp4',
    candidates: [
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
    ],
  },
  {
    id: 'webm-vp9',
    container: 'webm',
    candidates: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9'],
  },
  {
    id: 'webm-vp8',
    container: 'webm',
    candidates: ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'],
  },
  {
    id: 'webm-av1',
    container: 'webm',
    candidates: ['video/webm;codecs=av01,opus', 'video/webm;codecs=av1,opus', 'video/webm;codecs=av01'],
  },
]

export interface AvailableFormat {
  id: FormatId
  container: 'mp4' | 'webm'
  mime: string
  /** MP4 是否確定為 H.264（相容性最好） */
  h264: boolean
}

/** 依 isTypeSupported 動態列出可用格式（每種格式取第一個被支援的 MIME） */
export function listFormats(isSupported: (mime: string) => boolean): AvailableFormat[] {
  const out: AvailableFormat[] = []
  for (const def of FORMAT_DEFS) {
    const mime = def.candidates.find((m) => {
      try {
        return isSupported(m)
      } catch {
        return false
      }
    })
    if (mime) out.push({ id: def.id, container: def.container, mime, h264: /avc1/.test(mime) })
  }
  return out
}

/**
 * 預設格式：確定是 H.264 的 MP4（分享最方便）→ VP9 → VP8 → 一般 MP4 → AV1。
 * 若使用者偏好的格式仍可用，就沿用。
 */
export function pickFormat(
  available: AvailableFormat[],
  preferred?: FormatId | null,
): AvailableFormat | null {
  if (!available.length) return null
  if (preferred) {
    const hit = available.find((f) => f.id === preferred)
    if (hit) return hit
  }
  const by = (pred: (f: AvailableFormat) => boolean) => available.find(pred)
  return (
    by((f) => f.id === 'mp4' && f.h264) ??
    by((f) => f.id === 'webm-vp9') ??
    by((f) => f.id === 'webm-vp8') ??
    by((f) => f.id === 'mp4') ??
    available[0]
  )
}

/** "video/webm;codecs=vp9,opus" → "video/webm" */
export const baseMime = (mime: string) => mime.split(';')[0].trim().toLowerCase()

/** 由 MIME 判斷副檔名 */
export function extensionFor(mime: string): 'mp4' | 'webm' {
  const b = baseMime(mime)
  return b === 'video/mp4' || b === 'audio/mp4' ? 'mp4' : 'webm'
}

/** WebM 的 MediaRecorder 輸出缺少時間長度，需要修正 */
export const needsDurationFix = (mime: string) => extensionFor(mime) === 'webm'

/* ===================== 位元率 ===================== */

export type Quality = 'standard' | 'high' | 'ultra'
export type Fps = 30 | 60

/** 1080p 30 fps 的基準視訊位元率（bps） */
export const BASE_VIDEO_BITRATE: Record<Quality, number> = {
  standard: 4_000_000,
  high: 8_000_000,
  ultra: 16_000_000,
}

export const AUDIO_BITRATE: Record<Quality, number> = {
  standard: 128_000,
  high: 160_000,
  ultra: 192_000,
}

const REF_PIXELS = 1920 * 1080

/**
 * 視訊位元率：以 1080p30 為基準，依解析度（像素數的 0.75 次方，介於 0.35 到 3 倍）
 * 與影格率（60 fps 乘 1.5）調整，最後取整到 0.1 Mbps。
 */
export function videoBitrate(
  quality: Quality,
  fps: number,
  size?: { width: number; height: number } | null,
): number {
  const base = BASE_VIDEO_BITRATE[quality]
  const px = size && size.width > 0 && size.height > 0 ? size.width * size.height : REF_PIXELS
  const resFactor = Math.min(3, Math.max(0.35, Math.pow(px / REF_PIXELS, 0.75)))
  const fpsFactor = fps >= 50 ? 1.5 : 1
  return Math.round((base * resFactor * fpsFactor) / 100_000) * 100_000
}

export const audioBitrate = (quality: Quality) => AUDIO_BITRATE[quality]

/** 每分鐘約略大小（位元組） */
export function estimateBytesPerMinute(videoBps: number, audioBps: number): number {
  return ((videoBps + audioBps) / 8) * 60
}

/** 4_000_000 → "4 Mbps"；8_500_000 → "8.5 Mbps" */
export function formatBitrate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1).replace(/\.0$/, '')} Mbps`
  return `${Math.round(bps / 1000)} kbps`
}

/* ===================== 計時 ===================== */

/** 開始前倒數秒數 */
export const COUNTDOWN_SECONDS = 3

/** 錄影計時：毫秒 → "00:12.4"；超過一小時 "1:02:03.4" */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const totalTenths = Math.floor(ms / 100 + 1e-6)
  const tenths = totalTenths % 10
  const total = Math.floor(totalTenths / 10)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}.${tenths}` : `${mm}:${ss}.${tenths}`
}

/** 長度顯示：秒 → "1:05"、"1:02:03"（無十分位） */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  // 與瀏覽器播放器一致：無條件捨去
  const total = Math.floor(sec + 1e-6)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

export interface Stopwatch {
  start(): void
  pause(): void
  resume(): void
  /** 已錄製的毫秒數（不含暫停的時間） */
  elapsed(): number
  readonly state: 'idle' | 'running' | 'paused'
}

/** 碼錶：暫停期間不計時 */
export function createStopwatch(now: () => number): Stopwatch {
  let state: Stopwatch['state'] = 'idle'
  let startedAt = 0
  let accumulated = 0
  return {
    get state() {
      return state
    },
    start() {
      accumulated = 0
      startedAt = now()
      state = 'running'
    },
    pause() {
      if (state !== 'running') return
      accumulated += now() - startedAt
      state = 'paused'
    },
    resume() {
      if (state !== 'paused') return
      startedAt = now()
      state = 'running'
    },
    elapsed() {
      if (state === 'running') return accumulated + (now() - startedAt)
      return accumulated
    },
  }
}

/* ===================== 標記 ===================== */

export interface Marker {
  id: string
  /** 錄影時間（秒） */
  t: number
}

/** 兩個標記至少相隔的秒數（避免連按產生重複標記） */
export const MARKER_MIN_GAP = 0.5

/** 加入標記：依時間排序；與既有標記太接近時不加入（回傳原陣列） */
export function addMarker(list: Marker[], t: number, id: string): Marker[] {
  if (!Number.isFinite(t) || t < 0) return list
  const time = Math.round(t * 10) / 10
  if (list.some((m) => Math.abs(m.t - time) < MARKER_MIN_GAP)) return list
  return [...list, { id, t: time }].sort((a, b) => a.t - b.t)
}

export const removeMarker = (list: Marker[], id: string) => list.filter((m) => m.id !== id)

/** 裁切後的標記：只保留區間內的，時間減去起點 */
export function trimMarkers(list: Marker[], start: number, end: number): Marker[] {
  return list
    .filter((m) => m.t >= start - 1e-6 && m.t <= end + 1e-6)
    .map((m) => ({ ...m, t: Math.round((m.t - start) * 10) / 10 }))
}

/** 把標記限制在影片長度內（實際長度可能比計時略短） */
export function clampMarkers(list: Marker[], duration: number): Marker[] {
  if (!(duration > 0)) return list
  return list.map((m) => (m.t > duration ? { ...m, t: Math.round(duration * 10) / 10 } : m))
}

/** 標記在時間軸上的位置（0 到 1） */
export const markerFraction = (t: number, duration: number) =>
  duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0

/** 找出目前時間之後的下一個／之前的上一個標記 */
export function adjacentMarker(
  list: Marker[],
  current: number,
  dir: 1 | -1,
  tolerance = 0.25,
): Marker | null {
  if (dir === 1) return list.find((m) => m.t > current + tolerance) ?? null
  for (let i = list.length - 1; i >= 0; i--) if (list[i].t < current - tolerance) return list[i]
  return null
}

/** 標記清單轉成可複製的文字（每行「00:12.4 標記 1」） */
export function markersToText(list: Marker[], label: (index: number) => string): string {
  return list.map((m, i) => `${formatClock(m.t * 1000)} ${label(i + 1)}`).join('\n')
}

/* ===================== 容量 ===================== */

const GB = 1024 * 1024 * 1024
/** 累積到這個大小先警告 */
export const SIZE_WARN_BYTES = 1.5 * GB
/** 到這個大小自動停止，避免記憶體不足讓分頁崩潰 */
export const SIZE_LIMIT_BYTES = 1.9 * GB

export type SizeLevel = 'ok' | 'warn' | 'limit'

export function sizeLevel(bytes: number): SizeLevel {
  if (bytes >= SIZE_LIMIT_BYTES) return 'limit'
  if (bytes >= SIZE_WARN_BYTES) return 'warn'
  return 'ok'
}

/* ===================== 音量 ===================== */

/** 取樣 → 0 到 1 的音量（RMS 換算 dBFS，-60 dB 以下視為 0） */
export function levelFromSamples(samples: ArrayLike<number>): number {
  const n = samples.length
  if (!n) return 0
  let sum = 0
  for (let i = 0; i < n; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / n)
  if (rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  return Math.min(1, Math.max(0, (db + 60) / 60))
}

/* ===================== 偏好設定 ===================== */

export type SourceMode = 'screen' | 'camera'

export interface BubblePrefs {
  /** 圓心位置（0 到 1，相對畫面） */
  x: number
  y: number
  /** 直徑占畫面短邊的比例 */
  size: number
  mirror: boolean
}

export interface RecorderPrefs {
  mode: SourceMode
  systemAudio: boolean
  mic: boolean
  micDeviceId: string
  camera: boolean
  cameraDeviceId: string
  bubble: BubblePrefs
  fps: Fps
  quality: Quality
  format: FormatId | null
  countdown: boolean
}

export const BUBBLE_MIN = 0.12
export const BUBBLE_MAX = 0.45

export const DEFAULT_PREFS: RecorderPrefs = {
  mode: 'screen',
  systemAudio: true,
  mic: false,
  micDeviceId: '',
  camera: false,
  cameraDeviceId: '',
  bubble: { x: 0.86, y: 0.8, size: 0.24, mirror: true },
  fps: 30,
  quality: 'high',
  format: null,
  countdown: true,
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 解析 localStorage 內容：型別不對的欄位一律用預設值 */
export function parsePrefs(raw: unknown): RecorderPrefs {
  const d = DEFAULT_PREFS
  if (!isObj(raw)) return { ...d, bubble: { ...d.bubble } }
  const bool = (k: string, fb: boolean) => (typeof raw[k] === 'boolean' ? (raw[k] as boolean) : fb)
  const str = (k: string, fb: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : fb)
  const b = isObj(raw.bubble) ? raw.bubble : {}
  const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb)
  const formatIds = FORMAT_DEFS.map((f) => f.id) as string[]
  return {
    mode: raw.mode === 'camera' ? 'camera' : 'screen',
    systemAudio: bool('systemAudio', d.systemAudio),
    mic: bool('mic', d.mic),
    micDeviceId: str('micDeviceId', d.micDeviceId),
    camera: bool('camera', d.camera),
    cameraDeviceId: str('cameraDeviceId', d.cameraDeviceId),
    bubble: {
      x: clamp01(num(b.x, d.bubble.x)),
      y: clamp01(num(b.y, d.bubble.y)),
      size: Math.min(BUBBLE_MAX, Math.max(BUBBLE_MIN, num(b.size, d.bubble.size))),
      mirror: typeof b.mirror === 'boolean' ? b.mirror : d.bubble.mirror,
    },
    fps: raw.fps === 60 ? 60 : 30,
    quality: raw.quality === 'standard' || raw.quality === 'ultra' ? raw.quality : 'high',
    format:
      typeof raw.format === 'string' && formatIds.includes(raw.format)
        ? (raw.format as FormatId)
        : null,
    countdown: bool('countdown', d.countdown),
  }
}

/**
 * 把泡泡圓心限制在畫面內（整個圓都看得到）。
 * aspect = 寬 / 高；size 是直徑占短邊的比例。
 */
export function clampBubble(b: BubblePrefs, aspect: number): BubblePrefs {
  const a = aspect > 0 ? aspect : 16 / 9
  const short = Math.min(a, 1)
  // 以高為 1、寬為 a 的座標系計算半徑
  const r = (b.size * short) / 2
  const rx = r / a
  const ry = r
  const size = Math.min(BUBBLE_MAX, Math.max(BUBBLE_MIN, b.size))
  return {
    ...b,
    size,
    x: Math.min(1 - rx, Math.max(rx, b.x)),
    y: Math.min(1 - ry, Math.max(ry, b.y)),
  }
}

/* ===================== 檔名 ===================== */

const pad = (n: number) => String(n).padStart(2, '0')

/** 「螢幕錄影 2026-10-02 14.03.12.webm」（時間用點分隔，避免某些系統不允許冒號） */
export function recordingName(prefix: string, date: Date, ext: string): string {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const t = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
  return `${prefix} ${d} ${t}.${ext}`
}

/* ===================== 裁切範圍 ===================== */

/** 正規化裁切範圍：排序、限制在 0 到長度之間、最短 0.5 秒 */
export function normalizeRange(
  range: [number, number],
  duration: number,
  minLen = 0.5,
): [number, number] {
  let [a, b] = range[0] <= range[1] ? range : [range[1], range[0]]
  a = Math.max(0, Math.min(duration, a))
  b = Math.max(0, Math.min(duration, b))
  if (b - a < minLen) {
    b = Math.min(duration, a + minLen)
    a = Math.max(0, b - minLen)
  }
  return [Math.round(a * 10) / 10, Math.round(b * 10) / 10]
}

/** 範圍是否等於整段（不需要裁切） */
export const isFullRange = (range: [number, number], duration: number) =>
  range[0] <= 0.05 && range[1] >= duration - 0.05

/* ===================== 音量條（頻帶） ===================== */

/**
 * 把 AnalyserNode 的頻率資料（0 到 255）分成 bars 個對數間距的頻帶，
 * 每個頻帶取平均後正規化成 0 到 1。只取人聲與常見聲音的範圍（前 70% 的 bin）。
 */
export function bandLevels(freq: ArrayLike<number>, bars: number): number[] {
  const out = new Array<number>(Math.max(0, bars)).fill(0)
  const usable = Math.max(1, Math.floor(freq.length * 0.7))
  if (!freq.length || bars <= 0) return out
  for (let i = 0; i < bars; i++) {
    const a = Math.floor(Math.pow(usable, i / bars))
    const b = Math.max(a + 1, Math.floor(Math.pow(usable, (i + 1) / bars)))
    let sum = 0
    let n = 0
    for (let k = a; k < Math.min(b, usable); k++) {
      sum += freq[k]
      n++
    }
    out[i] = n ? Math.min(1, sum / n / 255) : 0
  }
  return out
}

/* ===================== 錯誤分類 ===================== */

export type MediaErrorKind =
  | 'canceled'
  | 'denied'
  | 'systemDenied'
  | 'notFound'
  | 'inUse'
  | 'unsupported'
  | 'generic'

/**
 * 把 getDisplayMedia／getUserMedia 的例外轉成可以給使用者看的類別。
 * 螢幕擷取時，使用者在選擇器按「取消」也是 NotAllowedError，要和系統層級的拒絕分開。
 */
export function classifyMediaError(e: unknown, kind: 'display' | 'user'): MediaErrorKind {
  const name = (e as { name?: unknown })?.name
  const message = String((e as { message?: unknown })?.message ?? '')
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      if (kind === 'display') return /system/i.test(message) ? 'systemDenied' : 'canceled'
      return /system/i.test(message) ? 'systemDenied' : 'denied'
    case 'AbortError':
      return kind === 'display' ? 'canceled' : 'inUse'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'notFound'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'inUse'
    case 'NotSupportedError':
    case 'TypeError':
      return 'unsupported'
    default:
      return 'generic'
  }
}
