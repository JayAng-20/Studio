import { AlertTriangle, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { AnimatedNumber, Button, Kbd } from '@/components/ui'
import { formatBytes, formatTime } from '@/lib/format'
import { modKey } from '@/lib/capabilities'
import { cn } from '@/lib/cn'
import { duration, sec, spring } from '@/design/motion'
import { useGT } from '../useGT'
import { useGifStore } from '../store'
import {
  BYTES_LIMIT,
  FRAME_LIMIT,
  headerBytes,
  overLimit,
  suggestFixes,
  type Suggestion,
} from '../estimate'
import { FPS_OPTIONS, type Fps } from '../timeline'
import { WIDTH_OPTIONS } from '../settings'
import type { EstimateState } from '../hooks'
import type { Geometry } from '../render'

interface Props {
  frames: number
  durationMs: number
  geom: Geometry
  estimate: EstimateState
  onStart: () => void
  disabled?: boolean
}

/** 即時預估：影格數、檔案大小、時長、尺寸；超過門檻時給具體建議（可一鍵套用） */
export function EstimateCard({ frames, durationMs, geom, estimate, onStart, disabled }: Props) {
  const t = useGT()
  const source = useGifStore((s) => s.source)
  const range = useGifStore((s) => s.range)
  const settings = useGifStore((s) => s.settings)
  const patch = useGifStore((s) => s.patch)
  const setRange = useGifStore((s) => s.setRange)
  const bytes = estimate.bytes
  const over = overLimit(frames, bytes)
  const warn = over.frames || over.bytes
  const suggestions = warn
    ? suggestFixes({
        frames,
        bytes,
        fps: settings.fps,
        width: geom.outW,
        height: geom.outH,
        rangeLength: source?.kind === 'video' ? range[1] - range[0] : null,
        fpsOptions: FPS_OPTIONS,
        widthOptions: WIDTH_OPTIONS,
        pingpong: settings.pingpong,
        stats: estimate.stats,
        header:
          settings.format === 'gif'
            ? 0
            : headerBytes(settings.format, settings.palette === 'global'),
      })
    : []

  const apply = (s: Suggestion) => {
    if (s.kind === 'fps') patch({ fps: s.value as Fps })
    else if (s.kind === 'width') patch({ width: s.value })
    else setRange([range[0], Math.round((range[0] + s.value) * 10) / 10])
  }
  const loading = estimate.status === 'loading' || (estimate.status === 'idle' && frames > 0)
  const formatLabel = t(`panel.formats.${settings.format}`).replace(/（.*）|\s*\(.*\)/, '')

  return (
    <section className="card flex flex-col gap-4 p-4" aria-labelledby="gif-estimate-title">
      <h3 id="gif-estimate-title" className="text-h3 font-semibold">
        {t('estimate.title')}
      </h3>
      <dl className="grid grid-cols-2 gap-3">
        <Stat label={t('estimate.frames')} warn={over.frames}>
          <AnimatedNumber value={frames} />
        </Stat>
        <Stat label={t('estimate.size')} warn={over.bytes} busy={loading}>
          {estimate.status === 'error' && !bytes ? (
            <span className="text-small text-text-3">{t('errors.estimateFailed')}</span>
          ) : bytes ? (
            <AnimatedNumber
              value={bytes}
              format={(v) => t('estimate.approx', { value: formatBytes(v) })}
            />
          ) : (
            <span className="text-small text-text-3">{t('estimate.calculating')}</span>
          )}
        </Stat>
        <Stat label={t('estimate.duration')}>
          <span className="tabular-nums">{formatTime(durationMs / 1000, { tenths: true })}</span>
        </Stat>
        <Stat label={t('estimate.dimensions')}>
          <span className="tabular-nums">
            {geom.outW}×{geom.outH}
          </span>
        </Stat>
      </dl>
      <p className="sr-only" aria-live="polite">
        {bytes ? t('estimate.live', { frames, size: formatBytes(bytes) }) : ''}
      </p>

      <AnimatePresence initial={false}>
        {warn && (
          <motion.div
            key="warn"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: sec(duration.fast) } }}
            transition={spring.smooth}
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-3 text-small"
          >
            <p className="flex items-center gap-2 font-semibold text-warning-ink">
              <AlertTriangle size={16} aria-hidden />
              {over.frames
                ? t('estimate.overFrames', { limit: FRAME_LIMIT })
                : t('estimate.overBytes', { limit: formatBytes(BYTES_LIMIT) })}
            </p>
            <p className="text-text-2">{t('estimate.overDesc')}</p>
            <ul className="flex flex-col gap-1.5">
              {suggestions.map((s) => (
                <li key={s.kind} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-text">
                    {s.kind === 'fps'
                      ? t('estimate.suggest.fps', {
                          value: s.value,
                          frames: s.frames,
                          size: formatBytes(s.bytes),
                        })
                      : s.kind === 'width'
                        ? t('estimate.suggest.width', {
                            value: s.value,
                            size: formatBytes(s.bytes),
                          })
                        : t('estimate.suggest.range', {
                            value: s.value.toFixed(1),
                            frames: s.frames,
                          })}
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => apply(s)}>
                    {t('actions.applySuggestion')}
                  </Button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      <Button
        variant="primary"
        size="lg"
        onClick={onStart}
        disabled={disabled || frames === 0}
        leading={<Sparkles size={18} aria-hidden />}
        className="w-full"
        aria-keyshortcuts="Control+Enter Meta+Enter"
      >
        {t('actions.start')} {formatLabel}
      </Button>
      <p className="-mt-2 flex items-center justify-center gap-1 text-caption text-text-3 max-sm:hidden">
        <Kbd>{modKey()}</Kbd>
        <Kbd>Enter</Kbd>
      </p>
    </section>
  )
}

function Stat({
  label,
  children,
  warn,
  busy,
}: {
  label: string
  children: React.ReactNode
  warn?: boolean
  busy?: boolean
}) {
  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col gap-0.5 overflow-hidden rounded-md bg-surface-2 px-3 py-2.5',
        warn && 'ring-1 ring-[color-mix(in_srgb,var(--warning)_45%,transparent)]',
      )}
    >
      <dt className="text-caption text-text-3">{label}</dt>
      <dd
        className={cn(
          'truncate text-h3 font-semibold',
          warn ? 'text-warning-ink' : 'text-text',
          busy && 'opacity-60',
        )}
      >
        {children}
      </dd>
      {busy && (
        <span aria-hidden className="pointer-events-none absolute inset-0">
          <span className="shimmer block size-full" />
        </span>
      )}
    </div>
  )
}
