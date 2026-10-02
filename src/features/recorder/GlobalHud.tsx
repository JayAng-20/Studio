/**
 * 全域 HUD：錄製中但目前不在 #/recorder 時，由外殼以 lazy import 掛載。
 * 直接讀取錄影引擎的 store，不依賴錄影頁面已掛載。
 * 精簡版：紅點、計時、暫停／繼續、停止（停止後回到錄影頁的結果畫面）、回到錄影頁。
 */
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Pause, Play } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { spring } from '@/design/motion'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useMedia } from '@/lib/useMedia'
import { useSettings } from '@/stores/settings'
import { useTasks } from '@/stores/tasks'
import { formatClock } from './core'
import { stopRecording, togglePause, useRecorder } from './engine'
import { HudButton } from './Hud'
import './recorder.css'

export const RECORDER_PATH = '/recorder'

export default function GlobalHud() {
  const t = useT()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const stage = useRecorder((s) => s.stage)
  const paused = useRecorder((s) => s.paused)
  const elapsed = useRecorder((s) => s.elapsed)
  const collapsed = useSettings((s) => s.sidebarCollapsed)
  const desktop = useMedia('(min-width: 1024px)')
  const tablet = useMedia('(min-width: 640px)')
  const hasTasks = useTasks((s) => s.tasks.length > 0)
  const onRecorder = pathname === RECORDER_PATH || pathname.startsWith(`${RECORDER_PATH}/`)
  const show = stage === 'recording' && !onRecorder
  // 與側欄寬度對齊，膠囊置中在內容區
  const left = desktop ? (collapsed ? 72 : 248) : tablet ? 72 : 0
  const clock = formatClock(elapsed)

  return (
    <AnimatePresence>
      {show && (
        <div
          key="global-hud"
          data-global-hud
          className={cn(
            'pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3',
            // 手機：避開底部 tab bar；有任務中心膠囊時再往上一層
            hasTasks
              ? 'bottom-[calc(128px+env(safe-area-inset-bottom))] sm:bottom-6'
              : 'bottom-[calc(76px+env(safe-area-inset-bottom))] sm:bottom-6',
          )}
          style={{ left }}
        >
          <motion.div
            role="toolbar"
            aria-label={t('recorder.global.label')}
            className="glass pointer-events-auto flex h-14 items-center gap-1 rounded-full pl-4 pr-2 shadow-e4"
            initial={{ opacity: 0, y: 24, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.92 }}
            transition={spring.smooth}
          >
            <span className="relative mr-1 grid size-3 shrink-0 place-items-center" aria-hidden>
              <span
                className={cn('size-3 rounded-full', paused ? 'bg-text-3' : 'motion-decor bg-danger')}
                style={paused ? undefined : { animation: 'breathe 1.6s ease-in-out infinite' }}
              />
              {!paused && (
                <span
                  className="motion-decor absolute inset-0 rounded-full bg-danger"
                  style={{ animation: 'rec-ping 1.6s cubic-bezier(.2,0,0,1) infinite' }}
                />
              )}
            </span>
            <span className="sr-only">
              {paused ? t('recorder.global.paused') : t('recorder.global.recording')}
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
            <span aria-hidden className="mx-1.5 h-6 w-px bg-border-strong" />
            <HudButton
              label={paused ? t('recorder.hud.resume') : t('recorder.hud.pause')}
              onClick={togglePause}
            >
              {paused ? <Play size={18} aria-hidden /> : <Pause size={18} aria-hidden />}
            </HudButton>
            <HudButton label={t('recorder.global.open')} onClick={() => nav(RECORDER_PATH)}>
              <ArrowUpRight size={18} aria-hidden />
            </HudButton>
            <HudButton
              label={t('recorder.hud.stop')}
              tone="danger"
              onClick={() => {
                stopRecording('user')
                nav(RECORDER_PATH)
              }}
            >
              <span className="size-3.5 rounded-[4px] bg-white" aria-hidden />
            </HudButton>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
