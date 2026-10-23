/** 壓縮：格式、品質或目標大小、即時預估大小、PNG 建議改 WebP、前後對比 */
import { AlertTriangle, Lightbulb } from 'lucide-react'
import {
  AnimatedNumber,
  Badge,
  Button,
  Callout,
  NumberField,
  SegmentedControl,
  Select,
  SliderField,
  Spinner,
  Switch,
} from '@/components/ui'
import { formatBytes, percentChange } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { DEFAULT_REENCODE_QUALITY } from '../lib/export'
import { containerMime, effectiveMime, pixelsChanged } from '../lib/state'
import type { CompressMode, OutputFormat, OutputSpec } from '../lib/types'
import { getEncodable, processAllAfterApply } from '../actions'
import { useEstimate } from '../estimate'
import { useTools } from '../store'
import { Section, useEditor, useViewStore } from '../ui'
import { ApplyAllButton } from './common'

const FORMAT_NAME: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/avif': 'AVIF',
  'image/gif': 'GIF',
  'image/bmp': 'BMP',
}
export const formatName = (m: string | null | undefined, fallback = '—') =>
  (m && FORMAT_NAME[m]) || fallback

const TARGETS = [100, 200, 500, 1024]

export function CompressPanel() {
  const t = useT()
  const { doc, state, edit } = useEditor()
  const docCount = useTools((s) => s.docs.length)
  const est = useEstimate()
  const compare = useViewStore((s) => s.compare)
  const setCompare = useViewStore((s) => s.setCompare)
  if (!doc || !state) return null
  const o = state.output
  const encodable = getEncodable()
  const mime = effectiveMime(o.format, doc.container, encodable)
  const isPng = mime === 'image/png'
  const set = (patch: Partial<OutputSpec>, label: string, coalesce?: string) =>
    edit(label, (s) => ({ ...s, output: { ...s.output, ...patch } }), coalesce)

  const origFmt = formatName(containerMime(doc.container), doc.container.toUpperCase())
  const formats: Array<{ value: OutputFormat; label: string; disabled?: boolean; hint?: string }> =
    [
      { value: 'original', label: t('tools.compress.formatOriginal', { fmt: origFmt }) },
      ...(['image/jpeg', 'image/webp', 'image/png', 'image/avif'] as const).map((m) => ({
        value: m,
        label: FORMAT_NAME[m],
        disabled: !encodable.has(m),
        hint: encodable.has(m)
          ? undefined
          : t('tools.compress.formatUnsupported', { fmt: FORMAT_NAME[m] }),
      })),
    ]

  const mine = est.docId === doc.id && est.status !== 'idle'
  const running = mine && est.status === 'running'
  const size = mine && est.size ? est.size : 0
  const change = size ? percentChange(doc.file.size, size) : 0
  const edited = pixelsChanged(state, doc.srcW, doc.srcH)

  const applyAll = () => {
    const ids = useTools.getState().docs.map((d) => d.id)
    useTools
      .getState()
      .editMany(ids, t('tools.compress.applyAll'), (s) => ({ ...s, output: { ...o } }))
    void processAllAfterApply(t('tools.batch.taskApply', { count: ids.length }))
  }

  return (
    <div>
      <Section>
        <Select
          label={t('tools.compress.format')}
          value={o.format}
          onChange={(format) => set({ format }, t('tools.compress.actions.format'))}
          options={formats}
        />
        <div className="flex flex-col">
          <span className="label">{t('tools.compress.mode')}</span>
          <SegmentedControl<CompressMode>
            full
            label={t('tools.compress.mode')}
            value={o.mode}
            onChange={(mode) => set({ mode }, t('tools.compress.actions.mode'))}
            options={[
              { value: 'none', label: t('tools.compress.none') },
              { value: 'quality', label: t('tools.compress.quality'), disabled: isPng },
              { value: 'target', label: t('tools.compress.target'), disabled: isPng },
            ]}
          />
        </div>
        {(o.mode === 'none' || isPng) && (
          <p className="text-small text-text-2">
            {edited || o.format !== 'original'
              ? t('tools.compress.noneReencode', { q: DEFAULT_REENCODE_QUALITY })
              : t('tools.compress.noneKeep')}
          </p>
        )}
        {o.mode === 'quality' && !isPng && (
          <SliderField
            label={t('tools.compress.qualityLabel')}
            value={o.quality}
            min={1}
            max={100}
            onChange={(v) =>
              set({ quality: Math.round(v) }, t('tools.compress.actions.quality'), 'quality')
            }
          />
        )}
        {o.mode === 'target' && !isPng && (
          <div className="flex flex-col gap-2">
            <NumberField
              label={t('tools.compress.targetLabel')}
              value={o.targetKB}
              min={10}
              max={50_000}
              step={10}
              suffix="KB"
              onChange={(v) =>
                set({ targetKB: Math.round(v) }, t('tools.compress.actions.target'), 'target')
              }
            />
            <div className="flex flex-wrap gap-1.5">
              {TARGETS.map((kb) => (
                <button
                  key={kb}
                  type="button"
                  aria-pressed={o.targetKB === kb}
                  onClick={() => set({ targetKB: kb }, t('tools.compress.actions.target'))}
                  className={cn(
                    'h-8 rounded-full border px-3 text-caption font-medium tabular-nums transition-colors duration-(--dur-fast)',
                    o.targetKB === kb
                      ? 'border-transparent bg-accent-strong text-on-accent'
                      : 'border-border text-text-2 hover:border-border-strong hover:text-text',
                  )}
                >
                  {kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`}
                </button>
              ))}
            </div>
            <p className="text-caption text-text-3">{t('tools.compress.targetHint')}</p>
          </div>
        )}
      </Section>

      <Section title={t('tools.compress.estimate')}>
        <div
          className="rounded-lg border border-border bg-surface-2/60 p-4"
          aria-live="polite"
          aria-busy={running}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span
              className={cn(
                'text-h2 font-semibold tabular-nums transition-opacity duration-(--dur-fast)',
                running && 'opacity-55',
              )}
            >
              {size ? <AnimatedNumber value={size} format={(v) => formatBytes(v)} /> : '—'}
            </span>
            {running ? (
              <span className="flex items-center gap-1.5 text-caption text-text-3">
                <Spinner size={14} />
                {t('tools.compress.estimating')}
              </span>
            ) : size ? (
              Math.abs(change) < 0.5 ? (
                <Badge>{t('tools.compress.same')}</Badge>
              ) : change < 0 ? (
                <Badge tone="success">
                  {t('tools.compress.smaller', { p: `${Math.round(-change)}%` })}
                </Badge>
              ) : (
                <Badge tone="warning">
                  {t('tools.compress.larger', { p: `${Math.round(change)}%` })}
                </Badge>
              )
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-caption tabular-nums text-text-3">
            <span>{t('tools.compress.originalSize', { size: formatBytes(doc.file.size) })}</span>
            {mine && est.quality !== null && est.status === 'done' && (
              <span>{t('tools.compress.usedQuality', { q: est.quality })}</span>
            )}
            {mine && est.mime && <span>{formatName(est.mime)}</span>}
          </div>
          {mine && est.status === 'error' && (
            <p className="mt-2 text-caption text-danger-ink">
              {t('tools.compress.estimateFailed')}
            </p>
          )}
        </div>
        {mine && est.status === 'done' && o.mode === 'target' && !est.reached && (
          <Callout tone="warning" icon={<AlertTriangle size={16} aria-hidden />}>
            {t('tools.compress.unreachable', { size: formatBytes(est.size) })}
          </Callout>
        )}
        {isPng && (
          <Callout
            tone="accent"
            icon={<Lightbulb size={16} aria-hidden />}
            title={t('tools.compress.pngTitle')}
          >
            <p>
              {o.mode === 'target' ? t('tools.compress.pngTarget') : t('tools.compress.pngBody')}
            </p>
            {encodable.has('image/webp') && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2.5"
                onClick={() =>
                  set(
                    { format: 'image/webp', mode: 'quality', quality: Math.max(o.quality, 80) },
                    t('tools.compress.actions.format'),
                  )
                }
              >
                {t('tools.compress.pngAction')}
              </Button>
            )}
          </Callout>
        )}
        <Switch
          label={t('tools.compress.compare')}
          description={t('tools.compress.compareDesc')}
          checked={compare}
          onChange={setCompare}
        />
      </Section>
      {docCount > 1 && (
        <Section>
          <ApplyAllButton onClick={applyAll} label={t('tools.compress.applyAll')} />
        </Section>
      )}
    </div>
  )
}
