import { motion } from 'motion/react'
import { Check, CloudDownload, FileOutput, HardDriveDownload } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button, Kbd, Panel, SegmentedControl, Select, SliderField, Switch } from '@/components/ui'
import { spring } from '@/design/motion'
import { modKey } from '@/lib/capabilities'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import type { ThemeId } from '../engine/themes'
import type { MarginPreset, Orientation, Paper } from '../engine/options'
import { fontsCached } from '../lib/fonts'
import { useDoc2Pdf } from '../store'

export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h4 className="text-caption font-semibold uppercase tracking-[0.04em] text-text-3">{title}</h4>
      {children}
    </section>
  )
}

const THEMES: ThemeId[] = ['clean', 'academic', 'modern']

/** 主題縮圖：用 CSS 畫出三種樣式的差異（標題、表格、程式碼） */
function ThemeThumb({ id }: { id: ThemeId }) {
  const accent = id === 'modern' ? '#ea580c' : id === 'academic' ? '#111' : '#111827'
  return (
    <span aria-hidden className="relative block h-[62px] w-full overflow-hidden rounded-[5px] border border-black/10 bg-white p-1.5 shadow-e1">
      {/* 標題 */}
      <span
        className={cn('block h-[5px] rounded-[1px]', id === 'academic' ? 'mx-auto w-[60%]' : 'w-[70%]')}
        style={{ background: accent }}
      />
      {id === 'clean' && <span className="mt-[3px] block h-px w-full bg-[#d9dde5]" />}
      {id === 'modern' && <span className="mt-[3px] block h-[2px] w-[22%] rounded bg-[#ea580c]" />}
      {/* 內文 */}
      <span className="mt-[4px] block space-y-[2.5px]">
        <span className={cn('block h-[2px] bg-[#9aa3b2]', id === 'academic' ? 'ml-[10%] w-[90%]' : 'w-full')} />
        <span className={cn('block h-[2px] bg-[#9aa3b2]', id === 'academic' ? 'w-full' : 'w-[85%]')} />
      </span>
      {/* 表格／程式碼 */}
      {id === 'clean' && (
        <span className="mt-[5px] grid grid-cols-3 border border-[#cfd5df]">
          <span className="h-[6px] border-r border-[#cfd5df] bg-[#f0f3f7]" />
          <span className="h-[6px] border-r border-[#cfd5df] bg-[#f0f3f7]" />
          <span className="h-[6px] bg-[#f0f3f7]" />
          <span className="h-[6px] border-r border-t border-[#cfd5df]" />
          <span className="h-[6px] border-r border-t border-[#cfd5df]" />
          <span className="h-[6px] border-t border-[#cfd5df]" />
        </span>
      )}
      {id === 'academic' && (
        <span className="mt-[5px] block border-y-[1.5px] border-[#222]">
          <span className="block h-[6px] border-b border-[#222]" />
          <span className="block h-[6px]" />
        </span>
      )}
      {id === 'modern' && (
        <span className="mt-[5px] block">
          <span className="block h-[6px] rounded-t-[1px] bg-[#ea580c]" />
          <span className="block h-[6px] bg-[#fbf7f4]" />
        </span>
      )}
    </span>
  )
}

function ThemePicker() {
  const t = useT()
  const theme = useDoc2Pdf((s) => s.options.theme)
  const setOption = useDoc2Pdf((s) => s.setOption)
  const id = useId()
  return (
    <div role="radiogroup" aria-labelledby={`${id}-l`} className="flex flex-col gap-2">
      <span id={`${id}-l`} className="sr-only">
        {t('doc2pdf.panel.theme')}
      </span>
      <div className="grid grid-cols-3 gap-2">
        {THEMES.map((th) => {
          const on = theme === th
          return (
            <button
              key={th}
              type="button"
              role="radio"
              aria-checked={on}
              aria-describedby={`${id}-${th}`}
              onClick={() => setOption('theme', th)}
              onKeyDown={(e) => {
                const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
                if (!dir) return
                e.preventDefault()
                const next = THEMES[(THEMES.indexOf(th) + dir + THEMES.length) % THEMES.length]
                setOption('theme', next)
                ;(e.currentTarget.parentElement?.children[THEMES.indexOf(next)] as HTMLElement | undefined)?.focus()
              }}
              tabIndex={on ? 0 : -1}
              className={cn(
                'relative flex min-h-11 flex-col items-stretch gap-1.5 rounded-md p-1.5 text-left transition-colors duration-(--dur-fast)',
                on ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]' : 'hover:bg-surface-2',
              )}
            >
              <ThemeThumb id={th} />
              <span className="flex items-center justify-between gap-1 px-0.5 text-small font-medium">
                {t(`doc2pdf.panel.themes.${th}`)}
                {on && <Check size={14} className="text-accent-ink" aria-hidden />}
              </span>
              {on && (
                <motion.span
                  layoutId={`${id}-ring`}
                  transition={spring.snappy}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-accent"
                />
              )}
            </button>
          )
        })}
      </div>
      {THEMES.map((th) => (
        <p key={th} id={`${id}-${th}`} className={cn('text-caption text-text-3', theme !== th && 'hidden')}>
          {t(`doc2pdf.panel.themes.${th}Desc`)}
        </p>
      ))}
    </div>
  )
}

const LINE_HEIGHTS = { tight: 1.45, normal: 1.65, loose: 1.9 } as const
type LineKey = keyof typeof LINE_HEIGHTS
const lineKey = (v: number): LineKey => (v <= 1.5 ? 'tight' : v >= 1.8 ? 'loose' : 'normal')

export function SettingsPanel({
  onStart,
  autoTitle,
  canStart,
  disabledReason,
  startLabel,
}: {
  onStart: () => void
  autoTitle: string
  canStart: boolean
  disabledReason?: string
  startLabel: string
}) {
  const t = useT()
  const o = useDoc2Pdf((s) => s.options)
  const setOption = useDoc2Pdf((s) => s.setOption)
  const merge = useDoc2Pdf((s) => s.merge)
  const setMerge = useDoc2Pdf((s) => s.setMerge)
  const count = useDoc2Pdf((s) => s.sources.length)
  const [cached, setCached] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    void fontsCached().then((c) => alive && setCached(c))
    return () => {
      alive = false
    }
  }, [])
  const titleId = useId()

  return (
    <Panel title={t('doc2pdf.panel.title')}>
      {count > 1 && (
        <Section title={t('doc2pdf.panel.output')}>
          <SegmentedControl
            full
            label={t('doc2pdf.panel.output')}
            value={merge ? 'merged' : 'separate'}
            onChange={(v) => setMerge(v === 'merged')}
            options={[
              { value: 'separate', label: t('doc2pdf.panel.separate') },
              { value: 'merged', label: t('doc2pdf.panel.merged') },
            ]}
          />
          {merge && <p className="text-caption text-text-3">{t('doc2pdf.panel.mergedHint')}</p>}
        </Section>
      )}

      <Section title={t('doc2pdf.panel.theme')}>
        <ThemePicker />
        <div className="flex flex-col">
          <label htmlFor={titleId} className="label">
            {t('doc2pdf.panel.docTitle')}
          </label>
          <input
            id={titleId}
            className="field"
            value={o.title}
            maxLength={200}
            placeholder={t('doc2pdf.panel.docTitlePlaceholder', { title: autoTitle })}
            onChange={(e) => setOption('title', e.target.value)}
          />
          <p className="mt-1 text-caption text-text-3">{t('doc2pdf.panel.docTitleHint')}</p>
        </div>
      </Section>

      <Section title={t('doc2pdf.panel.page')}>
        <div className="flex flex-col gap-1.5">
          <span className="text-small font-medium text-text-2">{t('doc2pdf.panel.paper')}</span>
          <SegmentedControl<Paper>
            full
            label={t('doc2pdf.panel.paper')}
            value={o.paper}
            onChange={(v) => setOption('paper', v)}
            options={[
              { value: 'a4', label: 'A4' },
              { value: 'letter', label: 'Letter' },
              { value: 'a5', label: 'A5' },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-small font-medium text-text-2">{t('doc2pdf.panel.orientation')}</span>
          <SegmentedControl<Orientation>
            full
            label={t('doc2pdf.panel.orientation')}
            value={o.orientation}
            onChange={(v) => setOption('orientation', v)}
            options={[
              { value: 'portrait', label: t('doc2pdf.panel.portrait') },
              { value: 'landscape', label: t('doc2pdf.panel.landscape') },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-small font-medium text-text-2">{t('doc2pdf.panel.margin')}</span>
          <SegmentedControl<MarginPreset>
            full
            label={t('doc2pdf.panel.margin')}
            value={o.margin}
            onChange={(v) => setOption('margin', v)}
            options={[
              { value: 'narrow', label: t('doc2pdf.panel.marginNarrow') },
              { value: 'normal', label: t('doc2pdf.panel.marginNormal') },
              { value: 'wide', label: t('doc2pdf.panel.marginWide') },
            ]}
          />
        </div>
      </Section>

      <Section title={t('doc2pdf.panel.text')}>
        <SliderField
          label={t('doc2pdf.panel.fontSize')}
          value={o.baseSize}
          onChange={(v) => setOption('baseSize', v)}
          min={10}
          max={14}
          step={0.5}
          format={(v) => `${v} pt`}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-small font-medium text-text-2">{t('doc2pdf.panel.lineHeight')}</span>
          <SegmentedControl<LineKey>
            full
            label={t('doc2pdf.panel.lineHeight')}
            value={lineKey(o.lineHeight)}
            onChange={(v) => setOption('lineHeight', LINE_HEIGHTS[v])}
            options={[
              { value: 'tight', label: t('doc2pdf.panel.lineTight') },
              { value: 'normal', label: t('doc2pdf.panel.lineNormal') },
              { value: 'loose', label: t('doc2pdf.panel.lineLoose') },
            ]}
          />
        </div>
      </Section>

      <Section title={t('doc2pdf.panel.tocSection')}>
        <Switch
          checked={o.toc}
          onChange={(v) => setOption('toc', v)}
          label={t('doc2pdf.panel.toc')}
          description={t('doc2pdf.panel.tocDesc')}
        />
        {o.toc && (
          <div className="grid grid-cols-2 gap-2">
            <Select<'front' | 'end'>
              size="sm"
              label={t('doc2pdf.panel.tocPosition')}
              value={o.tocPosition}
              onChange={(v) => setOption('tocPosition', v)}
              options={[
                { value: 'front', label: t('doc2pdf.panel.tocFront') },
                { value: 'end', label: t('doc2pdf.panel.tocEnd') },
              ]}
            />
            <Select<'1' | '2' | '3'>
              size="sm"
              label={t('doc2pdf.panel.tocLevel')}
              value={String(o.tocLevel) as '1' | '2' | '3'}
              onChange={(v) => setOption('tocLevel', Number(v))}
              options={(['1', '2', '3'] as const).map((n) => ({ value: n, label: t('doc2pdf.panel.tocLevelN', { n }) }))}
            />
          </div>
        )}
        <Switch
          checked={o.bookmarks}
          onChange={(v) => setOption('bookmarks', v)}
          label={t('doc2pdf.panel.bookmarks')}
          description={t('doc2pdf.panel.bookmarksDesc')}
        />
      </Section>

      <Section title={t('doc2pdf.panel.pageSection')}>
        <Switch
          checked={o.header}
          onChange={(v) => setOption('header', v)}
          label={t('doc2pdf.panel.header')}
          description={t('doc2pdf.panel.headerDesc')}
        />
        <Switch
          checked={o.footer}
          onChange={(v) => setOption('footer', v)}
          label={t('doc2pdf.panel.footer')}
          description={t('doc2pdf.panel.footerDesc')}
        />
        <Switch
          checked={o.cover}
          onChange={(v) => setOption('cover', v)}
          label={t('doc2pdf.panel.cover')}
          description={t('doc2pdf.panel.coverDesc')}
        />
        {o.cover && (
          <Switch checked={o.coverDate} onChange={(v) => setOption('coverDate', v)} label={t('doc2pdf.panel.coverDate')} />
        )}
      </Section>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        {cached !== null && (
          <p className="flex items-start gap-2 text-caption text-text-3">
            {cached ? (
              <HardDriveDownload size={14} className="mt-px shrink-0 text-success-ink" aria-hidden />
            ) : (
              <CloudDownload size={14} className="mt-px shrink-0 text-accent-ink" aria-hidden />
            )}
            {cached ? t('doc2pdf.panel.fontCached') : t('doc2pdf.panel.fontNotice')}
          </p>
        )}
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!canStart}
          leading={<FileOutput size={18} aria-hidden />}
          onClick={onStart}
          aria-keyshortcuts="Control+Enter Meta+Enter"
        >
          {startLabel}
        </Button>
        {disabledReason ? (
          <p className="text-center text-caption text-text-3" aria-live="polite">
            {disabledReason}
          </p>
        ) : (
          <p className="hidden items-center justify-center gap-1 text-caption text-text-3 lg:flex">
            <Kbd>{modKey()}</Kbd>
            <Kbd>Enter</Kbd>
          </p>
        )}
      </div>
    </Panel>
  )
}
