/** 錄製中畫面：即時預覽、統計、標記，右側為聲音與提示 */
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { Flag, Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import type { ReactNode } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { AnimatedNumber, Badge, Button, Callout, Panel } from '@/components/ui'
import { spring } from '@/design/motion'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { formatBitrate, formatClock, SIZE_LIMIT_BYTES } from './core'
import { getAnalysers, getPreviewStream, setLiveBubble, toggleMute, useRecorder } from './engine'
import { LevelMeter, StreamVideo } from './media'
import { usePrefs } from './prefs'
import { BubbleEditor } from './BubbleEditor'
import { formatLabel } from './Setup'
import { listFormatsCached } from './formats'

export function LiveView() {
  const t = useT()
  const stage = useRecorder((s) => s.stage)
  const live = useRecorder((s) => s.live)
  const paused = useRecorder((s) => s.paused)
  const level = useRecorder((s) => s.sizeLevel)
  const markers = useRecorder((s) => s.markers)
  const muted = useRecorder((s) => s.micMuted)
  const version = useRecorder((s) => s.previewVersion)
  const bubble = usePrefs((s) => s.bubble)
  const w = live?.width || 16
  const h = live?.height || 9
  const fmt = listFormatsCached().find((f) => f.mime === live?.mime)
  const analysers = getAnalysers()
  const recording = stage === 'recording'

  const main = (
    // 底部留白：讓內容可以捲到浮動 HUD 上方
    <div className="flex flex-col gap-4 lg:pb-20">
      <div className="card overflow-hidden">
        <div className="bg-[#0b0d12]">
          <div
            className="relative mx-auto max-w-full"
            style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, calc(62dvh * ${w / h}))` }}
          >
            <StreamVideo
              key={version}
              stream={getPreviewStream()}
              mirror={live?.mode === 'camera' && bubble.mirror}
              label={t('recorder.live.previewLabel')}
              className="absolute inset-0 size-full object-contain"
            />
            {live?.bubble && recording && (
              <BubbleEditor
                ghost
                stream={null}
                bubble={bubble}
                onChange={setLiveBubble}
                onCommit={(b) => {
                  setLiveBubble(b)
                  usePrefs.getState().update({ bubble: b })
                }}
              />
            )}
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
              <span className="flex h-7 items-center gap-1.5 rounded-full bg-black/55 px-2.5 text-caption font-semibold text-white backdrop-blur-md">
                <span
                  aria-hidden
                  className={cn('size-2 rounded-full', paused ? 'bg-white/60' : 'motion-decor bg-danger')}
                  style={paused ? undefined : { animation: 'breathe 1.6s ease-in-out infinite' }}
                />
                {paused ? t('recorder.live.paused') : t('recorder.live.rec')}
              </span>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          <Stat label={t('recorder.live.elapsed')} sub={paused ? t('recorder.live.paused') : undefined}>
            <LiveClock />
          </Stat>
          <Stat
            label={t('recorder.live.size')}
            sub={level === 'ok' ? undefined : t('recorder.warn.sizeBadge')}
          >
            <LiveBytes />
          </Stat>
          <Stat label={t('recorder.live.resolution')} sub={`${live?.fps ?? 30} fps`}>
            <span className="tabular-nums">{live ? `${live.width}×${live.height}` : '—'}</span>
          </Stat>
          <Stat label={t('recorder.live.format')} sub={formatBitrate(live?.videoBps ?? 0)}>
            <span className="truncate">{fmt ? t(formatLabel(fmt).label) : '—'}</span>
          </Stat>
        </dl>
      </div>

      <section className="card p-4" aria-labelledby="rec-markers">
        <h3 id="rec-markers" className="mb-3 flex items-center gap-2 text-h3 font-semibold">
          <Flag size={16} className="text-accent-ink" aria-hidden />
          {t('recorder.live.markers')}
          {markers.length > 0 && <Badge tone="accent">{markers.length}</Badge>}
        </h3>
        {markers.length === 0 ? (
          <p className="text-small text-text-3">{t('recorder.live.markersEmpty')}</p>
        ) : (
          <LayoutGroup>
            <ul className="flex flex-wrap gap-2">
              <AnimatePresence initial={false}>
                {markers.map((m, i) => (
                  <motion.li
                    key={m.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={spring.bouncy}
                    className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-2 pl-2.5 pr-3 text-small"
                  >
                    <Flag size={13} className="text-accent-ink" aria-hidden />
                    <span className="font-medium">{t('recorder.result.markerLabel', { n: i + 1 })}</span>
                    <span className="tabular-nums text-text-3">{formatClock(m.t * 1000)}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </LayoutGroup>
        )}
      </section>
    </div>
  )

  const panel = (
    <>
      {level !== 'ok' && (
        <Callout tone="warning" title={t('recorder.warn.sizeTitle', { size: formatBytes(useRecorder.getState().bytes) })}>
          {t('recorder.warn.sizeDesc', { limit: formatBytes(SIZE_LIMIT_BYTES) })}
        </Callout>
      )}
      <Panel title={t('recorder.live.audio')}>
        {!live?.hasMic && !live?.hasSystemAudio && (
          <p className="flex items-center gap-2 text-small text-text-3">
            <VolumeX size={16} aria-hidden />
            {t('recorder.live.noAudio')}
          </p>
        )}
        {live?.hasMic && (
          <MeterRow
            icon={muted ? <MicOff size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
            label={t('recorder.audio.mic')}
            analyser={analysers.mic}
            muted={muted}
            action={
              <Button size="sm" variant={muted ? 'danger' : 'secondary'} onClick={toggleMute}>
                {muted ? t('recorder.hud.unmute') : t('recorder.hud.mute')}
              </Button>
            }
          />
        )}
        {live?.hasSystemAudio && (
          <MeterRow
            icon={<Volume2 size={16} aria-hidden />}
            label={t('recorder.audio.system')}
            analyser={analysers.system}
          />
        )}
      </Panel>
      <Panel title={t('recorder.live.tipsTitle')}>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-small text-text-2 marker:text-text-3">
          <li>{t('recorder.live.tip1')}</li>
          <li>{t('recorder.live.tip2')}</li>
          <li>{t('recorder.live.tip3')}</li>
        </ul>
      </Panel>
      {/* 手機版：面板在下方，同樣留出 HUD 的空間 */}
      <div aria-hidden className="h-16 lg:hidden" />
    </>
  )

  return <Workspace main={main} panel={panel} />
}

/** 計時與大小各自訂閱，避免整個畫面每 0.1 秒重繪 */
function LiveClock() {
  const elapsed = useRecorder((s) => s.elapsed)
  return <span className="tabular-nums">{formatClock(elapsed)}</span>
}

function LiveBytes() {
  const bytes = useRecorder((s) => s.bytes)
  return <AnimatedNumber value={bytes} format={(v) => formatBytes(v)} />
}

function Stat({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3">
      <dt className="text-caption text-text-3">{label}</dt>
      <dd className="m-0 flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center text-body font-medium">{children}</span>
        {sub && <span className="text-caption tabular-nums text-text-3">{sub}</span>}
      </dd>
    </div>
  )
}

function MeterRow({
  icon,
  label,
  analyser,
  muted,
  action,
}: {
  icon: ReactNode
  label: string
  analyser: AnalyserNode | null
  muted?: boolean
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-small font-medium text-text-2">
          {icon}
          {label}
        </span>
        {action}
      </div>
      <div className="rounded-md bg-surface-2 px-3 py-2">
        <LevelMeter analyser={analyser} muted={muted} bars={24} className="h-7 justify-between" />
      </div>
    </div>
  )
}
