/** 檔案卡：縮圖（blur-up）、前後大小、狀態（流動色光 → 綠色勾）、動作 */
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
  ArrowRight,
  Columns2,
  Download,
  Info,
  MoreHorizontal,
  RotateCcw,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router'
import {
  Button,
  FileName,
  Menu,
  Popover,
  ProgressBar,
  Tooltip,
  toast,
  type MenuItem,
} from '@/components/ui'
import { useFlyIn } from '@/components/ui'
import { duration, sec, spring } from '@/design/motion'
import { formatBytes, percentChange } from '@/lib/format'
import { downloadBlob } from '@/lib/download'
import { cn } from '@/lib/cn'
import { moduleById } from '@/config/modules'
import { asFile, useFileBus } from '@/stores/fileBus'
import { useT } from '@/i18n'
import { maxPixels, useConvert, type ConvertItem } from '../store'
import { FORMATS } from '../types'
import { sourceLabel, useErrorText, useWarningText } from '../texts'
import { BlurImage, DoneCheck, SavingsBadge } from './bits'

export function ItemCard({
  item,
  freshKey,
  onCompare,
  onRetry,
}: {
  item: ConvertItem
  freshKey: string
  onCompare: (id: string) => void
  onRetry: (id: string) => void
}) {
  const t = useT()
  const nav = useNavigate()
  const fly = useFlyIn<HTMLDivElement>()
  const remove = useConvert((s) => s.remove)
  const markDelivered = useConvert((s) => s.markDelivered)
  const busy = useConvert((s) => s.running)
  const send = useFileBus((s) => s.send)
  const errorText = useErrorText()
  const warningText = useWarningText()

  const { status, result, probe } = item
  const running = status === 'running'
  const queued = status === 'queued'
  const done = status === 'done' && !!result
  const stale = done && result.key !== freshKey
  const pct = done ? percentChange(item.size, result.size) : 0
  const dims = probe?.width && probe?.height ? `${probe.width}×${probe.height}` : null
  const px = probe?.width && probe?.height ? probe.width * probe.height : 0
  const huge = px > maxPixels()
  const fit =
    probe?.alpha || probe?.format === 'svg' || probe?.format === 'ico' ? 'contain' : 'cover'
  const canCompare = done && result.format !== 'ico'
  const err = status === 'error' && item.error ? errorText(item.error, result?.format ?? '') : null
  const notes = done
    ? result.warnings.map((w) => warningText(w, result.format)).filter(Boolean)
    : []

  const download = () => {
    if (!result) return
    downloadBlob(result.blob, result.name)
    markDelivered()
  }
  const sendToTools = () => {
    if (!result) return
    send('tools', 'convert', [asFile(result.blob, result.name)])
    markDelivered()
    toast.success(t('common.sentTo', { target: t(moduleById.tools.nameKey) }))
    nav(moduleById.tools.path)
  }

  const menu: MenuItem[] = [
    ...(canCompare
      ? [
          {
            key: 'cmp',
            label: t('convert.card.compare'),
            icon: <Columns2 size={16} aria-hidden />,
            onSelect: () => onCompare(item.id),
          },
        ]
      : []),
    ...(done
      ? [
          {
            key: 'dl',
            label: t('common.download'),
            icon: <Download size={16} aria-hidden />,
            onSelect: download,
          },
          {
            key: 'send',
            label: t('convert.card.sendTools', { target: t(moduleById.tools.nameKey) }),
            icon: <Send size={16} aria-hidden />,
            onSelect: sendToTools,
          },
          {
            key: 'redo',
            label: t('convert.card.reconvert'),
            icon: <RotateCcw size={16} aria-hidden />,
            onSelect: () => onRetry(item.id),
            disabled: busy,
          },
        ]
      : []),
    {
      key: 'rm',
      label: t('common.remove'),
      icon: <Trash2 size={16} aria-hidden />,
      onSelect: () => remove(item.id),
      danger: true,
    },
  ]

  return (
    <div
      ref={fly}
      data-running={running}
      className={cn(
        'cv-card card relative flex h-full items-center gap-3 p-2.5 pr-2',
        'transition-shadow duration-(--dur-base)',
      )}
    >
      <AnimatePresence>
        {running && (
          <motion.span
            key="ring"
            aria-hidden
            className="flow-ring motion-decor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: sec(duration.slow) } }}
          />
        )}
      </AnimatePresence>

      {/* 縮圖：完成後點擊開啟前後對比 */}
      <div className="relative shrink-0">
        <button
          type="button"
          disabled={!canCompare}
          onClick={() => onCompare(item.id)}
          aria-label={canCompare ? t('convert.card.compareOf', { name: item.name }) : item.name}
          className={cn(
            'cv-checker relative block size-[72px] overflow-hidden rounded-md border border-border sm:size-20',
            canCompare && 'cursor-zoom-in',
            'disabled:cursor-default',
          )}
        >
          {item.thumbState === 'error' ? (
            <span className="absolute inset-0 grid place-items-center bg-surface-2 text-text-3">
              <AlertTriangle size={20} aria-hidden />
            </span>
          ) : (
            <BlurImage src={item.thumb?.url} fit={fit} className="absolute inset-0" />
          )}
          <AnimatePresence>
            {(running || queued) && (
              <motion.span
                key="veil"
                className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--surface)_45%,transparent)]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: sec(duration.base) }}
              />
            )}
          </AnimatePresence>
          <span className="pointer-events-none absolute left-1 top-1 rounded-xs bg-black/55 px-1 text-[10px] font-semibold uppercase leading-4 tracking-wide text-white">
            {sourceLabel(probe?.format, item.name)}
          </span>
        </button>
        <AnimatePresence>
          {done && !stale && (
            <motion.span
              key="check"
              className="absolute -bottom-1.5 -right-1.5 rounded-full ring-2 ring-surface"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={spring.bouncy}
            >
              <DoneCheck id={`${item.id}:${result.at}`} size={22} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <FileName name={item.name} className="text-body font-medium text-text" />
        <p className="truncate text-caption text-text-3">
          {[dims, formatBytes(item.size)].filter(Boolean).join(' · ')}
          {huge && !done && (
            <span className="text-warning-ink">
              {' '}
              · {t('convert.card.huge', { mp: Math.round(px / 1e6) })}
            </span>
          )}
        </p>
        <div className="min-h-6" aria-live="polite">
          {running || queued ? (
            <div className="flex items-center gap-2">
              <ProgressBar
                value={queued || item.progress < 0.03 ? null : item.progress}
                size="sm"
                className="flex-1"
                label={t('convert.card.progressOf', { name: item.name })}
              />
              <span className="w-10 shrink-0 text-right text-caption tabular-nums text-text-2">
                {queued
                  ? t('convert.card.queued')
                  : item.progress < 0.03
                    ? ''
                    : `${Math.round(item.progress * 100)}%`}
              </span>
            </div>
          ) : done ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  'inline-flex min-w-0 items-center gap-1 text-small tabular-nums',
                  stale ? 'text-text-3' : 'text-text',
                )}
              >
                <ArrowRight size={13} className="shrink-0 text-text-3" aria-hidden />
                <span className="font-semibold">{FORMATS[result.format].ext.toUpperCase()}</span>
                <span className="truncate text-text-2">
                  {result.width}×{result.height} · {formatBytes(result.size)}
                  {result.frames && result.frames > 1
                    ? ` · ${t('convert.card.frames', { count: result.frames })}`
                    : ''}
                </span>
              </span>
              {stale ? (
                <span className="text-caption text-text-3">{t('convert.card.stale')}</span>
              ) : (
                <SavingsBadge pct={pct} onceKey={`${item.id}:${result.at}`} />
              )}
              {notes.length > 0 && !stale && (
                <Popover
                  label={t('convert.card.notes')}
                  className="w-72"
                  trigger={
                    <button
                      type="button"
                      aria-label={t('convert.card.notes')}
                      className="grid size-6 place-items-center rounded-full text-warning-ink hover:bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] max-sm:size-9"
                    >
                      <Info size={15} aria-hidden />
                    </button>
                  }
                >
                  <ul className="flex flex-col gap-2 text-small text-text-2">
                    {notes.map((n) => (
                      <li key={n} className="flex gap-2">
                        <Info size={14} className="mt-0.5 shrink-0 text-warning-ink" aria-hidden />
                        <span>{n}</span>
                      </li>
                    ))}
                  </ul>
                </Popover>
              )}
            </div>
          ) : err ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <AlertTriangle size={14} className="shrink-0 text-danger-ink" aria-hidden />
              <Popover
                label={err.title}
                className="w-72"
                trigger={
                  <button
                    type="button"
                    className="min-w-0 truncate rounded-xs text-left text-small text-danger-ink underline decoration-dotted underline-offset-2"
                  >
                    {err.title}
                  </button>
                }
              >
                <p className="text-small font-semibold text-text">{err.title}</p>
                <p className="mt-1 text-small text-text-2">{err.desc}</p>
              </Popover>
            </div>
          ) : (
            <span className="text-small text-text-3">{t('convert.card.ready')}</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 self-center">
        {err && item.thumbState !== 'error' && (
          <Tooltip content={t('common.retry')}>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={t('convert.card.retryOf', { name: item.name })}
              onClick={() => onRetry(item.id)}
              className="max-sm:size-11"
            >
              <RotateCcw size={16} aria-hidden />
            </Button>
          </Tooltip>
        )}
        {done && (
          <Tooltip content={t('common.download')}>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={t('convert.card.downloadOf', { name: result.name })}
              onClick={download}
              className="text-accent-ink max-sm:size-11"
            >
              <Download size={17} aria-hidden />
            </Button>
          </Tooltip>
        )}
        {done ? (
          <Menu
            label={t('common.more')}
            items={menu}
            trigger={
              <Button
                variant="ghost"
                size="sm"
                icon
                aria-label={t('convert.card.moreOf', { name: item.name })}
                className="max-sm:size-11"
              >
                <MoreHorizontal size={17} aria-hidden />
              </Button>
            }
          />
        ) : (
          <Tooltip content={t('common.remove')}>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={t('convert.card.removeOf', { name: item.name })}
              onClick={() => remove(item.id)}
              className="hover:text-danger-ink max-sm:size-11"
            >
              <X size={17} aria-hidden />
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
