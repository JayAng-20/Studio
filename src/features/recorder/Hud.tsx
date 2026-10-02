/**
 * 錄製中 HUD：浮動玻璃膠囊（紅點呼吸、計時、標記、靜音、暫停／繼續、浮動控制、停止）。
 * 停止後膠囊以 shared layout（layoutId）變形成結果卡。
 * 支援 Document Picture-in-Picture 時，可把同一組控制放進永遠在最上層的小視窗。
 */
import { AnimatePresence, motion } from 'motion/react'
import { createPortal } from 'react-dom'
import { Flag, Mic, MicOff, Pause, PictureInPicture2, Play } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Spinner, Tooltip, toast } from '@/components/ui'
import { duration, easing, sec, spring, timing } from '@/design/motion'
import { t as tr, useT } from '@/i18n'
import { caps } from '@/lib/capabilities'
import { cn } from '@/lib/cn'
import { useMedia } from '@/lib/useMedia'
import { useSettings } from '@/stores/settings'
import { formatClock } from './core'
import {
  addMarkerNow,
  getAnalysers,
  stopRecording,
  toggleMute,
  togglePause,
  useRecorder,
} from './engine'
import { LevelMeter } from './media'

export const HUD_LAYOUT_ID = 'recorder-hud'
/** 膠囊高度 56 的一半：layout 變形時以 style 的圓角內插 */
export const HUD_RADIUS = 28

/* ===================== Document PiP ===================== */

interface DocumentPipApi {
  requestWindow(opts: { width: number; height: number }): Promise<Window>
}

const pipApi = () =>
  (window as unknown as { documentPictureInPicture?: DocumentPipApi }).documentPictureInPicture

/** 把目前頁面的樣式與主題屬性複製到 PiP 視窗 */
function mirrorDocument(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join('\n')
      const style = target.createElement('style')
      style.textContent = css
      target.head.appendChild(style)
    } catch {
      if (sheet.href) {
        const link = target.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        target.head.appendChild(link)
      }
    }
  }
  const src = document.documentElement
  const dst = target.documentElement
  for (const attr of ['data-theme', 'data-module', 'data-motion', 'lang']) {
    const v = src.getAttribute(attr)
    if (v) dst.setAttribute(attr, v)
  }
  target.body.className = 'm-0 grid min-h-dvh place-items-center bg-bg p-2 text-text'
}

export function useDocumentPip(active: boolean) {
  const [win, setWin] = useState<Window | null>(null)
  const supported = caps.documentPip()
  const open = useCallback(async () => {
    const api = pipApi()
    if (!api) {
      toast.info(tr('recorder.hud.pipUnsupported'))
      return
    }
    try {
      const w = await api.requestWindow({ width: 420, height: 88 })
      mirrorDocument(w.document)
      w.document.title = document.title
      w.addEventListener('pagehide', () => setWin(null), { once: true })
      setWin(w)
    } catch (e) {
      console.error(e)
    }
  }, [])
  const close = useCallback(() => {
    setWin((w) => {
      w?.close()
      return null
    })
  }, [])
  // 錄影結束或元件卸載時關閉
  useEffect(() => {
    if (!active && win) win.close()
  }, [active, win])
  useEffect(() => () => win?.close(), [win])
  return { win, open, close, supported }
}

/* ===================== HUD ===================== */

export function Hud({ onKeys }: { onKeys?: (e: KeyboardEvent) => void }) {
  const t = useT()
  const stage = useRecorder((s) => s.stage)
  const active = stage === 'recording' || stage === 'finalizing'
  const collapsed = useSettings((s) => s.sidebarCollapsed)
  const desktop = useMedia('(min-width: 1024px)')
  const tablet = useMedia('(min-width: 640px)')
  const pip = useDocumentPip(active)
  const left = desktop ? (collapsed ? 72 : 248) : tablet ? 72 : 0

  // PiP 視窗內也接受快捷鍵
  useEffect(() => {
    const w = pip.win
    if (!w || !onKeys) return
    w.addEventListener('keydown', onKeys)
    return () => w.removeEventListener('keydown', onKeys)
  }, [pip.win, onKeys])

  if (!active) return null
  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-50 flex justify-center px-3 sm:bottom-6"
        style={{ left }}
      >
        <motion.div
          layoutId={HUD_LAYOUT_ID}
          role="toolbar"
          aria-label={t('recorder.hud.label')}
          className="glass pointer-events-auto relative flex h-14 items-center gap-1 pl-4 pr-2 shadow-e4"
          style={{ borderRadius: HUD_RADIUS }}
          initial={{ opacity: 0, y: 24, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={spring.smooth}
        >
          <HudContent
            pipSupported={pip.supported}
            pipOpen={!!pip.win}
            onPip={pip.win ? pip.close : pip.open}
          />
        </motion.div>
      </div>
      {pip.win &&
        createPortal(
          <div
            role="toolbar"
            aria-label={t('recorder.pip.title')}
            className="glass flex h-14 items-center gap-1 rounded-full pl-4 pr-2 shadow-e2"
          >
            <HudContent compact />
          </div>,
          pip.win.document.body,
        )}
    </>
  )
}

export function HudButton({
  label,
  onClick,
  children,
  shortcut,
  active,
  tone,
  disabled,
  plain,
}: {
  plain?: boolean
  label: string
  onClick: () => void
  children: ReactNode
  shortcut?: string
  active?: boolean
  tone?: 'danger'
  disabled?: boolean
}) {
  const button = (
      <motion.button
        type="button"
        aria-label={label}
        aria-pressed={active}
        aria-keyshortcuts={shortcut}
        disabled={disabled}
        onClick={onClick}
        whileTap={{ scale: 0.9 }}
        transition={spring.snappy}
        className={cn(
          'relative grid size-11 shrink-0 place-items-center rounded-full transition-colors duration-(--dur-fast) sm:size-10',
          tone === 'danger'
            ? 'bg-danger text-white shadow-[0_6px_16px_-6px_var(--danger)] hover:brightness-110'
            : active
              ? 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-danger-ink'
              : 'text-text-2 hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-text',
          disabled && 'opacity-45',
        )}
      >
        {children}
      </motion.button>
  )
  // PiP 視窗裡不顯示 Tooltip（它會畫在主視窗）
  return plain ? button : (
    <Tooltip content={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  )
}

/** 膠囊內容（頁面與 PiP 視窗共用） */
function HudContent({
  compact,
  pipSupported,
  pipOpen,
  onPip,
}: {
  compact?: boolean
  pipSupported?: boolean
  pipOpen?: boolean
  onPip?: () => void
}) {
  const t = useT()
  const stage = useRecorder((s) => s.stage)
  const paused = useRecorder((s) => s.paused)
  const elapsed = useRecorder((s) => s.elapsed)
  const muted = useRecorder((s) => s.micMuted)
  const hasMic = useRecorder((s) => !!s.live?.hasMic)
  const markerCount = useRecorder((s) => s.markers.length)
  const flash = useRecorder((s) => s.markerFlash)
  const [hiddenN, setHiddenN] = useState(0)
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setHiddenN(flash.n), timing.copiedReset)
    return () => clearTimeout(id)
  }, [flash])
  const showFlash = !!flash && flash.n !== hiddenN
  const flashText = !flash
    ? ''
    : flash.at === null
      ? t('recorder.hud.markerTooClose')
      : t('recorder.hud.markerAdded', { time: formatClock(flash.at * 1000) })

  if (stage === 'finalizing') {
    return (
      <div className="flex items-center gap-3 pr-3">
        <Spinner size={20} />
        <span className="text-body font-medium">{t('recorder.hud.finalizing')}</span>
      </div>
    )
  }

  const clock = formatClock(elapsed)
  return (
    <>
      <span className="relative mr-1 grid size-3 shrink-0 place-items-center" aria-hidden>
        <span
          className={cn(
            'size-3 rounded-full',
            paused ? 'bg-text-3' : 'motion-decor bg-danger',
          )}
          style={paused ? undefined : { animation: 'breathe 1.6s ease-in-out infinite' }}
        />
        {!paused && (
          <span
            className="motion-decor absolute inset-0 rounded-full bg-danger"
            style={{ animation: 'rec-ping 1.6s cubic-bezier(.2,0,0,1) infinite' }}
          />
        )}
      </span>
      <span
        role="timer"
        aria-label={t('recorder.hud.clockLabel', { time: clock })}
        className={cn(
          'min-w-[4.9ch] text-[15px] font-semibold tabular-nums tracking-[-0.01em]',
          paused && 'text-text-2',
        )}
      >
        {clock}
      </span>
      {hasMic && !compact && (
        <LevelMeter
          analyser={getAnalysers().mic}
          muted={muted}
          bars={5}
          className="ml-1 hidden h-5 sm:flex"
        />
      )}
      <span aria-hidden className="mx-1.5 h-6 w-px bg-border-strong" />
      <HudButton plain={compact} label={t('recorder.hud.marker')} shortcut="T" onClick={() => addMarkerNow()}>
        <Flag size={18} aria-hidden />
        <AnimatePresence>
          {markerCount > 0 && (
            <motion.span
              key={markerCount}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={spring.bouncy}
              className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-strong px-1 text-[10px] font-semibold leading-none text-white"
            >
              {markerCount}
            </motion.span>
          )}
        </AnimatePresence>
      </HudButton>
      {hasMic && (
        <HudButton
          plain={compact}
          label={muted ? t('recorder.hud.unmute') : t('recorder.hud.mute')}
          shortcut="M"
          active={muted}
          onClick={toggleMute}
        >
          {muted ? <MicOff size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
        </HudButton>
      )}
      <HudButton
        plain={compact}
        label={paused ? t('recorder.hud.resume') : t('recorder.hud.pause')}
        shortcut="P"
        onClick={togglePause}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={paused ? 'play' : 'pause'}
            initial={{ opacity: 0, scale: 0.6, rotate: -45 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.6, rotate: 45 }}
            transition={spring.snappy}
            className="grid place-items-center"
          >
            {paused ? <Play size={18} aria-hidden /> : <Pause size={18} aria-hidden />}
          </motion.span>
        </AnimatePresence>
      </HudButton>
      {!compact && pipSupported && onPip && (
        <HudButton
          label={pipOpen ? t('recorder.hud.pipClose') : t('recorder.hud.pip')}
          active={pipOpen}
          onClick={onPip}
        >
          <PictureInPicture2 size={18} aria-hidden />
        </HudButton>
      )}
      <HudButton plain={compact} label={t('recorder.hud.stop')} shortcut="R" tone="danger" onClick={() => stopRecording('user')}>
        <span className="size-3.5 rounded-[4px] bg-white" aria-hidden />
      </HudButton>
      <AnimatePresence>
        {showFlash && flash && !compact && (
          <motion.span
            key={flash.n}
            role="status"
            className="glass pointer-events-none absolute bottom-full left-1/2 mb-2 whitespace-nowrap rounded-full px-3 py-1.5 text-caption font-medium shadow-e3"
            style={{ x: '-50%' }}
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: sec(duration.fast), ease: easing.standard } }}
            transition={spring.bouncy}
          >
            <Flag size={12} className="mr-1 inline text-accent-ink" aria-hidden />
            {flashText}
          </motion.span>
        )}
      </AnimatePresence>
    </>
  )
}
