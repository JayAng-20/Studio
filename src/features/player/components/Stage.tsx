import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { duration as dur, sec, spring } from '@/design/motion'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { usePlayer, useCurrent } from '../store'
import {
  hideControlsNow,
  hold2x,
  play,
  poke,
  seek,
  seekBy,
  toggleFullscreen,
  togglePlay,
} from '../actions'
import { useMediaEngine, useMediaSession, useWaveform } from '../engine'
import { closeGraph } from '../audio'
import { formatDelta } from '../logic/timecode'
import { AudioView } from './AudioView'
import { ControlBar } from './ControlBar'
import { InfoOverlay } from './InfoOverlay'
import { MorphPlayIcon } from './MorphPlayIcon'
import { CenterFlash, Hold2xBadge, Osd, SeekRipple, WaitingSpinner } from './Overlays'
import { PlaylistList } from './PlaylistPanel'
import { SnapshotCard } from './SnapshotCard'
import { SubtitleLayer } from './SubtitleLayer'
import { Unsupported } from './Unsupported'

const HOLD_MS = 500
const DOUBLE_TAP_MS = 350
const DRAG_START_PX = 12

/**
 * 觸控與滑鼠手勢：
 * - 觸控：單擊顯示／隱藏控制列；雙擊左右半邊 ±10 秒（連點可累加）；水平拖曳 seek
 * - 滑鼠：單擊播放／暫停；雙擊全螢幕
 * - 長按（任何指標）：2 倍速，放開恢復
 */
function GestureLayer() {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const g = useRef({
    id: -1,
    type: '',
    x0: 0,
    y0: 0,
    mode: 'none' as 'none' | 'drag' | 'hold',
    startTime: 0,
    target: 0,
    hold: undefined as ReturnType<typeof setTimeout> | undefined,
    tap: undefined as ReturnType<typeof setTimeout> | undefined,
    last: { at: 0, side: '' },
  })
  const [dragInfo, setDragInfo] = useState<{ target: number; delta: number } | null>(null)

  useEffect(() => {
    const s = g.current
    return () => {
      clearTimeout(s.hold)
      clearTimeout(s.tap)
    }
  }, [])

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return
    const s = g.current
    s.id = e.pointerId
    s.type = e.pointerType
    s.x0 = e.clientX
    s.y0 = e.clientY
    s.mode = 'none'
    clearTimeout(s.hold)
    s.hold = setTimeout(() => {
      const el = usePlayer.getState().el
      if (s.mode === 'none' && s.id === e.pointerId && el && !el.paused) {
        s.mode = 'hold'
        hold2x(true)
      }
    }, HOLD_MS)
  }

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current
    if (e.pointerType === 'mouse') poke()
    if (s.id !== e.pointerId) return
    const dx = e.clientX - s.x0
    const dy = e.clientY - s.y0
    if (s.mode === 'none') {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) clearTimeout(s.hold)
      const el = usePlayer.getState().el
      const d = usePlayer.getState().duration
      if (
        e.pointerType !== 'mouse' &&
        el &&
        d &&
        Math.abs(dx) > DRAG_START_PX &&
        Math.abs(dx) > Math.abs(dy) * 1.2
      ) {
        s.mode = 'drag'
        s.startTime = el.currentTime
        ref.current?.setPointerCapture(e.pointerId)
        poke()
      }
    }
    if (s.mode === 'drag') {
      const w = ref.current?.clientWidth || 1
      const d = usePlayer.getState().duration
      // 滑過整個寬度 = 最多 90 秒（短片則為全長）
      const span = Math.min(d, 90)
      s.target = Math.max(0, Math.min(d, s.startTime + (dx / w) * span))
      setDragInfo({ target: s.target, delta: s.target - s.startTime })
      const el = usePlayer.getState().el
      if (el && !el.seeking) seek(s.target, true)
    }
  }

  const finish = (e: RPointerEvent<HTMLDivElement>, canceled = false) => {
    const s = g.current
    if (s.id !== e.pointerId) return
    clearTimeout(s.hold)
    s.id = -1
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId)
    if (s.mode === 'hold') {
      hold2x(false)
      s.mode = 'none'
      return
    }
    if (s.mode === 'drag') {
      seek(s.target)
      setDragInfo(null)
      s.mode = 'none'
      return
    }
    if (canceled) return
    if (e.pointerType === 'mouse') {
      togglePlay(true)
      return
    }
    // 觸控：雙擊左右兩側跳轉，單擊切換控制列
    const r = ref.current!.getBoundingClientRect()
    const side = e.clientX - r.left < r.width / 2 ? 'left' : 'right'
    const now = performance.now()
    if (now - s.last.at < DOUBLE_TAP_MS && s.last.side === side) {
      clearTimeout(s.tap)
      seekBy(side === 'left' ? -10 : 10, { ripple: true })
      s.last = { at: now, side }
      return
    }
    s.last = { at: now, side }
    clearTimeout(s.tap)
    s.tap = setTimeout(() => {
      const st = usePlayer.getState()
      if (st.controlsVisible && !st.paused) hideControlsNow()
      else poke()
    }, DOUBLE_TAP_MS)
  }

  return (
    <div
      ref={ref}
      aria-hidden
      className="absolute inset-0 z-[6] touch-pan-y select-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={(e) => finish(e)}
      onPointerCancel={(e) => finish(e, true)}
      onDoubleClick={() => {
        // 觸控的雙擊用來跳轉；瀏覽器另外合成的 dblclick 不處理
        if (g.current.type !== 'mouse') return
        void toggleFullscreen()
      }}
      onContextMenu={(e) => {
        if (g.current.mode === 'hold' || g.current.type !== 'mouse') e.preventDefault()
      }}
    >
      <AnimatePresence>
        {dragInfo && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 top-[38%] flex justify-center"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={spring.snappy}
          >
            <div
              className="stage-glass flex flex-col items-center rounded-xl px-5 py-2.5"
              role="status"
            >
              <span className="text-h2 font-semibold tabular-nums">
                {formatTime(dragInfo.target)}
              </span>
              <span className="text-small tabular-nums text-[var(--stage-fg-2)]">
                {t('player.osd.seconds', { value: formatDelta(dragInfo.delta) })}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 尚未開始或播完時，中央的大播放鈕 */
function BigPlay() {
  const t = useT()
  const item = useCurrent()
  const paused = usePlayer((s) => s.paused)
  const time = usePlayer((s) => s.time)
  const duration = usePlayer((s) => s.duration)
  const ready = usePlayer((s) => s.ready)
  const atEdge = time < 0.05 || (duration > 0 && time >= duration - 0.05)
  const show = !!item && !item.error && paused && atEdge && ready
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          aria-label={t('player.controls.play')}
          className="stage-glass absolute left-1/2 top-[calc(50%-var(--controls-h)/2+16px)] z-[8] grid size-[72px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[var(--stage-fg)] shadow-e3"
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8, transition: { duration: sec(dur.fast) } }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={spring.bouncy}
          onClick={() => {
            if (duration && time >= duration - 0.05) seek(0)
            void play()
          }}
        >
          <MorphPlayIcon playing={false} size={32} />
        </motion.button>
      )}
    </AnimatePresence>
  )
}

/** 全螢幕時的播放清單抽屜（在播放畫面內，避免 portal 到全螢幕外） */
function FullscreenDrawer() {
  const t = useT()
  const open = usePlayer((s) => s.drawerOpen && s.fullscreen)
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="stage-glass absolute inset-y-3 right-3 z-30 flex w-[min(360px,calc(100%-24px))] flex-col rounded-xl"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24, transition: { duration: sec(dur.fast) } }}
          transition={spring.smooth}
          aria-label={t('player.playlist.drawer')}
          onPointerMove={poke}
        >
          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <h3 className="text-h3 font-semibold">{t('player.playlist.title')}</h3>
            <button
              type="button"
              className="stage-btn"
              aria-label={t('common.close')}
              onClick={() => usePlayer.getState().set({ drawerOpen: false })}
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <PlaylistList dark />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

export function Stage({
  onChooseFile,
  onOpenPlaylist,
}: {
  onChooseFile: () => void
  onOpenPlaylist: () => void
}) {
  const t = useT()
  const item = useCurrent()
  const visible = usePlayer((s) => s.controlsVisible)
  const paused = usePlayer((s) => s.paused)
  const setEl = useCallback((el: HTMLVideoElement | null) => {
    const s = usePlayer.getState()
    if (!el && s.el) {
      // 離開頁面：記住位置，回來時接著播；釋放音訊圖
      const prevEl = s.el
      if (s.currentId) s.set({ restore: { id: s.currentId, t: prevEl.currentTime, play: false } })
      prevEl.pause()
      closeGraph()
      s.set({ paused: true })
    }
    s.set({ el })
  }, [])
  const setStage = useCallback(
    (el: HTMLDivElement | null) => usePlayer.getState().set({ stageEl: el }),
    [],
  )
  useMediaEngine()
  useMediaSession()
  useWaveform()
  const audio = item?.kind === 'audio'
  return (
    <div
      ref={setStage}
      role="region"
      aria-label={t('player.controls.stage')}
      data-audio={audio}
      data-idle={!visible && !paused}
      data-error={!!item?.error}
      className="player-stage relative rounded-2xl shadow-e3"
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse' && !usePlayer.getState().menuOpen) hideControlsNow()
      }}
    >
      <video
        ref={setEl}
        className={cn('absolute inset-0 size-full object-contain', audio && 'invisible')}
        playsInline
        crossOrigin="anonymous"
        preload="metadata"
      />
      {audio && item && <AudioView item={item} />}
      <SubtitleLayer />
      <GestureLayer />
      <BigPlay />
      <CenterFlash />
      <SeekRipple />
      <WaitingSpinner />
      <Osd />
      <Hold2xBadge />
      <InfoOverlay />
      <SnapshotCard />
      {item?.error && <Unsupported item={item} onChooseFile={onChooseFile} />}
      {!(item?.error && !item.noVideo) && <ControlBar onOpenPlaylist={onOpenPlaylist} />}
      <FullscreenDrawer />
    </div>
  )
}
