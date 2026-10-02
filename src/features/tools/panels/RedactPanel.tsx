/** 遮蔽區域：方式（馬賽克／塗黑）、格子大小、區域清單 */
import { AnimatePresence, motion } from 'motion/react'
import { Grid3x3, MousePointerSquareDashed, Square, Trash2, X } from 'lucide-react'
import { Button, Callout, SegmentedControl, SliderField } from '@/components/ui'
import { cn } from '@/lib/cn'
import { spring } from '@/design/motion'
import { useT } from '@/i18n'
import type { RedactMode } from '../lib/types'
import { useRedactUi } from '../stage/RedactOverlay'
import { Section, useEditor } from '../ui'

export function RedactPanel() {
  const t = useT()
  const { doc, state, edit } = useEditor()
  const { mode, setMode, selected, select } = useRedactUi()
  if (!doc || !state) return null
  const regions = state.redactions

  const changeMode = (m: RedactMode) => {
    setMode(m)
    if (selected && regions.some((r) => r.id === selected))
      edit(t('tools.redact.actions.mode'), (s) => ({
        ...s,
        redactions: s.redactions.map((r) => (r.id === selected ? { ...r, mode: m } : r)),
      }))
  }
  const hasMosaic = mode === 'mosaic' || regions.some((r) => r.mode === 'mosaic')

  return (
    <div>
      <Section title={t('tools.redact.title')}>
        <p className="flex items-start gap-2 text-small text-text-2">
          <MousePointerSquareDashed
            size={16}
            className="mt-0.5 shrink-0 text-accent-ink"
            aria-hidden
          />
          {t('tools.redact.desc')}
        </p>
        <SegmentedControl
          full
          label={t('tools.redact.mode')}
          value={mode}
          onChange={changeMode}
          options={[
            {
              value: 'mosaic',
              label: (
                <>
                  <Grid3x3 size={14} aria-hidden />
                  {t('tools.redact.mosaic')}
                </>
              ),
            },
            {
              value: 'black',
              label: (
                <>
                  <Square size={14} aria-hidden />
                  {t('tools.redact.black')}
                </>
              ),
            },
          ]}
        />
        {hasMosaic && (
          <SliderField
            label={t('tools.redact.blockSize')}
            value={state.mosaicSize}
            min={8}
            max={60}
            format={(v) => String(Math.round(v))}
            onChange={(v) =>
              edit(
                t('tools.redact.actions.size'),
                (s) => ({ ...s, mosaicSize: Math.round(v) }),
                'mosaic',
              )
            }
          />
        )}
      </Section>
      <Section
        title={
          regions.length
            ? t('tools.redact.list', { count: regions.length })
            : t('tools.redact.empty')
        }
        action={
          regions.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              leading={<Trash2 size={14} aria-hidden />}
              onClick={() => {
                select(null)
                edit(t('tools.redact.actions.clear'), (s) => ({ ...s, redactions: [] }))
              }}
            >
              {t('tools.redact.clear')}
            </Button>
          )
        }
      >
        {regions.length > 0 && (
          <ul className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {regions.map((r, i) => (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={spring.snappy}
                  className={cn(
                    'flex items-center gap-2 rounded-md border pl-1 pr-1',
                    selected === r.id
                      ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]'
                      : 'border-border',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => select(r.id)}
                    aria-pressed={selected === r.id}
                    className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-2 text-left text-small"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-surface-2 text-text-2">
                      {r.mode === 'black' ? (
                        <Square size={13} aria-hidden />
                      ) : (
                        <Grid3x3 size={13} aria-hidden />
                      )}
                    </span>
                    <span className="font-medium text-text">
                      {t('tools.redact.item', { n: i + 1 })}
                    </span>
                    <span className="truncate text-text-3">
                      {r.mode === 'black' ? t('tools.redact.black') : t('tools.redact.mosaic')} ·{' '}
                      {r.rect.w} × {r.rect.h}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={t('tools.redact.remove', { n: i + 1 })}
                    onClick={() => {
                      if (selected === r.id) select(null)
                      edit(t('tools.redact.actions.remove'), (s) => ({
                        ...s,
                        redactions: s.redactions.filter((x) => x.id !== r.id),
                      }))
                    }}
                  >
                    <X size={14} aria-hidden />
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        <p className="text-caption text-text-3">{t('tools.redact.hint')}</p>
        <Callout tone="neutral" className="py-2.5">
          {t('tools.redact.safety')}
        </Callout>
      </Section>
    </div>
  )
}
