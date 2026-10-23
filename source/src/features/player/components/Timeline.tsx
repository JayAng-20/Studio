import { AnimatePresence, motion, useMotionValue, useSpring } from 'motion/react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as RPointerEvent,
} from 'react'
import { duration as dur, sec, spring } from '@/design/motion'
import { clamp, formatTime } from '@/lib/format'
import { useIsMobile } from '@/lib/useMedia'
import { useT } from '@/i18n'
import { usePlayer, useCurrent, type PlayItem } from '../store'
import { play, poke, seek, seekBy } from '../actions'
import { dragHandle, isComplete } from '../logic/ab'
import { formatPrecise } from '../logic/timecode'

const S = () => usePlayer.getState()
const THUMB_W = 160
const THUMB_H = 90

/** hover 時間軸的縮圖預覽：另一個隱藏的 <video> 依序 seek 後畫到 canvas */
function useThumbnails(
  item: PlayItem | null,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const st = useRef<{
    v: HTMLVideoElement | null
    busy: boolean
    pending: number | null
    url: string | null
    ready: boolean
  }>({
    v: null,
    busy: false,
    pending: null,
    url: null,
    ready: false,
  })
  const enabled = !!item && item.kind === 'video' && item.source === 'file' && !item.error
  const url = enabled ? item.url : null
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const s = st.current
    return () => {
      if (s.v) {
        s.v.removeAttribute('src')
        s.v.load()
      }
      s.v = null
      s.url = null
      s.busy = false
      s.pending = null
      s.ready = false
    }
  }, [url])

  const request = useCallback(
    (time: number) => {
      if (!url) return
      const s = st.current
      if (!s.v || s.url !== url) {
        const v = document.createElement('video')
        v.muted = true
        v.preload = 'auto'
        v.playsInline = true
        v.src = url
        s.v = v
        s.url = url
        s.busy = false
        v.addEventListener('seeked', () => {
          const c = canvasRef.current
          const ctx = c?.getContext('2d')
          if (c && ctx && v.videoWidth) {
            const r = Math.min(THUMB_W / v.videoWidth, THUMB_H / v.videoHeight)
            const w = v.videoWidth * r
            const h = v.videoHeight * r
            ctx.clearRect(0, 0, c.width, c.height)
            ctx.drawImage(v, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h)
            if (!s.ready) {
              s.ready = true
              setReady(true)
            }
          }
          s.busy = false
          if (s.pending !== null) {
            const p = s.pending
            s.pending = null
            s.busy = true
            v.currentTime = p
          }
        })
        v.addEventListener('error', () => {
          s.busy = false
        })
      }
      if (s.busy) {
        s.pending = time
        return
      }
      s.busy = true
      s.v.currentTime = time
    },
    [url, canvasRef],
  )
  return { request, enabled, ready: enabled && ready }
}

/** 波形（取代細軌道）：已播放部分用強調色 */
function WaveCanvas({
  peaks,
  progress,
  ab,
}: {
  peaks: Float32Array
  progress: number
  ab: { a: number; b: number } | null
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const w = c.clientWidth
    const h = c.clientHeight
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr)
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const css = getComputedStyle(c)
    const accent = css.getPropertyValue('--accent').trim() || '#5aa2ff'
    const accent2 = css.getPropertyValue('--accent-2').trim() || accent
    const base = css.getPropertyValue('--stage-track').trim() || 'rgba(255,255,255,.22)'
    const bar = 2
    const gap = 1
    const n = Math.max(1, Math.floor(w / (bar + gap)))
    const grad = ctx.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, accent2)
    grad.addColorStop(1, accent)
    for (let i = 0; i < n; i++) {
      const p = peaks[Math.floor((i / n) * peaks.length)] ?? 0
      const bh = Math.max(2, p * (h - 2))
      const x = i * (bar + gap)
      const played = x / w <= progress
      ctx.fillStyle = played ? grad : base
      ctx.fillRect(x, (h - bh) / 2, bar, bh)
    }
    if (ab) {
      ctx.fillStyle = 'rgba(255,255,255,.08)'
      ctx.fillRect(ab.a * w, 0, (ab.b - ab.a) * w, h)
    }
  }, [peaks, progress, ab])
  return <canvas ref={ref} aria-hidden className="absolute inset-0 size-full" />
}

export function Timeline() {
  const t = useT()
  const item = useCurrent()
  const duration = usePlayer((s) => s.duration)
  const time = usePlayer((s) => s.time)
  const buffered = usePlayer((s) => s.buffered)
  const peaksRaw = usePlayer((s) => (s.currentId ? s.peaks[s.currentId] : undefined))
  const waveformOn = usePlayer((s) => s.waveformOn)
  // 手機畫面較矮：維持細軌道，不顯示波形
  const isMobile = useIsMobile()
  const peaks = waveformOn && !isMobile && peaksRaw instanceof Float32Array ? peaksRaw : null

  const rootRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [active, setActive] = useState<null | 'seek' | 'a' | 'b'>(null)
  const [dragT, setDragT] = useState<number | null>(null)
  const drag = useRef<{ wasPlaying: boolean; pending: number | null }>({
    wasPlaying: false,
    pending: null,
  })
  const bubbleX = useMotionValue(0)
  const bubbleSpring = useSpring(bubbleX, spring.snappy)
  const thumbCanvas = useRef<HTMLCanvasElement>(null)
  const thumbs = useThumbnails(item, thumbCanvas)

  const d = duration || 0
  const shown = dragT ?? time
  const p = d ? clamp(shown / d, 0, 1) : 0
  const ab = item?.ab
  const abFull = ab && isComplete(ab) && d ? { a: ab.a / d, b: ab.b / d } : null
  const chapters = item?.chapters ?? []

  const locate = (clientX: number) => {
    const r = rootRef.current!.getBoundingClientRect()
    const ratio = clamp((clientX - r.left) / r.width, 0, 1)
    return { ratio, time: ratio * d, px: ratio * r.width, w: r.width }
  }

  const moveBubble = (px: number, w: number) => {
    const half = (thumbs.enabled ? THUMB_W : 72) / 2 + 4
    bubbleX.set(clamp(px, Math.min(half, w / 2), Math.max(w - half, w / 2)))
  }

  /** 拖曳時節流 seek：前一次 seek 完成才送下一個，畫面才會即時更新 */
  const scrubTo = useCallback((tm: number) => {
    const el = S().el
    if (!el) return
    if (el.seeking) {
      drag.current.pending = tm
      return
    }
    seek(tm, true)
  }, [])

  useEffect(() => {
    const el = usePlayer.getState().el
    if (!el || !active) return
    const onSeeked = () => {
      const pnd = drag.current.pending
      if (pnd !== null) {
        drag.current.pending = null
        seek(pnd, true)
      }
    }
    el.addEventListener('seeked', onSeeked)
    return () => el.removeEventListener('seeked', onSeeked)
  }, [active])

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!d || e.button > 0) return
    rootRef.current?.setPointerCapture(e.pointerId)
    const el = S().el
    drag.current.wasPlaying = !!el && !el.paused
    if (drag.current.wasPlaying) el?.pause()
    const loc = locate(e.clientX)
    setActive('seek')
    setDragT(loc.time)
    setHover(loc.time)
    moveBubble(loc.px, loc.w)
    scrubTo(loc.time)
    thumbs.request(loc.time)
    poke()
  }

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!d) return
    const loc = locate(e.clientX)
    if (active === 'seek') {
      setDragT(loc.time)
      scrubTo(loc.time)
    } else if (active === 'a' || active === 'b') {
      if (item) S().updateItem(item.id, { ab: dragHandle(item.ab, active, loc.time, d) })
    }
    if (e.pointerType === 'mouse' || active) {
      setHover(loc.time)
      moveBubble(loc.px, loc.w)
      thumbs.request(loc.time)
    }
    poke()
  }

  const end = (e: RPointerEvent<HTMLDivElement>) => {
    if (!active) return
    if (rootRef.current?.hasPointerCapture(e.pointerId))
      rootRef.current.releasePointerCapture(e.pointerId)
    if (active === 'seek') {
      const loc = locate(e.clientX)
      drag.current.pending = null
      seek(loc.time)
      if (drag.current.wasPlaying) void play()
    }
    setActive(null)
    setDragT(null)
    if (e.pointerType !== 'mouse') setHover(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 5
    const map: Record<string, () => void> = {
      ArrowLeft: () => seekBy(-step, { ripple: true }),
      ArrowRight: () => seekBy(step, { ripple: true }),
      ArrowDown: () => seekBy(-step, { ripple: true }),
      ArrowUp: () => seekBy(step, { ripple: true }),
      PageDown: () => seekBy(-d / 10),
      PageUp: () => seekBy(d / 10),
      Home: () => seek(0),
      End: () => seek(d),
    }
    const fn = map[e.key]
    if (fn) {
      e.preventDefault()
      e.stopPropagation()
      fn()
    }
  }

  const startHandleDrag = (which: 'a' | 'b') => (e: RPointerEvent<HTMLElement>) => {
    e.stopPropagation()
    if (e.button > 0) return
    rootRef.current?.setPointerCapture(e.pointerId)
    setActive(which)
  }

  const handleKey = (which: 'a' | 'b') => (e: KeyboardEvent<HTMLElement>) => {
    if (!item) return
    const cur = which === 'a' ? item.ab.a : item.ab.b
    if (cur === null) return
    const step = e.shiftKey ? 1 : 0.1
    const delta =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? -step
        : e.key === 'ArrowRight' || e.key === 'ArrowUp'
          ? step
          : 0
    if (!delta) return
    e.preventDefault()
    e.stopPropagation()
    S().updateItem(item.id, { ab: dragHandle(item.ab, which, cur + delta, d) })
  }

  const hoverChapter =
    hover !== null ? [...chapters].reverse().find((c) => c.t <= hover + 0.001) : undefined
  const showBubble = hover !== null && d > 0
  const tall = !!peaks

  return (
    <div className="relative">
      {/* hover 浮標（彈簧跟隨） */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute bottom-full left-0 z-10 mb-2.5 w-0"
        style={{ x: bubbleSpring }}
      >
        <motion.div
          className="stage-glass absolute bottom-0 flex -translate-x-1/2 flex-col items-center gap-1 rounded-md p-1"
          initial={false}
          animate={{
            opacity: showBubble ? 1 : 0,
            scale: showBubble ? 1 : 0.92,
            y: showBubble ? 0 : 4,
          }}
          transition={{ ...spring.snappy, opacity: { duration: sec(dur.fast) } }}
        >
          {thumbs.enabled && (
            <canvas
              ref={thumbCanvas}
              width={THUMB_W}
              height={THUMB_H}
              className="block rounded-sm bg-[var(--stage-bg)]"
              style={{ width: THUMB_W, height: THUMB_H, opacity: thumbs.ready ? 1 : 0.3 }}
            />
          )}
          <span className="px-1.5 text-caption font-semibold tabular-nums">
            {formatTime(hover ?? 0)}
          </span>
          {hoverChapter?.name && (
            <span className="max-w-[150px] truncate px-1.5 pb-0.5 text-caption text-[var(--stage-fg-2)]">
              {hoverChapter.name}
            </span>
          )}
        </motion.div>
      </motion.div>

      <div
        ref={rootRef}
        role="slider"
        tabIndex={0}
        aria-label={t('player.controls.timeline')}
        aria-valuemin={0}
        aria-valuemax={Math.round(d)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={t('player.controls.timelineValue', {
          current: formatTime(shown),
          total: formatTime(d),
        })}
        data-active={!!active}
        className={`tl-root relative flex w-full cursor-pointer touch-none select-none items-center outline-none ${tall ? 'h-9' : 'h-6'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={() => !active && setHover(null)}
        onKeyDown={onKeyDown}
      >
        {peaks ? (
          <div className="absolute inset-x-0 inset-y-1">
            <WaveCanvas peaks={peaks} progress={p} ab={abFull} />
          </div>
        ) : (
          <div className="tl-track relative h-1 w-full overflow-hidden rounded-full bg-[var(--stage-track)]">
            {d > 0 &&
              buffered.map(([s, e], i) => (
                <span
                  key={i}
                  className="absolute inset-y-0 bg-[var(--stage-buffer)]"
                  style={{ left: `${(s / d) * 100}%`, width: `${((e - s) / d) * 100}%` }}
                />
              ))}
            {hover !== null && d > 0 && !active && (
              <span
                className="absolute inset-0 origin-left bg-white/20"
                style={{ transform: `scaleX(${clamp(hover / d, 0, 1)})` }}
              />
            )}
            <span
              className="absolute inset-0 origin-left"
              style={{
                transform: `scaleX(${p})`,
                background: 'linear-gradient(90deg, var(--accent-2), var(--accent))',
              }}
            />
            {d > 0 &&
              chapters.map((c) => (
                <span
                  key={c.id}
                  className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-[var(--stage-bg)]"
                  style={{ left: `${(c.t / d) * 100}%` }}
                />
              ))}
          </div>
        )}

        {/* 波形模式下的章節線 */}
        {tall &&
          d > 0 &&
          chapters.map((c) => (
            <span
              key={c.id}
              aria-hidden
              className="pointer-events-none absolute inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-[var(--stage-fg)] opacity-70"
              style={{ left: `${(c.t / d) * 100}%` }}
            />
          ))}

        {/* A–B 區間：漸層條「生長」出現 */}
        <AnimatePresence>
          {abFull && (
            <div
              key="ab"
              className="pointer-events-none absolute"
              style={{
                left: `${abFull.a * 100}%`,
                width: `${(abFull.b - abFull.a) * 100}%`,
                top: tall ? 2 : 'calc(50% - 5px)',
                height: tall ? 'calc(100% - 4px)' : 10,
              }}
            >
              <motion.div
                className="size-full origin-left rounded-full"
                style={{
                  background: tall
                    ? 'linear-gradient(90deg, color-mix(in srgb, var(--accent-2) 30%, transparent), color-mix(in srgb, var(--accent) 30%, transparent))'
                    : 'linear-gradient(90deg, color-mix(in srgb, var(--accent-2) 75%, transparent), color-mix(in srgb, var(--accent) 85%, transparent))',
                  boxShadow:
                    '0 0 0 1px color-mix(in srgb, var(--accent) 60%, white), 0 0 14px color-mix(in srgb, var(--accent) 55%, transparent)',
                  borderRadius: tall ? 6 : 999,
                  opacity: 0.9,
                }}
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 0.9 }}
                exit={{ scaleX: 0, opacity: 0, transition: { duration: sec(dur.fast) } }}
                transition={spring.gentle}
              />
            </div>
          )}
        </AnimatePresence>

        {/* 播放頭（只用 transform 移動） */}
        {!tall && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ transform: `translateX(${p * 100}%)` }}
          >
            <span className="tl-thumb absolute left-0 top-1/2 size-3.5 rounded-full bg-white shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_45%,transparent),0_2px_6px_rgba(0,0,0,.5)]" />
          </div>
        )}
        {tall && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ transform: `translateX(${p * 100}%)` }}
          >
            <span className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(0,0,0,.6)]" />
          </div>
        )}

        {/* A／B 把手 */}
        {ab &&
          d > 0 &&
          (['a', 'b'] as const).map((which) => {
            const v = ab[which]
            if (v === null) return null
            return (
              <motion.span
                key={which}
                role="slider"
                tabIndex={0}
                aria-label={t(
                  which === 'a' ? 'player.controls.handleA' : 'player.controls.handleB',
                )}
                aria-valuemin={0}
                aria-valuemax={Math.round(d)}
                aria-valuenow={Math.round(v * 10) / 10}
                aria-valuetext={formatPrecise(v)}
                onPointerDown={startHandleDrag(which)}
                onKeyDown={handleKey(which)}
                className="absolute bottom-full z-[1] -mb-1 grid h-5 min-w-5 -translate-x-1/2 cursor-ew-resize touch-none place-items-center rounded-[6px] px-1 text-[11px] font-bold leading-none text-white shadow-[0_2px_8px_rgba(0,0,0,.5)] outline-none focus-visible:ring-2 focus-visible:ring-white pointer-coarse:h-7 pointer-coarse:min-w-7"
                style={{
                  left: `${(v / d) * 100}%`,
                  background: 'linear-gradient(135deg, var(--accent-2), var(--accent))',
                }}
                initial={{ scale: 0, y: 6 }}
                animate={{ scale: 1, y: 0 }}
                transition={spring.bouncy}
              >
                {which.toUpperCase()}
              </motion.span>
            )
          })}
      </div>
    </div>
  )
}
