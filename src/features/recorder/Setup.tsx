/** 準備畫面：來源說明、鏡頭泡泡預覽、開始按鈕，以及右側設定面板 */
import { AnimatePresence, motion } from 'motion/react'
import { AppWindow, Camera, CircleDot, Mic, Monitor, PanelsTopLeft, Volume2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import {
  Badge,
  Button,
  Callout,
  Kbd,
  Panel,
  SegmentedControl,
  Select,
  SliderField,
  Switch,
} from '@/components/ui'
import { duration, easing, sec, spring, staggerDelay } from '@/design/motion'
import { useT, type TKey } from '@/i18n'
import { caps } from '@/lib/capabilities'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { useSettings } from '@/stores/settings'
import {
  BUBBLE_MAX,
  BUBBLE_MIN,
  estimateBytesPerMinute,
  formatBitrate,
  audioBitrate,
  videoBitrate,
  type AvailableFormat,
  type FormatId,
  type Quality,
} from './core'
import { beginRecording, clearError, mediaErrorMessage, useRecorder } from './engine'
import { useCameraPreview, useDevices, useMicPreview, usePermission } from './hooks'
import { LevelMeter, StreamVideo } from './media'
import { currentPrefs, usePrefs } from './prefs'
import { BubbleEditor } from './BubbleEditor'

export const qualityKey: Record<Quality, TKey> = {
  standard: 'recorder.video.qualityStandard',
  high: 'recorder.video.qualityHigh',
  ultra: 'recorder.video.qualityUltra',
}

export function formatLabel(f: Pick<AvailableFormat, 'id' | 'h264'>): { label: TKey; hint: TKey } {
  switch (f.id) {
    case 'mp4':
      return f.h264
        ? { label: 'recorder.video.formatMp4', hint: 'recorder.video.hintMp4' }
        : { label: 'recorder.video.formatMp4Generic', hint: 'recorder.video.hintMp4Generic' }
    case 'webm-vp9':
      return { label: 'recorder.video.formatVp9', hint: 'recorder.video.hintVp9' }
    case 'webm-vp8':
      return { label: 'recorder.video.formatVp8', hint: 'recorder.video.hintVp8' }
    default:
      return { label: 'recorder.video.formatAv1', hint: 'recorder.video.hintAv1' }
  }
}

export function SetupView({
  formats,
  format,
  library,
}: {
  formats: AvailableFormat[]
  format: AvailableFormat
  library: ReactNode
}) {
  const t = useT()
  const prefs = usePrefs()
  const stage = useRecorder((s) => s.stage)
  const error = useRecorder((s) => s.error)
  const libraryOn = useSettings((s) => s.recorderLibrary)
  const setSettings = useSettings((s) => s.set)
  const screenOk = caps.displayMedia()
  const mode = screenOk ? prefs.mode : 'camera'
  const inSetup = stage === 'setup'

  // 權限已允許時直接開預覽；否則等使用者主動開啟，避免一進頁面就跳出權限詢問
  const micPerm = usePermission('microphone')
  const camPerm = usePermission('camera')
  const [micAsked, setMicAsked] = useState(false)
  const [camAsked, setCamAsked] = useState(false)
  const wantCam = mode === 'camera' || prefs.camera
  const mic = useMicPreview(
    inSetup && prefs.mic && (micPerm === 'granted' || micAsked),
    prefs.micDeviceId,
  )
  const cam = useCameraPreview(
    inSetup && wantCam && (camPerm === 'granted' || camAsked),
    prefs.cameraDeviceId,
  )
  const mics = useDevices('audioinput', !!mic.analyser)
  const cams = useDevices('videoinput', !!cam.stream)

  const start = () => {
    void beginRecording({ ...currentPrefs(), mode }, format)
  }

  // Radix Select 不接受空字串，用哨兵值代表「系統預設」（偏好設定裡存空字串）
  const deviceOptions = (list: MediaDeviceInfo[]) => [
    { value: SYSTEM_DEVICE, label: t('recorder.audio.deviceDefault') },
    ...list
      .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({
        value: d.deviceId,
        label: d.label || t('recorder.audio.deviceN', { n: i + 1 }),
      })),
  ]
  const toSelect = (id: string, list: MediaDeviceInfo[]) =>
    id && list.some((d) => d.deviceId === id) ? id : SYSTEM_DEVICE
  const fromSelect = (v: string) => (v === SYSTEM_DEVICE ? '' : v)

  const vbps = videoBitrate(prefs.quality, prefs.fps, { width: 1920, height: 1080 })
  const perMin = estimateBytesPerMinute(vbps, audioBitrate(prefs.quality))
  const fmtText = t(formatLabel(format).label)

  const main = (
    <div className="flex flex-col gap-4">
      <AnimatePresence initial={false}>
        {error && (
          <motion.div
            key="err"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={spring.smooth}
          >
            <Callout
              tone="danger"
              title={t('recorder.errors.title')}
              action={
                <Button
                  icon
                  size="sm"
                  variant="ghost"
                  aria-label={t('common.close')}
                  onClick={clearError}
                >
                  <X size={16} aria-hidden />
                </Button>
              }
            >
              {error === 'recorder' || error === 'empty'
                ? t(`recorder.errors.${error}`)
                : mediaErrorMessage(error, mode === 'camera' ? 'camera' : 'screen')}
            </Callout>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card overflow-hidden">
        <div
          className={cn(
            'relative isolate overflow-hidden bg-surface-2',
            'sm:aspect-video',
            mode === 'camera' ? 'aspect-[4/3]' : 'min-h-[300px]',
          )}
        >
          <StageBackdrop />
          {mode === 'screen' ? (
            <>
              <SourceExplainer />
              <AnimatePresence>
                {prefs.camera && (
                  <BubbleEditor
                    key="bubble"
                    stream={cam.stream}
                    loading={cam.loading}
                    bubble={prefs.bubble}
                    onCommit={(b) => usePrefs.getState().update({ bubble: b })}
                  />
                )}
              </AnimatePresence>
            </>
          ) : (
            <CameraStage
              stream={cam.stream}
              loading={cam.loading}
              mirror={prefs.bubble.mirror}
              onAllow={() => setCamAsked(true)}
              needsAllow={camPerm !== 'granted' && !camAsked}
            />
          )}
        </div>
        <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center">
          <Button
            variant="primary"
            size="lg"
            className="w-full sm:w-auto"
            leading={<CircleDot size={20} aria-hidden />}
            loading={stage === 'acquiring'}
            onClick={start}
            aria-keyshortcuts="R"
          >
            {mode === 'camera' ? t('recorder.stage.startCamera') : t('recorder.stage.start')}
          </Button>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-small text-text-2">
            <span className="mr-1 tabular-nums">
              {t('recorder.stage.summary', {
                fps: prefs.fps,
                quality: t(qualityKey[prefs.quality]),
                format: fmtText,
              })}
            </span>
            {prefs.mic && (
              <Badge icon={<Mic size={12} aria-hidden />}>{t('recorder.stage.summaryMic')}</Badge>
            )}
            {mode === 'screen' && prefs.systemAudio && (
              <Badge icon={<Volume2 size={12} aria-hidden />}>
                {t('recorder.stage.summarySystem')}
              </Badge>
            )}
            {mode === 'screen' && prefs.camera && (
              <Badge icon={<Camera size={12} aria-hidden />}>
                {t('recorder.stage.summaryBubble')}
              </Badge>
            )}
          </div>
          <span className="hidden items-center gap-1.5 text-caption text-text-3 lg:inline-flex">
            <Kbd>R</Kbd>
          </span>
        </div>
        <p className="sr-only" aria-live="polite">
          {stage === 'acquiring' ? t('recorder.stage.acquiring') : ''}
        </p>
      </div>
      {library}
    </div>
  )

  const panel = (
    <>
      <Panel title={t('recorder.mode.label')}>
        <SegmentedControl
          full
          label={t('recorder.mode.label')}
          value={mode}
          onChange={(v) => usePrefs.getState().update({ mode: v })}
          options={[
            {
              value: 'screen',
              label: (
                <>
                  <Monitor size={15} aria-hidden />
                  {t('recorder.mode.screen')}
                </>
              ),
              disabled: !screenOk,
              title: screenOk ? undefined : t('recorder.unsupported.title'),
            },
            {
              value: 'camera',
              label: (
                <>
                  <Camera size={15} aria-hidden />
                  {t('recorder.mode.camera')}
                </>
              ),
              disabled: !caps.userMedia(),
            },
          ]}
        />
      </Panel>

      <Panel title={t('recorder.audio.title')}>
        {mode === 'screen' && (
          <Switch
            label={t('recorder.audio.system')}
            description={t('recorder.audio.systemDesc')}
            checked={prefs.systemAudio}
            onChange={(v) => usePrefs.getState().update({ systemAudio: v })}
          />
        )}
        <Switch
          label={t('recorder.audio.mic')}
          description={t('recorder.audio.micDesc')}
          checked={prefs.mic}
          disabled={!caps.userMedia()}
          onChange={(v) => {
            usePrefs.getState().update({ mic: v })
            if (v) setMicAsked(true)
          }}
        />
        <AnimatePresence initial={false}>
          {prefs.mic && (
            <motion.div
              key="mic"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6, transition: fade }}
              transition={spring.smooth}
              className="flex flex-col gap-3"
            >
              <Select
                label={t('recorder.audio.micDevice')}
                value={toSelect(prefs.micDeviceId, mics)}
                onChange={(v) => usePrefs.getState().update({ micDeviceId: fromSelect(v) })}
                options={deviceOptions(mics)}
              />
              <div className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2.5">
                <Mic size={16} className="shrink-0 text-text-3" aria-hidden />
                <LevelMeter analyser={mic.analyser} bars={20} className="h-7 flex-1" />
              </div>
              {mic.error ? (
                <Callout tone="danger">{mediaErrorMessage(mic.error, 'mic')}</Callout>
              ) : micPerm !== 'granted' && !micAsked ? (
                <Button variant="secondary" size="sm" onClick={() => setMicAsked(true)}>
                  {t('recorder.audio.allow')}
                </Button>
              ) : (
                <p className="text-caption text-text-3">{t('recorder.audio.testHint')}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Panel>

      <Panel title={mode === 'screen' ? t('recorder.camera.title') : t('recorder.camera.device')}>
        {mode === 'screen' && (
          <Switch
            label={t('recorder.camera.bubble')}
            description={t('recorder.camera.bubbleDesc')}
            checked={prefs.camera}
            disabled={!caps.userMedia()}
            onChange={(v) => {
              usePrefs.getState().update({ camera: v })
              if (v) setCamAsked(true)
            }}
          />
        )}
        <AnimatePresence initial={false}>
          {wantCam && (
            <motion.div
              key="cam"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6, transition: fade }}
              transition={spring.smooth}
              className="flex flex-col gap-4"
            >
              <Select
                label={t('recorder.camera.device')}
                value={toSelect(prefs.cameraDeviceId, cams)}
                onChange={(v) => usePrefs.getState().update({ cameraDeviceId: fromSelect(v) })}
                options={deviceOptions(cams)}
              />
              {mode === 'screen' && (
                <SliderField
                  label={t('recorder.camera.size')}
                  min={Math.round(BUBBLE_MIN * 100)}
                  max={Math.round(BUBBLE_MAX * 100)}
                  value={Math.round(prefs.bubble.size * 100)}
                  format={(v) => `${v}%`}
                  onChange={(v) =>
                    usePrefs.getState().update({ bubble: { ...prefs.bubble, size: v / 100 } })
                  }
                  hint={t('recorder.stage.bubbleHint')}
                />
              )}
              <Switch
                label={t('recorder.camera.mirror')}
                description={t('recorder.camera.mirrorDesc')}
                checked={prefs.bubble.mirror}
                onChange={(v) =>
                  usePrefs.getState().update({ bubble: { ...prefs.bubble, mirror: v } })
                }
              />
              {cam.error && (
                <Callout tone="danger">{mediaErrorMessage(cam.error, 'camera')}</Callout>
              )}
              {!cam.error && camPerm !== 'granted' && !camAsked && (
                <Button variant="secondary" size="sm" onClick={() => setCamAsked(true)}>
                  {t('recorder.camera.allow')}
                </Button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Panel>

      <Panel title={t('recorder.video.title')}>
        <div className="flex flex-col gap-1.5">
          <span className="label mb-0!">{t('recorder.video.fps')}</span>
          <SegmentedControl
            full
            label={t('recorder.video.fps')}
            value={String(prefs.fps) as '30' | '60'}
            onChange={(v) => usePrefs.getState().update({ fps: v === '60' ? 60 : 30 })}
            options={[
              { value: '30', label: '30 fps' },
              { value: '60', label: '60 fps' },
            ]}
          />
          <p className="text-caption text-text-3">{t('recorder.video.fpsHint')}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="label mb-0!">{t('recorder.video.quality')}</span>
          <SegmentedControl
            full
            label={t('recorder.video.quality')}
            value={prefs.quality}
            onChange={(v) => usePrefs.getState().update({ quality: v })}
            options={(['standard', 'high', 'ultra'] as const).map((q) => ({
              value: q,
              label: t(qualityKey[q]),
            }))}
          />
          <p className="text-caption text-text-3 tabular-nums">
            {t('recorder.video.qualityHint', {
              bitrate: formatBitrate(vbps),
              size: formatBytes(perMin),
            })}
          </p>
        </div>
        <Select<FormatId>
          label={t('recorder.video.format')}
          value={format.id}
          onChange={(v) => usePrefs.getState().update({ format: v })}
          options={formats.map((f) => ({
            value: f.id,
            label: t(formatLabel(f).label),
            hint: t(formatLabel(f).hint),
          }))}
        />
      </Panel>

      <Panel title={t('recorder.options.title')}>
        <Switch
          label={t('recorder.options.countdown')}
          description={t('recorder.options.countdownDesc')}
          checked={prefs.countdown}
          onChange={(v) => usePrefs.getState().update({ countdown: v })}
        />
        <Switch
          label={t('recorder.options.library')}
          description={t('recorder.options.libraryDesc')}
          checked={libraryOn}
          onChange={(v) => setSettings({ recorderLibrary: v })}
        />
      </Panel>
    </>
  )

  return <Workspace main={main} panel={panel} />
}

const SYSTEM_DEVICE = 'system-default'

const fade = { duration: sec(duration.fast), ease: easing.standard }

/** 預覽框背景：淡淡的模組色光與點陣，像一張空白的桌面 */
function StageBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 85% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%), radial-gradient(90% 80% at 0% 100%, color-mix(in srgb, var(--accent-2) 10%, transparent), transparent 60%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'radial-gradient(color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
    </div>
  )
}

const SOURCES = [
  { icon: Monitor, label: 'recorder.stage.screen', desc: 'recorder.stage.screenDesc' },
  { icon: AppWindow, label: 'recorder.stage.window', desc: 'recorder.stage.windowDesc' },
  { icon: PanelsTopLeft, label: 'recorder.stage.tab', desc: 'recorder.stage.tabDesc' },
] as const

/** 三種擷取來源的圖示說明（實際由瀏覽器選擇器決定） */
function SourceExplainer() {
  const t = useT()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-5 py-8 text-center sm:px-8">
      <div className="max-w-xl">
        <h2 className="text-h3 font-semibold text-text">{t('recorder.stage.title')}</h2>
        <p className="mt-1 text-small text-text-2">{t('recorder.stage.desc')}</p>
      </div>
      <ul className="grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
        {SOURCES.map((s, i) => (
          <motion.li
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.smooth, delay: staggerDelay(i, 0.05) }}
            className="flex items-center gap-3 rounded-lg border border-border bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] p-3 text-left shadow-e1 backdrop-blur-sm sm:flex-col sm:items-center sm:gap-2 sm:p-4 sm:text-center"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
              <s.icon size={22} strokeWidth={1.8} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-body font-medium text-text">{t(s.label)}</span>
              <span className="block text-caption text-text-3">{t(s.desc)}</span>
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

function CameraStage({
  stream,
  loading,
  mirror,
  needsAllow,
  onAllow,
}: {
  stream: MediaStream | null
  loading: boolean
  mirror: boolean
  needsAllow: boolean
  onAllow: () => void
}) {
  const t = useT()
  if (stream) {
    return (
      <StreamVideo
        stream={stream}
        mirror={mirror}
        label={t('recorder.stage.cameraTitle')}
        className="absolute inset-0 size-full bg-black object-cover"
      />
    )
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <span
        className={cn(
          'grid size-14 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink',
          loading && 'shimmer',
        )}
      >
        <Camera size={26} aria-hidden />
      </span>
      <div>
        <h2 className="text-h3 font-semibold">{t('recorder.stage.cameraTitle')}</h2>
        <p className="mt-1 max-w-sm text-small text-text-2">
          {needsAllow ? t('recorder.stage.cameraDesc') : t('recorder.stage.cameraOff')}
        </p>
      </div>
      {needsAllow && (
        <Button variant="secondary" onClick={onAllow} leading={<Camera size={16} aria-hidden />}>
          {t('recorder.stage.cameraAllow')}
        </Button>
      )}
    </div>
  )
}
