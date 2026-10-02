import { motion } from 'motion/react'
import {
  Camera,
  Captions,
  CaptionsOff,
  Ellipsis,
  Info,
  Keyboard,
  ListMusic,
  Maximize,
  Minimize,
  PictureInPicture2,
  Repeat,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Slider } from '@/components/ui'
import { duration as dur, offset, sec, spring } from '@/design/motion'
import { formatTime } from '@/lib/format'
import { useUi } from '@/stores/ui'
import { useT } from '@/i18n'
import { usePlayer, useCurrent } from '../store'
import {
  canFullscreen,
  canPip,
  clearAB,
  frameStep,
  next,
  poke,
  prev,
  seekBy,
  setAPoint,
  setBPoint,
  setRate,
  setVolume,
  takeSnapshot,
  toggleABLoop,
  toggleFullscreen,
  toggleMute,
  togglePip,
  togglePlay,
  toggleSubs,
} from '../actions'
import { SPEEDS, formatSpeed } from '../logic/speed'
import { isComplete } from '../logic/ab'
import { MorphPlayIcon } from './MorphPlayIcon'
import { StageButton } from './StageButton'
import { StageMenu } from './StageMenu'
import { Timeline } from './Timeline'

/** 倒退／快轉 10 秒圖示：圓弧箭頭＋數字 */
function SkipIcon({ dir }: { dir: -1 | 1 }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <g transform={dir < 0 ? undefined : 'translate(24 0) scale(-1 1)'}>
        <path d="M3 12a9 9 0 1 0 2.64-6.36" />
        <path d="M3 3v5h5" />
      </g>
      <text x="12" y="15.6" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" stroke="none" fontFamily="var(--font-sans)">
        10
      </text>
    </svg>
  )
}

function VolumeControl() {
  const t = useT()
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const webAudio = usePlayer((s) => s.webAudio)
  const v = muted ? 0 : volume
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2
  const pct = Math.round(volume * 100)
  return (
    <div className="flex items-center">
      <StageButton label={muted ? t('player.controls.unmute') : t('player.controls.mute')} shortcut="M" onClick={toggleMute}>
        <Icon size={20} aria-hidden />
      </StageButton>
      <div className="hidden w-24 items-center pl-1 pr-2 @2xl:flex">
        <Slider
          value={muted ? 0 : pct}
          min={0}
          max={webAudio ? 200 : 100}
          step={1}
          warnAbove={100}
          label={t('player.controls.volume')}
          format={(x) => `${x}%`}
          onChange={(x) => setVolume(x / 100)}
        />
      </div>
      {pct > 100 && !muted && (
        <span
          className="hidden pr-1.5 text-caption font-semibold tabular-nums @2xl:inline"
          style={{ color: 'color-mix(in srgb, var(--warning) 75%, white)' }}
          title={t('player.controls.volumeBoost')}
        >
          {pct}%
        </span>
      )}
    </div>
  )
}

function TimeDisplay() {
  const time = usePlayer((s) => s.time)
  const duration = usePlayer((s) => s.duration)
  const [remain, setRemain] = useState(false)
  return (
    <button
      type="button"
      onClick={() => setRemain((r) => !r)}
      className="stage-btn shrink-0 whitespace-nowrap px-2 text-small font-medium tabular-nums"
      aria-label={`${formatTime(time)} / ${formatTime(duration)}`}
    >
      <span>
        {remain ? `−${formatTime(Math.max(0, duration - time))}` : formatTime(time)}
        <span className="hidden @sm:inline">
          <span className="mx-1 text-[var(--stage-fg-2)]">/</span>
          <span className="text-[var(--stage-fg-2)]">{formatTime(duration)}</span>
        </span>
      </span>
    </button>
  )
}

function SpeedMenu() {
  const t = useT()
  const rate = usePlayer((s) => s.rate)
  return (
    <StageMenu
      label={t('player.controls.speed')}
      radio
      numeric
      title={t('player.controls.speed')}
      triggerClassName="px-2 text-small font-semibold tabular-nums min-w-12"
      trigger={<span>{formatSpeed(rate)}</span>}
      items={SPEEDS.map((s) => ({
        key: String(s),
        label: s === 1 ? `${formatSpeed(s)}（${t('player.controls.normal')}）` : formatSpeed(s),
        checked: Math.abs(rate - s) < 1e-6,
        onSelect: () => setRate(s),
      }))}
    />
  )
}

function AbButtons() {
  const t = useT()
  const item = useCurrent()
  const loop = usePlayer((s) => s.abLoop)
  const ab = item?.ab
  const full = !!ab && isComplete(ab)
  return (
    <div className="hidden items-center @5xl:flex">
      <StageButton label={t('player.controls.setA')} shortcut="A" pressed={ab?.a != null} onClick={() => setAPoint()} className="text-small font-bold">
        A
      </StageButton>
      <StageButton label={t('player.controls.setB')} shortcut="B" pressed={ab?.b != null} onClick={() => setBPoint()} className="text-small font-bold">
        B
      </StageButton>
      {full && (
        <>
          <StageButton label={t('player.controls.abLoop')} pressed={loop} onClick={toggleABLoop}>
            <Repeat size={18} aria-hidden />
          </StageButton>
          <StageButton label={t('player.controls.clearAB')} onClick={clearAB}>
            <X size={18} aria-hidden />
          </StageButton>
        </>
      )}
    </div>
  )
}

export function ControlBar({ onOpenPlaylist }: { onOpenPlaylist: () => void }) {
  const t = useT()
  const visible = usePlayer((s) => s.controlsVisible)
  const paused = usePlayer((s) => s.paused)
  const multi = usePlayer((s) => s.items.length > 1)
  const fullscreen = usePlayer((s) => s.fullscreen)
  const pip = usePlayer((s) => s.pip)
  const subsOn = usePlayer((s) => s.subsOn)
  const loop = usePlayer((s) => s.abLoop)
  const stageEl = usePlayer((s) => s.stageEl)
  const item = useCurrent()
  const isVideo = item?.kind === 'video' && !item.noVideo
  const hasSubs = !!item?.subtitles.length
  const ab = item?.ab
  const barRef = useRef<HTMLDivElement>(null)

  // 量控制列高度，讓字幕避開
  useEffect(() => {
    const bar = barRef.current
    if (!bar || !stageEl) return
    const ro = new ResizeObserver(() => stageEl.style.setProperty('--controls-h', `${bar.offsetHeight + 16}px`))
    ro.observe(bar)
    return () => ro.disconnect()
  }, [stageEl])

  const pipOk = canPip() && isVideo
  const fsOk = canFullscreen()

  const moreItems = [
    { key: 'back10', label: t('player.controls.back10'), icon: <SkipIcon dir={-1} />, hint: 'J', onSelect: () => seekBy(-10, { ripple: true }), keepOpen: true },
    { key: 'fwd10', label: t('player.controls.fwd10'), icon: <SkipIcon dir={1} />, hint: 'L', onSelect: () => seekBy(10, { ripple: true }), keepOpen: true },
    { key: 'a', label: t('player.controls.setA'), icon: <b className="text-caption">A</b>, hint: 'A', checked: ab?.a != null ? true : undefined, onSelect: () => setAPoint() },
    { key: 'b', label: t('player.controls.setB'), icon: <b className="text-caption">B</b>, hint: 'B', checked: ab?.b != null ? true : undefined, onSelect: () => setBPoint() },
    ...(ab && isComplete(ab)
      ? [
          { key: 'loop', label: t('player.controls.abLoop'), icon: <Repeat size={15} aria-hidden />, checked: loop, onSelect: toggleABLoop },
          { key: 'clear', label: t('player.controls.clearAB'), icon: <X size={15} aria-hidden />, onSelect: clearAB },
        ]
      : []),
    ...(isVideo
      ? [
          { key: 'fb', label: t('player.controls.frameBack'), icon: <StepBack size={15} aria-hidden />, hint: ',', onSelect: () => frameStep(-1), keepOpen: true },
          { key: 'ff', label: t('player.controls.frameFwd'), icon: <StepForward size={15} aria-hidden />, hint: '.', onSelect: () => frameStep(1), keepOpen: true },
          { key: 'shot', label: t('player.actions.screenshot'), icon: <Camera size={15} aria-hidden />, hint: 'S', onSelect: () => void takeSnapshot() },
        ]
      : []),
    ...(pipOk
      ? [{ key: 'pip', label: pip ? t('player.controls.pipExit') : t('player.controls.pip'), icon: <PictureInPicture2 size={15} aria-hidden />, hint: 'P', onSelect: () => void togglePip() }]
      : []),
    {
      key: 'subs',
      label: subsOn && hasSubs ? t('player.controls.subtitlesOff') : t('player.controls.subtitlesOn'),
      icon: <Captions size={15} aria-hidden />,
      hint: undefined,
      onSelect: toggleSubs,
    },
    { key: 'info', label: t('player.controls.info'), icon: <Info size={15} aria-hidden />, hint: 'I', onSelect: () => usePlayer.getState().set({ infoOverlay: !usePlayer.getState().infoOverlay }) },
    { key: 'list', label: t('player.controls.playlist'), icon: <ListMusic size={15} aria-hidden />, onSelect: onOpenPlaylist },
    ...(!fullscreen
      ? [{ key: 'keys', label: t('player.actions.shortcuts'), icon: <Keyboard size={15} aria-hidden />, hint: '?', onSelect: () => useUi.getState().set({ shortcutsOpen: true }) }]
      : []),
  ]

  return (
    <motion.div
      className="absolute inset-x-0 bottom-0 z-[28] px-2 pb-2 @md:px-3 @md:pb-3"
      initial={false}
      animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : offset.panel }}
      transition={{ opacity: { duration: sec(visible ? dur.fast : dur.slow) }, y: spring.smooth }}
      style={{ pointerEvents: visible ? 'auto' : 'none' }}
      onPointerMove={poke}
      onFocusCapture={poke}
    >
      <div ref={barRef} role="group" aria-label={t('player.controls.controlBar')} className="stage-glass rounded-xl px-2 pb-1 pt-2 @md:px-3">
        <Timeline />
        <div className="flex items-center gap-0.5">
          {multi && (
            <StageButton label={t('player.controls.previous')} onClick={prev} className="hidden @md:inline-grid">
              <SkipBack size={19} aria-hidden fill="currentColor" />
            </StageButton>
          )}
          <StageButton
            label={paused ? t('player.controls.play') : t('player.controls.pause')}
            shortcut="K"
            onClick={() => togglePlay(true)}
          >
            <MorphPlayIcon playing={!paused} />
          </StageButton>
          {multi && (
            <StageButton label={t('player.controls.next')} onClick={() => next('user')} className="hidden @md:inline-grid">
              <SkipForward size={19} aria-hidden fill="currentColor" />
            </StageButton>
          )}
          <StageButton label={t('player.controls.back10')} shortcut="J" onClick={() => seekBy(-10, { ripple: true })} className="hidden @lg:inline-grid">
            <SkipIcon dir={-1} />
          </StageButton>
          <StageButton label={t('player.controls.fwd10')} shortcut="L" onClick={() => seekBy(10, { ripple: true })} className="hidden @lg:inline-grid">
            <SkipIcon dir={1} />
          </StageButton>
          <VolumeControl />
          <TimeDisplay />
          <div className="min-w-0 flex-1" />
          <AbButtons />
          <StageButton
            label={subsOn && hasSubs ? t('player.controls.subtitlesOff') : t('player.controls.subtitlesOn')}
            pressed={subsOn && hasSubs}
            onClick={toggleSubs}
            className="hidden @sm:inline-grid"
          >
            {subsOn && hasSubs ? <Captions size={20} aria-hidden /> : <CaptionsOff size={20} aria-hidden />}
          </StageButton>
          <SpeedMenu />
          {isVideo && (
            <StageButton label={t('player.actions.screenshot')} shortcut="S" onClick={() => void takeSnapshot()} className="hidden @3xl:inline-grid">
              <Camera size={19} aria-hidden />
            </StageButton>
          )}
          {pipOk && (
            <StageButton label={pip ? t('player.controls.pipExit') : t('player.controls.pip')} shortcut="P" pressed={pip} onClick={() => void togglePip()} className="hidden @3xl:inline-grid">
              <PictureInPicture2 size={19} aria-hidden />
            </StageButton>
          )}
          {fullscreen && (
            <StageButton label={t('player.controls.playlist')} onClick={onOpenPlaylist}>
              <ListMusic size={19} aria-hidden />
            </StageButton>
          )}
          <StageMenu label={t('player.controls.more')} trigger={<Ellipsis size={20} aria-hidden />} items={moreItems} />
          {fsOk && (
            <StageButton
              label={fullscreen ? t('player.controls.exitFullscreen') : t('player.controls.fullscreen')}
              shortcut="F"
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? <Minimize size={19} aria-hidden /> : <Maximize size={19} aria-hidden />}
            </StageButton>
          )}
        </div>
      </div>
    </motion.div>
  )
}
