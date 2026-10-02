/**
 * 螢幕錄影（#/recorder）：準備 → 3‑2‑1 倒數 → 錄製中 HUD → 結果（預覽、編輯、傳送、錄影庫）。
 */
import { motion } from 'motion/react'
import { Camera, MonitorX, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { ModulePage } from '@/components/layout/ModulePage'
import { Badge, Button, Callout, EmptyState, Stepper } from '@/components/ui'
import { EmptyIllustration } from '@/design/illustrations'
import { spring } from '@/design/motion'
import { useT } from '@/i18n'
import { caps } from '@/lib/capabilities'
import { useMedia } from '@/lib/useMedia'
import { useModuleShortcuts } from '@/stores/ui'
import { formatClock, pickFormat } from './core'
import {
  addMarkerNow,
  beginRecording,
  cancelCountdown,
  stopRecording,
  toggleMute,
  togglePause,
  useRecorder,
  type Stage,
} from './engine'
import { listFormatsCached } from './formats'
import { currentPrefs, usePrefs } from './prefs'
import { SetupView } from './Setup'
import { LiveView } from './Live'
import { ResultView } from './Result'
import { LibrarySection } from './Library'
import { CountdownOverlay } from './Countdown'
import { Hud } from './Hud'
import './recorder.css'

const isTyping = (el: EventTarget | null) => {
  const e = el as HTMLElement | null
  return (
    !!e &&
    (e.tagName === 'INPUT' ||
      e.tagName === 'TEXTAREA' ||
      e.tagName === 'SELECT' ||
      e.isContentEditable === true)
  )
}

const view = (s: Stage) =>
  s === 'recording' || s === 'finalizing' ? 'live' : s === 'result' ? 'result' : 'setup'

export default function RecorderPage() {
  const t = useT()
  const stage = useRecorder((s) => s.stage)
  const result = useRecorder((s) => s.result)
  const paused = useRecorder((s) => s.paused)
  const preferredFormat = usePrefs((s) => s.format)
  const mode = usePrefs((s) => s.mode)
  const formats = listFormatsCached()
  const desktop = useMedia('(min-width: 1024px)')
  const format = pickFormat(formats, preferredFormat)
  const screenOk = caps.displayMedia()
  const cameraOk = caps.userMedia()

  // 「錄製中或有還沒保存的錄影」的離開警告由 engine 自己登記（UNSAVED_KEY），
  // 不綁在頁面上：切到其他工具時頁面卸載，警告與全域 HUD 仍要有效

  useModuleShortcuts([
    { keys: ['R'], label: t('recorder.shortcuts.startStop') },
    { keys: ['P'], label: t('recorder.shortcuts.pause') },
    { keys: ['M'], label: t('recorder.shortcuts.mute') },
    { keys: ['T'], label: t('recorder.shortcuts.marker') },
    { keys: ['Esc'], label: t('recorder.shortcuts.cancel') },
  ])

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (isTyping(e.target)) return
      const doc = (e.target as Node | null)?.ownerDocument ?? document
      if (doc.querySelector('[role="dialog"][data-state="open"]')) return
      const st = useRecorder.getState().stage
      const k = e.key.toLowerCase()
      if (k === 'r') {
        if (st === 'setup' && format && (screenOk || cameraOk)) {
          e.preventDefault()
          void beginRecording({ ...currentPrefs(), mode: screenOk ? currentPrefs().mode : 'camera' }, format)
        } else if (st === 'recording') {
          e.preventDefault()
          stopRecording('user')
        }
      } else if (st === 'recording') {
        if (k === 'p') togglePause()
        else if (k === 'm') toggleMute()
        else if (k === 't') addMarkerNow()
        else return
        e.preventDefault()
      }
    },
    [format, screenOk, cameraOk],
  )
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  // 離開這個工具時，取消還沒開始的倒數（已經在錄的不中斷）
  useEffect(
    () => () => {
      const st = useRecorder.getState().stage
      if (st === 'countdown') cancelCountdown()
    },
    [],
  )

  const status = (
    <Badge
      tone={stage === 'recording' && !paused ? 'danger' : stage === 'result' ? 'success' : 'neutral'}
      icon={
        stage === 'recording' && !paused ? (
          <span
            aria-hidden
            className="motion-decor size-2 rounded-full bg-danger"
            style={{ animation: 'breathe 1.6s ease-in-out infinite' }}
          />
        ) : undefined
      }
    >
      {stage === 'recording' && paused ? t('recorder.status.paused') : t(`recorder.status.${stage === 'setup' ? 'ready' : stage}`)}
    </Badge>
  )

  const stepIndex = stage === 'result' ? 2 : stage === 'recording' || stage === 'finalizing' ? 1 : 0
  // 桌機：錄影庫在主欄；較窄時放在設定與動作面板之後
  const library = desktop ? <LibrarySection /> : null
  const libraryAfter = desktop ? null : <LibrarySection />

  let body
  if (!caps.mediaRecorder() || !format) {
    body = (
      <div className="card">
        <EmptyState
          illustration={<Unavailable icon={<MonitorX size={30} aria-hidden />} />}
          title={t('recorder.unsupported.noRecorderTitle')}
          description={t('recorder.unsupported.noRecorderDesc')}
        />
      </div>
    )
  } else if (!screenOk && !cameraOk) {
    body = (
      <div className="card">
        <EmptyState
          illustration={<Unavailable icon={<ShieldAlert size={30} aria-hidden />} />}
          title={t('recorder.unsupported.noCaptureTitle')}
          description={
            typeof window !== 'undefined' && !window.isSecureContext
              ? t('recorder.unsupported.insecureDesc')
              : t('recorder.unsupported.noCaptureDesc')
          }
        />
      </div>
    )
  } else if (!screenOk && mode === 'screen' && stage === 'setup') {
    // 不支援螢幕擷取（例如 iOS）：友善說明＋鏡頭錄影替代
    body = (
      <div className="flex flex-col gap-4">
        <div className="card">
          <EmptyState
            illustration={<EmptyIllustration module="recorder" />}
            title={t('recorder.unsupported.title')}
            description={t('recorder.unsupported.desc')}
            action={
              <Button
                variant="primary"
                leading={<Camera size={18} aria-hidden />}
                onClick={() => usePrefs.getState().update({ mode: 'camera' })}
              >
                {t('recorder.unsupported.useCamera')}
              </Button>
            }
          />
        </div>
        <LibrarySection />
      </div>
    )
  } else {
    const v = view(stage)
    body = (
      <>
        {!screenOk && v === 'setup' && (
          <Callout tone="neutral" className="mb-4" icon={<MonitorX size={16} aria-hidden />}>
            {t('recorder.unsupported.desc')}
          </Callout>
        )}
        <motion.div layout transition={spring.smooth} data-stage={v}>
          <motion.div
            key={v}
            // 子層也加 layout，外層尺寸變化時 motion 會自動抵銷縮放，內容不會被拉伸
            layout="position"
            // 結果卡由 HUD 膠囊變形而來（layoutId），外層不再淡入以免蓋掉變形
            initial={v === 'result' ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.smooth}
          >
            {v === 'setup' && <SetupView formats={formats} format={format} library={library} />}
            {v === 'live' && <LiveView />}
            {v === 'result' && <ResultView library={library} />}
            {libraryAfter && v !== 'live' && <div className="mt-4">{libraryAfter}</div>}
          </motion.div>
        </motion.div>
      </>
    )
  }

  return (
    <ModulePage module="recorder" status={status}>
      <Stepper
        className="mb-5"
        current={stepIndex}
        steps={[t('recorder.steps.setup'), t('recorder.steps.record'), t('recorder.steps.done')]}
      />
      {body}
      <TitleIndicator />
      <CountdownOverlay />
      <Hud onKeys={onKey} />
      <p className="sr-only" aria-live="polite">
        {stage === 'recording'
          ? paused
            ? t('recorder.a11y.recordingPaused')
            : t('recorder.a11y.recordingStarted')
          : stage === 'result' && result
            ? t('recorder.a11y.recordingDone', { time: formatClock(result.duration * 1000) })
            : ''}
      </p>
    </ModulePage>
  )
}

/** 分頁標題顯示錄影狀態，切到別的分頁也看得到 */
function TitleIndicator() {
  const stage = useRecorder((s) => s.stage)
  const paused = useRecorder((s) => s.paused)
  const second = useRecorder((s) => Math.floor(s.elapsed / 1000))
  useEffect(() => {
    if (stage !== 'recording') return
    const base = document.title
    document.title = `${paused ? '❚❚' : '●'} ${formatClock(second * 1000).slice(0, -2)} · ${base}`
    return () => {
      document.title = base
    }
  }, [stage, second, paused])
  return null
}

function Unavailable({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="grid size-16 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
      {icon}
    </span>
  )
}
