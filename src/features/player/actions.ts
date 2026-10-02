/**
 * 播放器的命令（給按鈕、快捷鍵、觸控、MediaSession 共用）。
 * 直接操作 store 裡的媒體元素；狀態由 engine 監聽元素事件回寫。
 */
import { toast } from '@/components/ui'
import { fileKind, fileKey, uid, UrlPool } from '@/lib/files'
import { formatTime } from '@/lib/format'
import { outputName, splitExt } from '@/lib/filename'
import { useRecents } from '@/stores/recents'
import { useSettings } from '@/stores/settings'
import { t } from '@/i18n'
import { timing } from '@/design/motion'
import { usePlayer, selectCurrent, frameOf, type PlayItem, type SubtitleTrack } from './store'
import { applyVolume, ensureGraph, webAudioSupported } from './audio'
import { setA, setB, emptyAB, isComplete } from './logic/ab'
import { decodeText, decodeWith, type TextEncodingName } from './logic/encoding'
import { parseSubtitle } from './logic/subtitles'
import { frameStep as calcFrameStep, formatSpeed, stepSpeed } from './logic/speed'
import { makeShuffleOrder, nextId, prevId, removeFromQueue, syncOrder } from './logic/playlist'
import { fileTime, formatPrecise } from './logic/timecode'
import { likelyUnsupported } from './logic/formats'
import { readId3 } from './logic/id3'

const S = () => usePlayer.getState()

/** 物件 URL 集中管理 */
export const urls = new UrlPool()

/** 切換曲目後是否自動播放 */
let wantPlay = false
export const consumeWantPlay = () => {
  const w = wantPlay
  wantPlay = false
  return w
}

// ───────────── 提示（OSD）、控制列顯示 ─────────────

let osdN = 0
export function osd(text: string, warn = false) {
  S().set({ osd: { text, warn, n: ++osdN } })
}

let idleTimer: ReturnType<typeof setTimeout> | undefined
/** 游標移動或互動：叫回控制列，播放中閒置 2.5 秒後淡出 */
export function poke() {
  const s = S()
  if (!s.controlsVisible) s.set({ controlsVisible: true })
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    const st = S()
    if (!st.paused && !st.menuOpen && !st.el?.ended) st.set({ controlsVisible: false })
  }, timing.controlsIdle)
}
export function hideControlsNow() {
  clearTimeout(idleTimer)
  const s = S()
  if (!s.paused) s.set({ controlsVisible: false })
}
export function stopIdleTimer() {
  clearTimeout(idleTimer)
}

// ───────────── 檔案與清單 ─────────────

const isSubtitle = (f: File) => /\.(srt|vtt)$/i.test(f.name)

function makeItem(file: File): PlayItem {
  const kind = fileKind(file) === 'audio' ? 'audio' : 'video'
  return {
    id: uid('pl'),
    name: file.name,
    kind,
    source: 'file',
    file,
    url: urls.create(file),
    key: fileKey(file),
    hls: false,
    size: file.size,
    type: file.type,
    suspect: likelyUnsupported(file.name),
    subtitles: [],
    activeSub: null,
    chapters: [],
    ab: emptyAB,
  }
}

/** 讀 ID3（標題、演出者、封面）；失敗不影響播放 */
async function loadMeta(item: PlayItem) {
  if (item.kind !== 'audio' || !item.file) return
  try {
    const tags = await readId3(item.file)
    if (!tags) return
    const coverUrl = tags.picture
      ? urls.create(new Blob([tags.picture.data.slice()], { type: tags.picture.mime }))
      : undefined
    if (!S().items.some((i) => i.id === item.id)) {
      if (coverUrl) urls.revoke(coverUrl)
      return
    }
    S().updateItem(item.id, {
      meta: { title: tags.title, artist: tags.artist, album: tags.album, coverUrl },
    })
  } catch (e) {
    console.error(e)
  }
}

/**
 * 加入檔案：媒體加進清單、字幕掛到目前（或這次加入的第一個）影片。
 * range：從其他模組帶來的 A–B 區間。
 */
export async function addFiles(
  files: File[],
  opts: { play?: boolean; range?: { start: number; end: number } } = {},
) {
  const media = files.filter((f) => {
    const k = fileKind(f)
    return k === 'video' || k === 'audio'
  })
  const subs = files.filter(isSubtitle)
  const others = files.filter((f) => !media.includes(f) && !subs.includes(f))
  if (others.length && !media.length && !subs.length) {
    toast.error(t('player.errors.noFiles'), { description: t('player.errors.noFilesDesc') })
    return
  }
  const newItems = media.map(makeItem)
  if (opts.range && newItems[0]) {
    newItems[0].ab = { a: opts.range.start, b: opts.range.end }
  }
  const s = S()
  if (newItems.length) {
    const items = [...s.items, ...newItems]
    const ids = items.map((i) => i.id)
    const first = !s.currentId
    const currentId = first ? newItems[0].id : s.currentId
    s.set({
      items,
      currentId,
      order: s.shuffle ? syncOrder(s.order, ids, currentId) : ids,
    })
    if (first) {
      wantPlay = opts.play ?? true
      s.set({ restore: null, ready: false })
    }
    newItems.forEach((it) => {
      useRecents.getState().visit('player', it.name)
      void loadMeta(it)
    })
    void probeDurations()
  }
  if (subs.length) {
    const target = S().currentId ?? newItems[0]?.id
    if (!target) {
      toast.error(t('player.subtitle.needMedia'))
      return
    }
    for (const f of subs) await loadSubtitle(f, target)
  }
}

export function addUrl(raw: string) {
  const url = raw.trim()
  const path = url.split(/[?#]/)[0]
  const hls = /\.m3u8$/i.test(path)
  const name = decodeURIComponent(path.split('/').filter(Boolean).pop() || url)
  const audio = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus)$/i.test(path)
  const item: PlayItem = {
    id: uid('pl'),
    name,
    kind: audio ? 'audio' : 'video',
    source: 'url',
    url,
    key: `url:${url}`,
    hls,
    type: hls ? 'application/vnd.apple.mpegurl' : '',
    subtitles: [],
    activeSub: null,
    chapters: [],
    ab: emptyAB,
  }
  const s = S()
  const items = [...s.items, item]
  const ids = items.map((i) => i.id)
  s.set({ items, order: s.shuffle ? syncOrder(s.order, ids, item.id) : ids })
  playItem(item.id)
}

export function playItem(id: string, autoplay = true) {
  const s = S()
  if (!s.items.some((i) => i.id === id)) return
  if (s.currentId === id) {
    seek(0)
    if (autoplay) void play()
    return
  }
  wantPlay = autoplay
  s.set({ currentId: id, restore: null, ready: false, time: 0, duration: 0, buffered: [] })
}

function releaseItem(it: PlayItem) {
  if (it.source === 'file') urls.revoke(it.url)
  if (it.meta?.coverUrl) urls.revoke(it.meta.coverUrl)
}

export function removeItem(id: string) {
  const s = S()
  const it = s.items.find((i) => i.id === id)
  if (!it) return
  const q = removeFromQueue(
    { ids: s.items.map((i) => i.id), order: s.order, currentId: s.currentId, shuffle: s.shuffle, repeat: s.repeat },
    id,
  )
  const wasCurrent = s.currentId === id
  if (wasCurrent) wantPlay = !s.paused
  const peaks = { ...s.peaks }
  delete peaks[id]
  s.set({
    items: s.items.filter((i) => i.id !== id),
    order: q.order,
    currentId: q.currentId,
    peaks,
    ...(wasCurrent ? { ready: false, time: 0, duration: 0, buffered: [], restore: null } : {}),
  })
  releaseItem(it)
}

export function clearAll() {
  const s = S()
  s.el?.pause()
  s.items.forEach(releaseItem)
  clearSnapshot()
  s.set({
    items: [],
    order: [],
    currentId: null,
    ready: false,
    time: 0,
    duration: 0,
    buffered: [],
    restore: null,
    peaks: {},
  })
}

export function reorder(ids: string[]) {
  const s = S()
  const map = new Map(s.items.map((i) => [i.id, i]))
  const items = ids.map((id) => map.get(id)).filter((x): x is PlayItem => !!x)
  s.set({ items, order: s.shuffle ? s.order : items.map((i) => i.id) })
}

const queue = () => {
  const s = S()
  return { ids: s.items.map((i) => i.id), order: s.order, currentId: s.currentId, shuffle: s.shuffle, repeat: s.repeat }
}

export function next(reason: 'ended' | 'user' = 'user') {
  const id = nextId(queue(), reason)
  if (!id) return false
  if (id === S().currentId) {
    seek(0)
    void play()
    return true
  }
  playItem(id, true)
  return true
}

export function prev() {
  const s = S()
  // 播放超過 3 秒時，「上一個」先回到開頭
  if (s.time > 3) {
    seek(0)
    return
  }
  const id = prevId(queue())
  if (id) playItem(id, true)
  else seek(0)
}

export function toggleShuffle() {
  const s = S()
  const on = !s.shuffle
  s.set({
    shuffle: on,
    order: on ? makeShuffleOrder(s.items.map((i) => i.id), s.currentId) : s.items.map((i) => i.id),
  })
  osd(t(on ? 'player.osd.shuffleOn' : 'player.osd.shuffleOff'))
}

export function cycleRepeat() {
  const s = S()
  const nextMode = s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off'
  s.set({ repeat: nextMode })
  osd(t(nextMode === 'one' ? 'player.osd.repeatOne' : nextMode === 'all' ? 'player.osd.repeatAll' : 'player.osd.repeatOff'))
}

// ───────────── 播放控制 ─────────────

let flashN = 0
function flash(kind: 'play' | 'pause') {
  S().set({ flash: { kind, n: ++flashN } })
}

/** 第一次播放時建立音訊圖（在使用者手勢內） */
function primeAudio() {
  const s = S()
  if (!s.el) return
  if (!webAudioSupported()) {
    if (s.webAudio) s.set({ webAudio: false })
    return
  }
  const g = ensureGraph(s.el)
  if (!g && s.webAudio) s.set({ webAudio: false })
  applyVolume(s.el, s.volume, s.muted)
}

/** 給等化器等需要音訊圖的功能（在使用者手勢內呼叫） */
export const ensureAudio = () => primeAudio()

// ───────────── 背景讀取清單項目的長度 ─────────────

let probing = false
function probeOne(item: PlayItem): Promise<{ d?: number; w?: number; h?: number }> {
  return new Promise((resolve) => {
    const m = document.createElement(item.kind === 'audio' ? 'audio' : 'video')
    let done = false
    const finish = (r: { d?: number; w?: number; h?: number }) => {
      if (done) return
      done = true
      clearTimeout(timer)
      m.removeAttribute('src')
      m.load()
      resolve(r)
    }
    const timer = setTimeout(() => finish({}), 8000)
    m.preload = 'metadata'
    m.muted = true
    let fixing = false
    const report = () => {
      const v = m as HTMLVideoElement
      finish({
        d: Number.isFinite(m.duration) ? m.duration : undefined,
        w: v.videoWidth || undefined,
        h: v.videoHeight || undefined,
      })
    }
    m.ondurationchange = () => {
      if (fixing && Number.isFinite(m.duration)) report()
    }
    m.onloadedmetadata = () => {
      const v = m as HTMLVideoElement
      // MediaRecorder 的 WebM 沒有長度：跳到極遠處讓瀏覽器算出來
      if (m.duration === Infinity) {
        fixing = true
        m.currentTime = 1e101
        return
      }
      finish({
        d: Number.isFinite(m.duration) ? m.duration : undefined,
        w: v.videoWidth || undefined,
        h: v.videoHeight || undefined,
      })
    }
    m.onerror = () => finish({})
    m.src = item.url
  })
}

export async function probeDurations() {
  if (probing) return
  probing = true
  try {
    for (;;) {
      const it = S().items.find((i) => i.source === 'file' && i.duration === undefined && !i.probed && i.id !== S().currentId)
      if (!it) break
      S().updateItem(it.id, { probed: true })
      const r = await probeOne(it)
      if (!S().items.some((i) => i.id === it.id)) continue
      S().updateItem(it.id, (cur) => ({
        duration: cur.duration ?? r.d,
        width: cur.width ?? r.w,
        height: cur.height ?? r.h,
      }))
    }
  } finally {
    probing = false
  }
}

export async function play() {
  const s = S()
  const el = s.el
  const cur = selectCurrent(s)
  if (!el || !cur || (cur.error && !cur.noVideo)) return
  primeAudio()
  try {
    await el.play()
  } catch (e) {
    // AbortError：被下一個指令中斷；NotSupportedError：由 error 事件顯示說明卡
    const name = (e as DOMException)?.name
    if (name !== 'AbortError' && name !== 'NotSupportedError') console.error(e)
  }
}

export function pause() {
  S().el?.pause()
}

export function togglePlay(showFlash = true) {
  const s = S()
  if (!s.el || !selectCurrent(s)) return
  if (s.el.paused || s.el.ended) {
    void play()
    if (showFlash) flash('play')
  } else {
    s.el.pause()
    if (showFlash) flash('pause')
  }
  poke()
}

export function seek(time: number, fast = false) {
  const el = S().el
  if (!el) return
  const d = Number.isFinite(el.duration) ? el.duration : S().duration
  const target = Math.max(0, Math.min(d || 0, time))
  if (fast && typeof el.fastSeek === 'function') el.fastSeek(target)
  else el.currentTime = target
  S().set({ time: target })
}

let rippleN = 0
let lastRipple = { side: '', at: 0, amount: 0 }
export function seekBy(delta: number, opts: { ripple?: boolean } = {}) {
  const el = S().el
  if (!el) return
  seek(el.currentTime + delta)
  poke()
  if (opts.ripple) {
    const side = delta < 0 ? 'left' : 'right'
    const now = performance.now()
    const amount =
      lastRipple.side === side && now - lastRipple.at < 800 ? lastRipple.amount + delta : delta
    lastRipple = { side, at: now, amount }
    S().set({ ripple: { side, amount, n: ++rippleN } })
  }
}

export function jumpPercent(p: number) {
  const s = S()
  if (!s.duration) return
  seek((s.duration * p) / 100)
  osd(t('player.osd.seekTo', { time: formatTime(s.duration * p / 100) }))
}

export function setVolume(v: number, showOsd = false) {
  const s = S()
  const volume = Math.max(0, Math.min(2, Math.round(v * 100) / 100))
  if (volume > 1 && s.el) primeAudio()
  const allowed = volume > 1 && !S().webAudio ? 1 : volume
  s.set({ volume: allowed, muted: allowed === 0 ? s.muted : false })
  if (s.el) applyVolume(s.el, allowed, allowed === 0 ? s.muted : false)
  if (showOsd) osd(t('player.osd.volume', { value: `${Math.round(allowed * 100)}%` }), allowed > 1)
}

export function stepVolume(d: number) {
  setVolume(S().volume + d, true)
}

export function toggleMute() {
  const s = S()
  const muted = !s.muted
  // 音量 0 時取消靜音：恢復到 50%
  if (!muted && s.volume === 0) s.set({ volume: 0.5 })
  s.set({ muted })
  if (s.el) applyVolume(s.el, S().volume, muted)
  osd(muted ? t('player.osd.muted') : t('player.osd.volume', { value: `${Math.round(S().volume * 100)}%` }))
}

export function setRate(r: number, showOsd = true) {
  const s = S()
  s.set({ rate: r })
  if (s.el) {
    s.el.playbackRate = r
    s.el.defaultPlaybackRate = r
  }
  if (showOsd) osd(t('player.osd.speed', { value: formatSpeed(r) }))
}

export function stepRate(dir: 1 | -1) {
  setRate(stepSpeed(S().rate, dir))
}

/** 長按 2 倍速 */
export function hold2x(on: boolean) {
  const s = S()
  if (!s.el) return
  if (on) {
    if (s.el.paused) return
    s.el.playbackRate = Math.max(2, s.rate)
    s.set({ holding2x: true })
  } else if (s.holding2x) {
    s.el.playbackRate = s.rate
    s.set({ holding2x: false })
  }
}

export function frameStep(dir: 1 | -1) {
  const s = S()
  const cur = selectCurrent(s)
  if (!s.el || !cur || cur.kind !== 'video') return
  s.el.pause()
  const f = frameOf(cur)
  seek(calcFrameStep(s.el.currentTime, f, dir, s.el.duration))
  osd(t('player.osd.frame', { dir: dir > 0 ? '+1' : '−1' }))
}

// ───────────── A–B 區間 ─────────────

export function setAPoint(time?: number) {
  const s = S()
  const cur = selectCurrent(s)
  if (!cur) return
  const tm = time ?? s.el?.currentTime ?? s.time
  const ab = setA(cur.ab, tm, s.duration)
  s.updateItem(cur.id, { ab })
  osd(t('player.osd.a', { time: formatPrecise(ab.a ?? 0) }))
}

export function setBPoint(time?: number) {
  const s = S()
  const cur = selectCurrent(s)
  if (!cur) return
  const tm = time ?? s.el?.currentTime ?? s.time
  const r = setB(cur.ab, tm, s.duration)
  if (r.warning) {
    osd(t(r.warning === 'bBeforeA' ? 'player.ab.bBeforeA' : 'player.ab.tooShort'), true)
    return
  }
  s.updateItem(cur.id, { ab: r.ab })
  osd(t('player.osd.b', { time: formatPrecise(r.ab.b ?? 0) }))
}

export function clearAB() {
  const s = S()
  const cur = selectCurrent(s)
  if (!cur) return
  s.updateItem(cur.id, { ab: emptyAB })
  osd(t('player.osd.abCleared'))
}

export function toggleABLoop() {
  const on = !S().abLoop
  S().set({ abLoop: on })
  osd(t(on ? 'player.osd.loopOn' : 'player.osd.loopOff'))
  const cur = selectCurrent(S())
  if (on && cur && isComplete(cur.ab)) {
    const tm = S().time
    if (tm < cur.ab.a || tm > cur.ab.b) seek(cur.ab.a)
  }
}

// ───────────── 全螢幕、子母畫面 ─────────────

interface WebkitVideo extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void
  webkitSupportsFullscreen?: boolean
}

export const canFullscreen = () =>
  (typeof document !== 'undefined' && !!document.fullscreenEnabled) ||
  typeof (S().el as WebkitVideo | null)?.webkitEnterFullscreen === 'function'

export async function toggleFullscreen() {
  const s = S()
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }
    if (document.fullscreenEnabled && s.stageEl) {
      await s.stageEl.requestFullscreen({ navigationUI: 'hide' })
      return
    }
    // iOS：退回原生全螢幕（使用系統控制列）
    const v = s.el as WebkitVideo | null
    if (v && typeof v.webkitEnterFullscreen === 'function') {
      v.webkitEnterFullscreen()
      return
    }
    toast.error(t('player.errors.fullscreenUnsupported'))
  } catch (e) {
    console.error(e)
    toast.error(t('player.errors.fullscreenFailed'))
  }
}

export const canPip = () =>
  typeof document !== 'undefined' &&
  'pictureInPictureEnabled' in document &&
  !!document.pictureInPictureEnabled

export async function togglePip() {
  const s = S()
  const cur = selectCurrent(s)
  if (!s.el || !cur || cur.kind !== 'video') return
  if (!canPip()) {
    toast.error(t('player.errors.pipUnsupported'))
    return
  }
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture()
    else await s.el.requestPictureInPicture()
  } catch (e) {
    console.error(e)
    toast.error(t('player.errors.pipFailed'))
  }
}

// ───────────── 截圖 ─────────────

let snapN = 0
export function clearSnapshot() {
  const s = S()
  if (s.snapshot) urls.revoke(s.snapshot.url)
  s.set({ snapshot: null })
}

export async function takeSnapshot() {
  const s = S()
  const cur = selectCurrent(s)
  const el = s.el
  if (!el || !cur) return
  if (cur.kind !== 'video' || cur.noVideo) {
    osd(t('player.osd.noVideo'), true)
    return
  }
  if (el.readyState < 2 || !el.videoWidth) {
    toast.error(t('player.snapshot.failed'), { description: t('player.snapshot.failedDesc') })
    return
  }
  const canvas = document.createElement('canvas')
  canvas.width = el.videoWidth
  canvas.height = el.videoHeight
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(el, 0, 0)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('toBlob failed')
    const time = el.currentTime
    const name = outputName(
      cur.name,
      `frame_${fileTime(time)}`,
      'png',
      useSettings.getState().filenamePattern,
    )
    clearSnapshot()
    S().set({ snapshot: { blob, url: urls.create(blob), time, name, n: ++snapN } })
  } catch (e) {
    console.error(e)
    toast.error(t('player.snapshot.failed'), { description: t('player.snapshot.failedDesc') })
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

// ───────────── 字幕 ─────────────

export async function loadSubtitle(file: File, itemId?: string) {
  const target = itemId ?? S().currentId
  if (!target) {
    toast.error(t('player.subtitle.needMedia'))
    return
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const dec = decodeText(bytes)
    const cues = parseSubtitle(dec.text, file.name)
    const track: SubtitleTrack = {
      id: uid('sub'),
      name: file.name,
      bytes,
      detected: dec.encoding,
      encoding: dec.encoding,
      cues,
    }
    S().updateItem(target, (it) => ({ subtitles: [...it.subtitles, track], activeSub: track.id }))
    S().set({ subsOn: true })
    if (!cues.length) {
      toast.error(t('player.subtitle.empty', { name: file.name }), {
        description: t('player.subtitle.emptyDesc'),
      })
    } else {
      toast.success(t('player.subtitle.loaded', { name: file.name, count: cues.length }), {
        description: dec.fallback
          ? t('player.subtitle.fallback', { enc: dec.encoding.toUpperCase() })
          : undefined,
      })
    }
  } catch (e) {
    console.error(e)
    toast.error(t('player.subtitle.empty', { name: file.name }), {
      description: t('player.subtitle.emptyDesc'),
    })
  }
}

export function setSubtitleEncoding(itemId: string, subId: string, enc: TextEncodingName) {
  S().updateItem(itemId, (it) => ({
    subtitles: it.subtitles.map((sub) => {
      if (sub.id !== subId) return sub
      const text = decodeWith(sub.bytes, enc) ?? ''
      return { ...sub, encoding: enc, cues: parseSubtitle(text, sub.name) }
    }),
  }))
}

export function removeSubtitle(itemId: string, subId: string) {
  S().updateItem(itemId, (it) => {
    const subtitles = it.subtitles.filter((s) => s.id !== subId)
    return {
      subtitles,
      activeSub: it.activeSub === subId ? (subtitles[subtitles.length - 1]?.id ?? null) : it.activeSub,
    }
  })
}

export function toggleSubs() {
  const s = S()
  const cur = selectCurrent(s)
  if (!cur?.subtitles.length) {
    osd(t('player.controls.noSubtitles'))
    s.set({ tab: 'subtitles' })
    return
  }
  s.set({ subsOn: !s.subsOn })
}

export function stepSubDelay(d: number) {
  const v = Math.round((S().subDelay + d) * 10) / 10
  S().set({ subDelay: v })
  osd(t('player.osd.subDelay', { value: v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1) }))
}

// ───────────── 章節 ─────────────

export function addChapter() {
  const s = S()
  const cur = selectCurrent(s)
  if (!cur) return
  const tm = s.el?.currentTime ?? s.time
  S().updateItem(cur.id, (it) => {
    const chapters = [...it.chapters, { id: uid('ch'), t: tm, name: '' }].sort((a, b) => a.t - b.t)
    return { chapters }
  })
}

/** 下載檔名的主檔名（給匯出用） */
export const baseName = (it: PlayItem) => splitExt(it.name).base
