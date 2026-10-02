/**
 * 媒體引擎：監聽 <video> 事件回寫 store、載入目前曲目（含 HLS）、
 * rAF 時間更新、A–B 區間循環、記住進度、MediaSession、影格率估計、波形分析。
 */
import { useEffect } from 'react'
import type HlsType from 'hls.js'
import { toast } from '@/components/ui'
import { formatTime } from '@/lib/format'
import { t } from '@/i18n'
import { usePlayer, selectCurrent, type PlayItem } from './store'
import { consumeWantPlay, next, pause, play, poke, prev, seek, seekBy } from './actions'
import { applyEq, applyVolume } from './audio'
import { loopTarget } from './logic/ab'
import { diagnose, MEDIA_ERR } from './logic/formats'
import { loadProgress, resumePoint, saveProgressEntry } from './logic/progress'
import { estimateFrameDuration } from './logic/speed'
import { decodePeaks } from './logic/waveform'

const S = () => usePlayer.getState()

/** 這次工作階段已詢問過「要繼續嗎」的項目 */
const offered = new Set<string>()

function saveProgress(it: PlayItem | null | undefined, time: number, duration: number) {
  if (!it || !Number.isFinite(duration) || duration <= 0) return
  saveProgressEntry(it.key, time, duration)
}

function readBuffered(el: HTMLMediaElement): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < el.buffered.length; i++) out.push([el.buffered.start(i), el.buffered.end(i)])
  return out
}

function mediaDuration(el: HTMLMediaElement): number {
  if (Number.isFinite(el.duration)) return el.duration
  // 直播或尚未知道長度：用可跳轉範圍
  if (el.seekable.length) return el.seekable.end(el.seekable.length - 1)
  return 0
}

function setErrorFor(el: HTMLVideoElement, it: PlayItem, code: number | null, noVideo = false) {
  const d = diagnose({
    name: it.source === 'url' ? it.url : it.name,
    type: it.type,
    errorCode: code,
    canPlayType: (m) => el.canPlayType(m),
    isUrl: it.source === 'url',
    isHls: it.hls,
    noVideoTrack: noVideo,
  })
  S().updateItem(it.id, noVideo ? { noVideo: true, error: { ...d, reason: 'hevc' } } : { error: d })
}

/** 設定媒體來源（放在 hook 外，避免直接修改 hook 回傳值） */
function assignSrc(el: HTMLMediaElement, src: string) {
  el.src = src
}

function applyRate(el: HTMLMediaElement, rate: number) {
  el.playbackRate = rate
  el.defaultPlaybackRate = rate
}

function updatePositionState(el: HTMLMediaElement) {
  try {
    const d = mediaDuration(el)
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && d > 0) {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: el.playbackRate || 1,
        position: Math.min(d, Math.max(0, el.currentTime)),
      })
    }
  } catch {
    /* 部分瀏覽器在 duration 變動中會丟例外，忽略 */
  }
}

export function useMediaEngine() {
  const el = usePlayer((s) => s.el)
  const currentId = usePlayer((s) => s.currentId)
  const src = usePlayer((s) => selectCurrent(s)?.url)
  const isHls = usePlayer((s) => !!selectCurrent(s)?.hls)

  // ── 元素事件 ──
  useEffect(() => {
    if (!el) return
    const cur = () => selectCurrent(S())
    let fixingDuration = false
    const checkLoop = () => {
      const c = cur()
      if (!c) return
      const target = loopTarget(c.ab, el.currentTime, S().abLoop)
      if (target !== null) el.currentTime = target
    }
    const handlers: Record<string, () => void> = {
      loadedmetadata: () => {
        const c = cur()
        if (!c) return
        // MediaRecorder 產生的 WebM 常沒有長度（Infinity）：跳到極遠處讓瀏覽器算出長度，再回到開頭
        if (el.duration === Infinity && !c.hls) {
          fixingDuration = true
          el.currentTime = 1e101
          return
        }
        const d = mediaDuration(el)
        S().set({ duration: d, ready: true, buffered: readBuffered(el) })
        S().updateItem(c.id, {
          duration: d || undefined,
          width: el.videoWidth || undefined,
          height: el.videoHeight || undefined,
          error: null,
        })
        el.playbackRate = S().rate
        applyVolume(el, S().volume, S().muted)
        // 影片載入後沒有畫面：多半是瀏覽器無法解碼的 HEVC
        if (c.kind === 'video' && !el.videoWidth && el.readyState >= 1) {
          setTimeout(() => {
            const again = cur()
            if (again?.id === c.id && !el.videoWidth) setErrorFor(el, c, null, true)
          }, 600)
        }
        const restore = S().restore
        if (restore && restore.id === c.id) {
          el.currentTime = restore.t
          S().set({ restore: null, time: restore.t })
          if (restore.play) void play()
          return
        }
        if (offered.has(c.id)) return
        offered.add(c.id)
        const r = resumePoint(loadProgress(), c.key, d)
        if (r !== null) {
          const time = formatTime(r)
          toast(t('player.resume.title', { time }), {
            id: 'player-resume',
            description: t('player.resume.desc'),
            duration: 10_000,
            action: {
              label: t('player.resume.action'),
              onClick: () => {
                if (S().currentId !== c.id) return
                seek(r)
                void play()
              },
            },
          })
        }
      },
      durationchange: () => {
        if (fixingDuration && Number.isFinite(el.duration)) {
          fixingDuration = false
          el.currentTime = 0
          handlers.loadedmetadata()
          return
        }
        if (fixingDuration) return
        const d = mediaDuration(el)
        S().set({ duration: d })
        updatePositionState(el)
      },
      timeupdate: () => {
        if (fixingDuration) return
        // rAF 在背景分頁會暫停，這裡補上時間與區間循環
        if (document.hidden || el.paused) S().set({ time: el.currentTime })
        checkLoop()
      },
      seeking: () => {
        if (!fixingDuration) S().set({ time: el.currentTime })
      },
      seeked: () => {
        if (fixingDuration) return
        S().set({ time: el.currentTime, buffered: readBuffered(el) })
        updatePositionState(el)
      },
      play: () => {
        S().set({ paused: false })
        poke()
      },
      pause: () => {
        S().set({ paused: true, controlsVisible: true, holding2x: false })
        saveProgress(cur(), el.currentTime, mediaDuration(el))
      },
      waiting: () => S().set({ waiting: true }),
      playing: () => S().set({ waiting: false }),
      canplay: () => S().set({ waiting: false }),
      progress: () => S().set({ buffered: readBuffered(el) }),
      ratechange: () => {
        if (!S().holding2x) S().set({ rate: el.playbackRate })
        updatePositionState(el)
      },
      ended: () => {
        if (fixingDuration) return
        const c = cur()
        if (c) saveProgress(c, mediaDuration(el), mediaDuration(el))
        S().set({ paused: true, controlsVisible: true })
        const s = S()
        if (s.repeat === 'one') {
          seek(0)
          void play()
          return
        }
        if (s.autoNext || s.repeat === 'all') next('ended')
      },
      error: () => {
        const c = cur()
        if (!c || !el.error) return
        console.warn('media error', el.error.code, el.error.message)
        S().set({ waiting: false, paused: true })
        setErrorFor(el, c, el.error.code)
      },
      enterpictureinpicture: () => S().set({ pip: true }),
      leavepictureinpicture: () => S().set({ pip: false }),
    }
    for (const [k, fn] of Object.entries(handlers)) el.addEventListener(k, fn)
    return () => {
      for (const [k, fn] of Object.entries(handlers)) el.removeEventListener(k, fn)
    }
  }, [el])

  // ── 載入目前曲目 ──
  useEffect(() => {
    if (!el) return
    const it = currentId ? S().items.find((i) => i.id === currentId) : undefined
    if (!it || !src) {
      el.removeAttribute('src')
      el.load()
      return
    }
    let hls: HlsType | null = null
    let canceled = false
    const autoplay = consumeWantPlay()
    S().set({ waiting: false, paused: true, ready: false, buffered: [] })
    const start = () => {
      applyRate(el, S().rate)
      if (autoplay) void play()
    }
    if (isHls && !el.canPlayType('application/vnd.apple.mpegurl')) {
      import('hls.js')
        .then(({ default: Hls }) => {
          if (canceled) return
          if (!Hls.isSupported()) {
            toast.error(t('player.url.hlsUnsupported'))
            setErrorFor(el, it, MEDIA_ERR.srcNotSupported)
            return
          }
          hls = new Hls({ enableWorker: true })
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return
            console.warn('hls error', data.type, data.details)
            setErrorFor(el, it, MEDIA_ERR.network)
            hls?.destroy()
            hls = null
          })
          hls.loadSource(src)
          hls.attachMedia(el)
          start()
        })
        .catch((e) => {
          console.error(e)
          setErrorFor(el, it, MEDIA_ERR.network)
        })
    } else {
      assignSrc(el, src)
      start()
    }
    return () => {
      canceled = true
      // 這時元素仍是舊曲目：記下進度
      saveProgress(it, el.currentTime, mediaDuration(el))
      hls?.destroy()
      hls = null
    }
  }, [el, currentId, src, isHls])

  // ── rAF：平滑時間、A–B 循環、定期記住進度 ──
  useEffect(() => {
    if (!el) return
    let raf = 0
    let lastSave = performance.now()
    const tick = () => {
      const s = S()
      const tm = el.currentTime
      if (Math.abs(tm - s.time) > 0.004) s.set({ time: tm })
      const c = selectCurrent(s)
      if (c) {
        const target = loopTarget(c.ab, tm, s.abLoop)
        if (target !== null) el.currentTime = target
        if (performance.now() - lastSave > 5000) {
          lastSave = performance.now()
          saveProgress(c, tm, mediaDuration(el))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    const startLoop = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    const stopLoop = () => cancelAnimationFrame(raf)
    el.addEventListener('play', startLoop)
    el.addEventListener('pause', stopLoop)
    el.addEventListener('ended', stopLoop)
    if (!el.paused) startLoop()
    return () => {
      stopLoop()
      el.removeEventListener('play', startLoop)
      el.removeEventListener('pause', stopLoop)
      el.removeEventListener('ended', stopLoop)
    }
  }, [el])

  // ── 影格率估計（requestVideoFrameCallback） ──
  useEffect(() => {
    if (!el || !currentId || typeof el.requestVideoFrameCallback !== 'function') return
    let handle = 0
    let lastMedia = -1
    let lastFrames = -1
    const deltas: number[] = []
    const cb: VideoFrameRequestCallback = (_now, meta) => {
      if (lastFrames >= 0 && meta.presentedFrames === lastFrames + 1 && !el.seeking) {
        const d = meta.mediaTime - lastMedia
        if (d > 0) deltas.push(d)
      }
      lastMedia = meta.mediaTime
      lastFrames = meta.presentedFrames
      if (deltas.length >= 12 && deltas.length % 12 === 0) {
        S().updateItem(currentId, { frameDur: estimateFrameDuration(deltas.slice(-60)) })
      }
      if (deltas.length < 240) handle = el.requestVideoFrameCallback(cb)
    }
    handle = el.requestVideoFrameCallback(cb)
    return () => el.cancelVideoFrameCallback(handle)
  }, [el, currentId])

  // ── 音量與等化器 ──
  useEffect(() => {
    if (!el) return
    const apply = (s = S()) => {
      applyVolume(el, s.volume, s.muted)
      applyEq(s.eqEnabled, s.eqGains)
    }
    apply()
    return usePlayer.subscribe((s, p) => {
      if (
        s.volume !== p.volume ||
        s.muted !== p.muted ||
        s.eqEnabled !== p.eqEnabled ||
        s.eqGains !== p.eqGains
      )
        apply(s)
    })
  }, [el])

  // ── 全螢幕狀態 ──
  useEffect(() => {
    const onFs = () => {
      const stage = S().stageEl
      S().set({ fullscreen: !!stage && document.fullscreenElement === stage })
      poke()
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ── 離開頁面前記下進度 ──
  useEffect(() => {
    if (!el) return
    const onHide = () => saveProgress(selectCurrent(S()), el.currentTime, mediaDuration(el))
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [el])
}

/** MediaSession：系統媒體鍵與鎖定畫面資訊 */
export function useMediaSession() {
  const item = usePlayer(selectCurrent)
  const id = item?.id
  const title = item?.meta?.title || item?.name
  const artist = item?.meta?.artist
  const album = item?.meta?.album
  const cover = item?.meta?.coverUrl
  useEffect(() => {
    if (!('mediaSession' in navigator) || !id) return
    const ms = navigator.mediaSession
    try {
      ms.metadata = new MediaMetadata({
        title: title ?? '',
        artist: artist ?? 'JayAng Studio',
        album: album ?? '',
        artwork: cover ? [{ src: cover, sizes: '512x512' }] : [],
      })
    } catch (e) {
      console.error(e)
    }
    const set = (a: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(a, fn)
      } catch {
        /* 不支援的動作 */
      }
    }
    set('play', () => void play())
    set('pause', () => pause())
    set('previoustrack', () => prev())
    set('nexttrack', () => next('user'))
    set('seekbackward', (d) => seekBy(-(d.seekOffset ?? 10)))
    set('seekforward', (d) => seekBy(d.seekOffset ?? 10))
    set('seekto', (d) => {
      if (typeof d.seekTime === 'number') seek(d.seekTime, !!d.fastSeek)
    })
    return () => {
      ms.metadata = null
      for (const a of [
        'play',
        'pause',
        'previoustrack',
        'nexttrack',
        'seekbackward',
        'seekforward',
        'seekto',
      ] as const)
        set(a, null)
    }
  }, [id, title, artist, album, cover])
  const paused = usePlayer((s) => s.paused)
  useEffect(() => {
    if ('mediaSession' in navigator && id)
      navigator.mediaSession.playbackState = paused ? 'paused' : 'playing'
  }, [paused, id])
}

/** 波形上限：音訊 200 MB、影片 60 MB */
export const WAVEFORM_LIMIT = { audio: 200 * 1024 * 1024, video: 60 * 1024 * 1024 }

/** 背景分析目前曲目的波形 */
export function useWaveform() {
  const item = usePlayer(selectCurrent)
  const on = usePlayer((s) => s.waveformOn)
  const id = item?.id
  const file = item?.file
  const kind = item?.kind
  const errored = !!item?.error
  useEffect(() => {
    if (!on || !id || !file || !kind || errored) return
    if (S().peaks[id] !== undefined) return
    if (file.size > WAVEFORM_LIMIT[kind]) {
      S().set({ peaks: { ...S().peaks, [id]: 'large' } })
      return
    }
    const ac = new AbortController()
    S().set({ peaks: { ...S().peaks, [id]: 'busy' } })
    decodePeaks(file, 1200, ac.signal)
      .then((p) => {
        if (ac.signal.aborted) return
        S().set({ peaks: { ...S().peaks, [id]: p ?? 'error' } })
      })
      .catch((e) => {
        if (ac.signal.aborted) return
        // 無法解碼是預期內的結果（介面會顯示），其他錯誤才記錄
        if ((e as DOMException)?.name !== 'EncodingError') console.error(e)
        S().set({ peaks: { ...S().peaks, [id]: 'error' } })
      })
    return () => {
      ac.abort()
      const cur = S().peaks[id]
      if (cur === 'busy') {
        const peaks = { ...S().peaks }
        delete peaks[id]
        S().set({ peaks })
      }
    }
  }, [on, id, file, kind, errored])
}
