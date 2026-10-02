/**
 * 錄影引擎：擷取來源、混音、鏡頭泡泡合成、MediaRecorder、計時與標記。
 *
 * 狀態放在模組層級的 zustand store（不是元件 state），
 * 所以在 App 內切換到其他工具時錄影不會中斷，回來時 HUD 與狀態都還在。
 * MediaStream、AudioContext 等不可序列化的資源放在 session 變數裡。
 */
import { create } from 'zustand'
import { toast } from '@/components/ui'
import { t } from '@/i18n'
import { formatBytes } from '@/lib/format'
import { uid } from '@/lib/files'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import {
  addMarker,
  audioBitrate,
  baseMime,
  clampMarkers,
  classifyMediaError,
  COUNTDOWN_SECONDS,
  createStopwatch,
  extensionFor,
  needsDurationFix,
  recordingName,
  removeMarker,
  SIZE_LIMIT_BYTES,
  sizeLevel,
  videoBitrate,
  type AvailableFormat,
  type BubblePrefs,
  type Marker,
  type MediaErrorKind,
  type RecorderPrefs,
  type SizeLevel,
  type SourceMode,
  type Stopwatch,
} from './core'
import { libraryAvailable, useLibrary, type LibraryMeta } from './library'
import { createCompositor, type Compositor } from './compositor'

export type Stage = 'setup' | 'acquiring' | 'countdown' | 'recording' | 'finalizing' | 'result'

export interface RecordingResult {
  id: string
  name: string
  blob: Blob
  mime: string
  /** 秒 */
  duration: number
  width: number
  height: number
  markers: Marker[]
  thumb: Blob | null
  createdAt: number
  mode: SourceMode
  /** 已存進錄影庫的 id */
  libraryId: string | null
  saving: boolean
  downloaded: boolean
  edited?: 'trim' | 'mp4'
  /** 編輯前的原始錄影（可還原） */
  original: RecordingResult | null
}

export interface LiveInfo {
  mode: SourceMode
  width: number
  height: number
  fps: number
  mime: string
  videoBps: number
  hasMic: boolean
  hasSystemAudio: boolean
  bubble: boolean
}

interface EngineState {
  stage: Stage
  countdown: number
  paused: boolean
  /** 毫秒 */
  elapsed: number
  bytes: number
  sizeLevel: SizeLevel
  markers: Marker[]
  micMuted: boolean
  live: LiveInfo | null
  /** 每次換新的預覽來源時 +1，讓元件重新綁定 srcObject */
  previewVersion: number
  result: RecordingResult | null
  error: MediaErrorKind | 'recorder' | 'empty' | null
  /** 最近一次按「加入標記」的回饋（n 遞增；at 為 null 表示太接近既有標記） */
  markerFlash: { n: number; at: number | null } | null
}

const initial: EngineState = {
  stage: 'setup',
  countdown: 0,
  paused: false,
  elapsed: 0,
  bytes: 0,
  sizeLevel: 'ok',
  markers: [],
  micMuted: false,
  live: null,
  previewVersion: 0,
  result: null,
  error: null,
  markerFlash: null,
}

export const useRecorder = create<EngineState>(() => ({ ...initial }))
const setState = useRecorder.setState
const getState = useRecorder.getState

/* ===================== Session ===================== */

interface Session {
  prefs: RecorderPrefs
  format: AvailableFormat
  ctx: AudioContext | null
  streams: MediaStream[]
  sourceTrack: MediaStreamTrack
  sourceVideo: HTMLVideoElement
  compositor: Compositor | null
  preview: MediaStream
  output: MediaStream
  recorder: MediaRecorder | null
  chunks: Blob[]
  bytes: number
  stopwatch: Stopwatch
  ticker: Worker | null
  fallbackTimer: ReturnType<typeof setInterval> | undefined
  micGain: GainNode | null
  micAnalyser: AnalyserNode | null
  sysAnalyser: AnalyserNode | null
  thumb: Blob | null
  thumbPending: boolean
  warned: boolean
  stopping: boolean
  finalized: boolean
  stopReason: 'user' | 'ended' | 'limit' | 'error'
  countdownEndsAt: number
  lastUi: number
  createdAt: number
}

let session: Session | null = null

const stopStream = (s: MediaStream) =>
  s.getTracks().forEach((tr) => {
    try {
      tr.stop()
    } catch {
      /* 忽略 */
    }
  })

function dispose(s: Session) {
  s.ticker?.postMessage({ type: 'stop' })
  s.ticker?.terminate()
  s.ticker = null
  if (s.fallbackTimer) clearInterval(s.fallbackTimer)
  s.compositor?.dispose()
  s.compositor = null
  s.streams.forEach(stopStream)
  stopStream(s.output)
  s.sourceVideo.pause()
  s.sourceVideo.srcObject = null
  s.ctx?.close().catch(() => {})
  s.ctx = null
  s.micGain = null
  s.micAnalyser = null
  s.sysAnalyser = null
}

/* ===================== 取得來源 ===================== */

function displayOptions(prefs: RecorderPrefs): DisplayMediaStreamOptions {
  const video: MediaTrackConstraints & { displaySurface?: string } = {
    frameRate: { ideal: prefs.fps, max: prefs.fps },
    displaySurface: 'monitor',
  }
  const audio: MediaTrackConstraints | false = prefs.systemAudio
    ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // 錄分頁時讓使用者仍聽得到分頁聲音
        suppressLocalAudioPlayback: false,
      } as MediaTrackConstraints
    : false
  // 下列為 Chromium 的選擇器提示，其他瀏覽器會忽略
  return {
    video,
    audio,
    systemAudio: prefs.systemAudio ? 'include' : 'exclude',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'include',
  } as DisplayMediaStreamOptions
}

function cameraConstraints(
  deviceId: string,
  ideal: { width: number; height: number; fps: number },
): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: ideal.width },
    height: { ideal: ideal.height },
    frameRate: { ideal: ideal.fps },
  }
}

export function micConstraints(deviceId: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
}

/** getUserMedia：指定的裝置不見了就退回系統預設裝置 */
export async function getUserMediaWithFallback(
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints)
  } catch (e) {
    const name = (e as { name?: string })?.name
    if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw e
    const strip = (c: boolean | MediaTrackConstraints | undefined) => {
      if (!c || typeof c === 'boolean') return c
      const { deviceId: _d, ...rest } = c
      return rest
    }
    return navigator.mediaDevices.getUserMedia({
      video: strip(constraints.video),
      audio: strip(constraints.audio),
    })
  }
}

/** 給使用者看的錯誤訊息（說明發生什麼事＋可以怎麼辦） */
export function mediaErrorMessage(kind: MediaErrorKind, device: 'screen' | 'mic' | 'camera') {
  switch (kind) {
    case 'canceled':
      return t('recorder.errors.canceled')
    case 'systemDenied':
      return t('recorder.errors.systemDenied')
    case 'denied':
      return device === 'mic'
        ? t('recorder.errors.micDenied')
        : device === 'camera'
          ? t('recorder.errors.cameraDenied')
          : t('recorder.errors.screenDenied')
    case 'notFound':
      return device === 'mic' ? t('recorder.errors.micNotFound') : t('recorder.errors.cameraNotFound')
    case 'inUse':
      return t('recorder.errors.inUse')
    case 'unsupported':
      return t('recorder.errors.unsupported')
    default:
      return t('recorder.errors.generic')
  }
}

function waitForVideo(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (v.readyState >= 2) return resolve()
    const done = () => {
      v.removeEventListener('loadeddata', done)
      resolve()
    }
    v.addEventListener('loadeddata', done)
    setTimeout(done, 1500)
  })
}

/**
 * 開始流程：取得來源（瀏覽器選擇器）→ 建立混音與合成 → 倒數或直接開始。
 * 必須在使用者點擊的事件處理中呼叫（AudioContext 與擷取權限需要使用者手勢）。
 */
export async function beginRecording(prefs: RecorderPrefs, format: AvailableFormat) {
  const st = getState().stage
  if (st !== 'setup' && st !== 'result') return
  // 在等待任何 Promise 之前同步建立 AudioContext，才不會被自動播放政策擋下
  let ctx: AudioContext | null = null
  try {
    ctx = new AudioContext()
  } catch (e) {
    console.error(e)
  }
  setState({ stage: 'acquiring', error: null })
  const acquired: MediaStream[] = []
  const fail = () => {
    acquired.forEach(stopStream)
    ctx?.close().catch(() => {})
  }

  // 1. 主來源
  let source: MediaStream
  try {
    if (prefs.mode === 'screen') {
      source = await navigator.mediaDevices.getDisplayMedia(displayOptions(prefs))
    } else {
      const size = prefs.quality === 'standard' ? { width: 1280, height: 720 } : { width: 1920, height: 1080 }
      source = await getUserMediaWithFallback({
        video: cameraConstraints(prefs.cameraDeviceId, { ...size, fps: prefs.fps }),
        audio: false,
      })
    }
    acquired.push(source)
  } catch (e) {
    fail()
    const kind = classifyMediaError(e, prefs.mode === 'screen' ? 'display' : 'user')
    if (kind === 'canceled') {
      setState({ stage: getState().result ? 'result' : 'setup' })
      toast(mediaErrorMessage(kind, 'screen'))
    } else {
      console.error(e)
      setState({ stage: 'setup', error: kind })
    }
    return
  }
  const sourceTrack = source.getVideoTracks()[0]
  if (!sourceTrack) {
    fail()
    setState({ stage: 'setup', error: 'generic' })
    return
  }

  // 2. 麥克風（失敗不擋錄影，只提示）
  let mic: MediaStream | null = null
  if (prefs.mic) {
    try {
      mic = await getUserMediaWithFallback({ audio: micConstraints(prefs.micDeviceId), video: false })
      acquired.push(mic)
    } catch (e) {
      console.error(e)
      toast.warning(t('recorder.warn.micSkipped'), {
        description: mediaErrorMessage(classifyMediaError(e, 'user'), 'mic'),
      })
    }
  }

  // 3. 鏡頭泡泡
  let cam: MediaStream | null = null
  if (prefs.mode === 'screen' && prefs.camera) {
    try {
      cam = await getUserMediaWithFallback({
        video: cameraConstraints(prefs.cameraDeviceId, { width: 1280, height: 720, fps: 30 }),
        audio: false,
      })
      acquired.push(cam)
    } catch (e) {
      console.error(e)
      toast.warning(t('recorder.warn.cameraSkipped'), {
        description: mediaErrorMessage(classifyMediaError(e, 'user'), 'camera'),
      })
    }
  }

  // 使用者可能在選擇器開著時離開或取消
  if (getState().stage !== 'acquiring') {
    fail()
    return
  }

  // 來源影片（縮圖與合成的備援來源）
  const sourceVideo = document.createElement('video')
  sourceVideo.muted = true
  sourceVideo.playsInline = true
  sourceVideo.srcObject = new MediaStream([sourceTrack])
  sourceVideo.play().catch(() => {})
  await waitForVideo(sourceVideo)

  const settings = sourceTrack.getSettings()
  const width = settings.width || sourceVideo.videoWidth || 1920
  const height = settings.height || sourceVideo.videoHeight || 1080

  // 4. 影像輸出：有鏡頭泡泡時以 canvas 合成
  let compositor: Compositor | null = null
  let videoTrack: MediaStreamTrack = sourceTrack
  const camTrack = cam?.getVideoTracks()[0]
  if (camTrack) {
    try {
      compositor = createCompositor({
        screen: sourceTrack,
        screenVideo: sourceVideo,
        camera: camTrack,
        width,
        height,
        fps: prefs.fps,
        bubble: { ...prefs.bubble },
      })
      videoTrack = compositor.track
    } catch (e) {
      console.error(e)
      compositor = null
      toast.warning(t('recorder.warn.cameraSkipped'))
    }
  }

  // 5. 混音：系統音訊＋麥克風 → 一條音軌
  const sysTrack = source.getAudioTracks()[0] ?? null
  const micTrack = mic?.getAudioTracks()[0] ?? null
  let audioTracks: MediaStreamTrack[] = []
  let micGain: GainNode | null = null
  let micAnalyser: AnalyserNode | null = null
  let sysAnalyser: AnalyserNode | null = null
  if (ctx && (sysTrack || micTrack)) {
    try {
      const dest = ctx.createMediaStreamDestination()
      if (sysTrack) {
        const src = ctx.createMediaStreamSource(new MediaStream([sysTrack]))
        sysAnalyser = ctx.createAnalyser()
        sysAnalyser.fftSize = 512
        src.connect(dest)
        src.connect(sysAnalyser)
      }
      if (micTrack) {
        const src = ctx.createMediaStreamSource(new MediaStream([micTrack]))
        micGain = ctx.createGain()
        micAnalyser = ctx.createAnalyser()
        micAnalyser.fftSize = 512
        src.connect(micGain)
        micGain.connect(dest)
        micGain.connect(micAnalyser)
      }
      await ctx.resume().catch(() => {})
      audioTracks = dest.stream.getAudioTracks()
    } catch (e) {
      console.error(e)
      audioTracks = [sysTrack ?? micTrack].filter((x): x is MediaStreamTrack => !!x)
    }
  } else {
    audioTracks = [sysTrack ?? micTrack].filter((x): x is MediaStreamTrack => !!x)
  }

  const output = new MediaStream([videoTrack, ...audioTracks])
  const preview = new MediaStream([videoTrack])
  const videoBps = videoBitrate(prefs.quality, prefs.fps, { width, height })

  const s: Session = {
    prefs,
    format,
    ctx,
    streams: acquired,
    sourceTrack,
    sourceVideo,
    compositor,
    preview,
    output,
    recorder: null,
    chunks: [],
    bytes: 0,
    stopwatch: createStopwatch(() => performance.now()),
    ticker: null,
    fallbackTimer: undefined,
    micGain,
    micAnalyser,
    sysAnalyser,
    thumb: null,
    thumbPending: false,
    warned: false,
    stopping: false,
    finalized: false,
    stopReason: 'user',
    countdownEndsAt: 0,
    lastUi: 0,
    createdAt: Date.now(),
  }

  try {
    s.recorder = new MediaRecorder(output, {
      mimeType: format.mime,
      videoBitsPerSecond: videoBps,
      ...(audioTracks.length ? { audioBitsPerSecond: audioBitrate(prefs.quality) } : {}),
    })
  } catch (e) {
    console.error(e)
    dispose(s)
    setState({ stage: 'setup', error: 'recorder' })
    return
  }

  session = s
  // 使用者按瀏覽器的「停止分享」或關掉鏡頭：直接完成錄影
  sourceTrack.addEventListener('ended', () => {
    if (session !== s) return
    if (getState().stage === 'countdown') cancelCountdown()
    else stopRecording('ended')
  })

  if (prefs.systemAudio && prefs.mode === 'screen' && !sysTrack) {
    toast.info(t('recorder.warn.systemAudioMissing'))
  }

  setState((p) => ({
    live: {
      mode: prefs.mode,
      width,
      height,
      fps: Math.round(settings.frameRate || prefs.fps),
      mime: format.mime,
      videoBps,
      hasMic: !!micTrack,
      hasSystemAudio: !!sysTrack,
      bubble: !!compositor,
    },
    previewVersion: p.previewVersion + 1,
    micMuted: false,
    markers: [],
    markerFlash: null,
    elapsed: 0,
    bytes: 0,
    sizeLevel: 'ok',
    paused: false,
  }))

  startTicker(s, compositor ? 1000 / prefs.fps : 100)

  if (prefs.countdown) {
    s.countdownEndsAt = performance.now() + COUNTDOWN_SECONDS * 1000
    setState({ stage: 'countdown', countdown: COUNTDOWN_SECONDS })
  } else {
    startNow()
  }
}

function startTicker(s: Session, interval: number) {
  try {
    const w = new Worker(new URL('../../workers/recorder-ticker.ts', import.meta.url), {
      type: 'module',
    })
    w.onmessage = () => {
      try {
        tick(s)
      } finally {
        w.postMessage({ type: 'ack' })
      }
    }
    w.onerror = (e) => {
      console.error(e)
      w.terminate()
      s.ticker = null
      s.fallbackTimer = setInterval(() => tick(s), interval)
    }
    w.postMessage({ type: 'start', interval })
    s.ticker = w
  } catch (e) {
    console.error(e)
    s.fallbackTimer = setInterval(() => tick(s), interval)
  }
}

function tick(s: Session) {
  if (session !== s || s.finalized) return
  s.compositor?.draw()
  const now = performance.now()
  const stage = getState().stage
  if (stage === 'countdown') {
    const left = Math.ceil((s.countdownEndsAt - now) / 1000)
    if (left <= 0) startNow()
    else if (left !== getState().countdown) setState({ countdown: left })
    return
  }
  if (stage !== 'recording') return
  if (now - s.lastUi >= 100) {
    s.lastUi = now
    setState({ elapsed: s.stopwatch.elapsed(), bytes: s.bytes })
  }
  if (!s.thumb && !s.thumbPending && s.stopwatch.elapsed() >= 1000) void captureThumb(s)
}

/** 倒數結束（或略過倒數）：開始錄製 */
export function startNow() {
  const s = session
  if (!s || !s.recorder) return
  const st = getState().stage
  if (st !== 'countdown' && st !== 'acquiring') return
  const rec = s.recorder
  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return
    s.chunks.push(e.data)
    s.bytes += e.data.size
    checkSize(s)
  }
  rec.onstop = () => void finalize(s)
  rec.onerror = (e) => {
    console.error(e)
    s.stopReason = 'error'
    stopRecording('error')
  }
  try {
    // timeslice 約 1 秒：分段蒐集，中途出錯也保得住已錄的內容
    rec.start(1000)
  } catch (e) {
    console.error(e)
    dispose(s)
    session = null
    setState({ stage: 'setup', error: 'recorder', live: null })
    return
  }
  s.stopwatch.start()
  setState({ stage: 'recording', countdown: 0, elapsed: 0, bytes: 0, paused: false })
}

function checkSize(s: Session) {
  const level = sizeLevel(s.bytes)
  if (level !== getState().sizeLevel) setState({ sizeLevel: level })
  if (level === 'warn' && !s.warned) {
    s.warned = true
    toast.warning(t('recorder.warn.sizeTitle', { size: formatBytes(s.bytes) }), {
      description: t('recorder.warn.sizeDesc', { limit: formatBytes(SIZE_LIMIT_BYTES) }),
      duration: 12_000,
      action: { label: t('recorder.warn.stopNow'), onClick: () => stopRecording('user') },
    })
  }
  if (level === 'limit') stopRecording('limit')
}

async function captureThumb(s: Session) {
  s.thumbPending = true
  try {
    const src: CanvasImageSource | null = s.compositor
      ? s.compositor.canvas
      : s.sourceVideo.readyState >= 2
        ? s.sourceVideo
        : null
    const w = s.compositor ? s.compositor.canvas.width : s.sourceVideo.videoWidth
    const h = s.compositor ? s.compositor.canvas.height : s.sourceVideo.videoHeight
    if (!src || !w || !h) return
    const tw = 480
    const th = Math.max(1, Math.round((h / w) * tw))
    const c = document.createElement('canvas')
    c.width = tw
    c.height = th
    const g = c.getContext('2d')
    if (!g) return
    g.drawImage(src, 0, 0, tw, th)
    s.thumb = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.82))
    c.width = 0
    c.height = 0
  } catch (e) {
    console.error(e)
  } finally {
    s.thumbPending = false
  }
}

/* ===================== 控制 ===================== */

export function cancelCountdown() {
  const s = session
  const st = getState().stage
  if (st !== 'countdown' && st !== 'acquiring') return
  if (s) {
    dispose(s)
    session = null
  }
  setState({ stage: getState().result ? 'result' : 'setup', countdown: 0, live: null })
}

export function togglePause() {
  const s = session
  const rec = s?.recorder
  if (!s || !rec || getState().stage !== 'recording') return
  try {
    if (rec.state === 'recording') {
      rec.pause()
      s.stopwatch.pause()
      setState({ paused: true, elapsed: s.stopwatch.elapsed() })
    } else if (rec.state === 'paused') {
      rec.resume()
      s.stopwatch.resume()
      setState({ paused: false })
    }
  } catch (e) {
    console.error(e)
  }
}

export function toggleMute() {
  const s = session
  if (!s?.micGain || !s.ctx) return
  const muted = !getState().micMuted
  s.micGain.gain.setTargetAtTime(muted ? 0 : 1, s.ctx.currentTime, 0.015)
  setState({ micMuted: muted })
}

/** 在目前錄影時間加入標記；回傳加入的時間（秒），太接近既有標記時回傳 null */
export function addMarkerNow(): number | null {
  const s = session
  if (!s || getState().stage !== 'recording') return null
  const tSec = s.stopwatch.elapsed() / 1000
  const before = getState().markers
  const next = addMarker(before, tSec, uid('mk'))
  const n = (getState().markerFlash?.n ?? 0) + 1
  if (next === before) {
    setState({ markerFlash: { n, at: null } })
    return null
  }
  const at = Math.round(tSec * 10) / 10
  setState({ markers: next, markerFlash: { n, at } })
  return at
}

export function stopRecording(reason: Session['stopReason'] = 'user') {
  const s = session
  if (!s || s.stopping) return
  const st = getState().stage
  if (st === 'countdown' || st === 'acquiring') {
    cancelCountdown()
    return
  }
  if (st !== 'recording') return
  s.stopping = true
  if (s.stopReason !== 'error') s.stopReason = reason
  s.stopwatch.pause()
  setState({ stage: 'finalizing', elapsed: s.stopwatch.elapsed() })
  const rec = s.recorder
  if (rec && rec.state !== 'inactive') {
    try {
      rec.stop()
      return
    } catch (e) {
      console.error(e)
    }
  }
  void finalize(s)
}

/** 鏡頭泡泡：即時更新位置、大小、鏡像 */
export function setLiveBubble(b: BubblePrefs) {
  session?.compositor?.setBubble(b)
}

export function getPreviewStream(): MediaStream | null {
  return session?.preview ?? null
}

export function getAnalysers() {
  return { mic: session?.micAnalyser ?? null, system: session?.sysAnalyser ?? null }
}

/* ===================== 完成 ===================== */

async function finalize(s: Session) {
  if (s.finalized) return
  s.finalized = true
  const durationMs = s.stopwatch.elapsed()
  if (!s.thumb) await captureThumb(s)
  const recordedMime = s.recorder?.mimeType || s.format.mime
  const type = baseMime(recordedMime) || 'video/webm'
  let blob: Blob = new Blob(s.chunks, { type })
  s.chunks = []
  const info = getState().live
  const markers = getState().markers
  dispose(s)
  if (session === s) session = null

  if (!blob.size) {
    setState({ stage: 'setup', error: 'empty', live: null })
    return
  }
  // WebM 缺少時間長度：補上後進度條才能拖曳
  if (needsDurationFix(type)) {
    try {
      const { default: fixWebmDuration } = await import('fix-webm-duration')
      blob = await fixWebmDuration(blob, durationMs, { logger: false })
    } catch (e) {
      console.error(e)
    }
  }
  const createdAt = s.createdAt
  const prefix =
    s.prefs.mode === 'camera' ? t('recorder.file.cameraPrefix') : t('recorder.file.prefix')
  const duration = durationMs / 1000
  const result: RecordingResult = {
    id: uid('rec'),
    name: recordingName(prefix, new Date(createdAt), extensionFor(type)),
    blob,
    mime: recordedMime,
    duration,
    width: info?.width ?? 0,
    height: info?.height ?? 0,
    markers: clampMarkers(markers, duration),
    thumb: s.thumb,
    createdAt,
    mode: s.prefs.mode,
    libraryId: null,
    saving: false,
    downloaded: false,
    original: null,
  }
  setState({ stage: 'result', result, live: null, paused: false })

  if (s.stopReason === 'ended') toast.info(t('recorder.warn.sourceEnded'))
  else if (s.stopReason === 'limit')
    toast.warning(t('recorder.warn.limitReached', { size: formatBytes(SIZE_LIMIT_BYTES) }))
  else if (s.stopReason === 'error') toast.warning(t('recorder.warn.recorderError'))

  if (useSettings.getState().recorderLibrary && libraryAvailable()) void saveResultToLibrary()
}

/* ===================== 結果 ===================== */

export function toLibraryMeta(r: RecordingResult, id: string): LibraryMeta {
  return {
    id,
    name: r.name,
    mime: r.mime,
    size: r.blob.size,
    duration: r.duration,
    width: r.width,
    height: r.height,
    createdAt: r.createdAt,
    markers: r.markers,
    thumb: r.thumb,
    mode: r.mode,
    edited: r.edited,
  }
}

export async function saveResultToLibrary(): Promise<boolean> {
  const r = getState().result
  if (!r || r.libraryId || r.saving) return !!r?.libraryId
  const id = r.id
  updateResult({ saving: true })
  try {
    await useLibrary.getState().add(toLibraryMeta(r, id), r.blob)
    if (getState().result?.id === id) updateResult({ saving: false, libraryId: id })
    return true
  } catch (e) {
    console.error(e)
    if (getState().result?.id === id) updateResult({ saving: false })
    toast.error(t('recorder.result.saveFailed'))
    return false
  }
}

export function updateResult(patch: Partial<RecordingResult>) {
  const r = getState().result
  if (!r) return
  setState({ result: { ...r, ...patch } })
}

/** 用編輯後的檔案取代目前結果（保留原始錄影以便還原） */
export function replaceResult(next: {
  blob: Blob
  name: string
  mime: string
  duration: number
  markers: Marker[]
  edited: 'trim' | 'mp4'
}) {
  const r = getState().result
  if (!r) return
  const original = r.original ?? r
  setState({
    result: {
      ...r,
      ...next,
      id: uid('rec'),
      createdAt: Date.now(),
      libraryId: null,
      saving: false,
      downloaded: false,
      original,
    },
  })
  if (useSettings.getState().recorderLibrary && libraryAvailable()) void saveResultToLibrary()
}

export function revertResult() {
  const r = getState().result
  if (!r?.original) return
  setState({ result: r.original })
}

export function removeResultMarker(id: string) {
  const r = getState().result
  if (!r) return
  updateResult({ markers: removeMarker(r.markers, id) })
}

export function addResultMarker(tSec: number): boolean {
  const r = getState().result
  if (!r) return false
  const next = addMarker(r.markers, tSec, uid('mk'))
  if (next === r.markers) return false
  updateResult({ markers: next })
  return true
}

/** 從錄影庫開啟 */
export function openFromLibrary(meta: LibraryMeta, blob: Blob) {
  const st = getState().stage
  if (st !== 'setup' && st !== 'result') return
  setState({
    stage: 'result',
    error: null,
    result: {
      id: meta.id,
      name: meta.name,
      blob,
      mime: meta.mime,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      markers: meta.markers ?? [],
      thumb: meta.thumb,
      createdAt: meta.createdAt,
      mode: meta.mode,
      libraryId: meta.id,
      saving: false,
      downloaded: false,
      edited: meta.edited,
      original: null,
    },
  })
}

/** 回到準備畫面（錄影庫的內容不受影響） */
export function resetToSetup() {
  const st = getState().stage
  if (st !== 'result' && st !== 'setup') return
  setState({ stage: 'setup', result: null, error: null, markers: [] })
}

export const clearError = () => setState({ error: null })

/** 結果是否還沒保存（沒下載也沒存進錄影庫） */
export const isResultUnsaved = (r: RecordingResult | null) =>
  !!r && !r.libraryId && !r.downloaded && !r.saving

/* ===================== 離開頁面保護 ===================== */

/** 在 useUi().unsavedReasons 裡使用的 key（外殼依此決定是否載入全域 HUD） */
export const UNSAVED_KEY = 'recorder'

export const isCapturing = (stage: Stage) =>
  stage === 'acquiring' || stage === 'countdown' || stage === 'recording' || stage === 'finalizing'

/** 錄製中、或有還沒下載也沒存進錄影庫的錄影時登記；不依賴錄影頁是否掛載 */
let unsavedOn = false
useRecorder.subscribe((s) => {
  const on = isCapturing(s.stage) || isResultUnsaved(s.result)
  if (on === unsavedOn) return
  unsavedOn = on
  useUi.getState().markUnsaved(UNSAVED_KEY, on)
})
