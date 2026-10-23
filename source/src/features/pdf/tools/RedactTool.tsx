import { AnimatePresence, motion } from 'motion/react'
import { Eraser, Search, SquareDashed, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, Callout, SegmentedControl, Switch, toast } from '@/components/ui'
import { outputName } from '@/lib/filename'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { useT, type TKey } from '@/i18n'
import { applyRedactions, findMatches, type RRect, type RedactPreset } from '../lib/redact'
import { getDoc, sourceBytes, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { DrawLayer, PagePager, PageStage, ToolFrame } from '../components/Frame'
import { PanelFooter, PanelSection, ToolPanel } from '../components/Shared'

const PRESET_IDS: RedactPreset[] = ['email', 'phone', 'twid', 'card', 'date']

export function RedactTool() {
  const t = useT()
  const runner = useRunner()
  return (
    <ToolFrame
      tool="redact"
      runner={runner}
      workingTitle={t('pdf.redact.working')}
      resetLabel={t('pdf.redact.again')}
      workingArt={<Shredder />}
    >
      {(source) => <Editor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

/** 處理中：黑條一條條刷過紙張 */
function Shredder() {
  return (
    <div className="relative h-24 w-20 overflow-hidden rounded-md bg-white shadow-e2 ring-1 ring-border">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="absolute left-2.5 h-1.5 rounded-full bg-slate-200" style={{ top: 12 + i * 15, width: 40 + ((i * 13) % 18) }} />
      ))}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute left-2 h-3 origin-left rounded-[2px] bg-slate-900"
          style={{ top: 9 + i * 30, width: 52 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: [0, 1, 1, 0] }}
          transition={{ duration: 1.8, times: [0, 0.35, 0.8, 1], repeat: Infinity, delay: i * 0.25 }}
        />
      ))}
    </div>
  )
}

function Editor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const id = useId()
  const pattern = useSettings((s) => s.filenamePattern)
  const [page, setPage] = useState(0)
  const [boxes, setBoxes] = useState<Map<number, RRect[]>>(new Map())
  const [query, setQuery] = useState('')
  const [presets, setPresets] = useState<RedactPreset[]>([])
  const [searching, setSearching] = useState(false)
  const [dpi, setDpi] = useState('200')
  const [stripMeta, setStripMeta] = useState(true)
  const total = [...boxes.values()].reduce((n, l) => n + l.length, 0)

  const setPageBoxes = (i: number, list: RRect[]) =>
    setBoxes((m) => {
      const next = new Map(m)
      if (list.length) next.set(i, list)
      else next.delete(i)
      return next
    })

  const search = async () => {
    setSearching(true)
    try {
      const found = await findMatches(await getDoc(source.id), { text: query, presets })
      const count = [...found.values()].reduce((n, l) => n + l.length, 0)
      if (!count) {
        toast(t('pdf.redact.noMatch'))
        return
      }
      setBoxes((m) => {
        const next = new Map(m)
        found.forEach((list, i) => next.set(i, [...(next.get(i) ?? []), ...list]))
        return next
      })
      const first = Math.min(...found.keys())
      setPage(first)
      toast.success(t('pdf.redact.found', { count, pages: found.size }))
    } catch (e) {
      console.error(e)
      toast.error(t('pdf.errors.failed'))
    } finally {
      setSearching(false)
    }
  }

  const run = () => {
    const name = outputName(source.name, t('pdf.actions.redact'), 'pdf', pattern)
    const snapshot = new Map(boxes)
    void runner.start(t('pdf.redact.task', { name: source.name }), async ({ progress, signal }) => {
      const out = await applyRedactions(
        await sourceBytes(source),
        await getDoc(source.id),
        snapshot,
        { dpi: Number(dpi), color: '#000000', stripMeta },
        signal,
        progress,
      )
      return { files: [{ blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name }] }
    }, { minDuration: 900 })
  }

  const pageBoxes = boxes.get(page) ?? []
  return (
    <Workspace
      main={
        <div className="flex flex-col gap-3">
          <PagePager
            index={page}
            count={source.pageCount}
            onChange={setPage}
            extra={
              pageBoxes.length > 0 && (
                <Button size="sm" variant="ghost" leading={<Trash2 size={14} aria-hidden />} onClick={() => setPageBoxes(page, [])}>
                  {t('pdf.redact.clearPage')}
                </Button>
              )
            }
          />
          <PageStage source={source} index={page}>
            <DrawLayer
              rects={pageBoxes}
              onChange={(r) => setPageBoxes(page, r)}
              labelRemove={t('common.remove')}
            />
          </PageStage>
          <p className="text-center text-caption text-text-3">{t('pdf.redact.drawHint')}</p>
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.redact.name')}>
          <PanelSection title={t('pdf.redact.searchTitle')}>
            <div className="flex gap-1.5">
              <label htmlFor={`${id}-q`} className="sr-only">
                {t('pdf.redact.searchLabel')}
              </label>
              <input
                id={`${id}-q`}
                className="field h-9 min-w-0 flex-1"
                placeholder={t('pdf.redact.searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void search()}
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-9"
                disabled={searching || (!query.trim() && !presets.length)}
                leading={<Search size={14} aria-hidden />}
                onClick={() => void search()}
              >
                {t('pdf.redact.find')}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_IDS.map((p) => {
                const on = presets.includes(p)
                return (
                  <motion.button
                    key={p}
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    aria-pressed={on}
                    onClick={() => setPresets((l) => (on ? l.filter((x) => x !== p) : [...l, p]))}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-caption transition-colors duration-(--dur-fast)',
                      on
                        ? 'border-transparent bg-[var(--accent-strong)] text-white'
                        : 'border-border bg-surface text-text-2 hover:text-text',
                    )}
                  >
                    {t(`pdf.redact.presets.${p}` as TKey)}
                  </motion.button>
                )
              })}
            </div>
          </PanelSection>
          <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2.5">
            <span className="flex items-center gap-2 text-small text-text-2">
              <SquareDashed size={15} aria-hidden />
              {t('pdf.redact.count', { count: total, pages: boxes.size })}
            </span>
            <AnimatePresence>
              {total > 0 && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  onClick={() => setBoxes(new Map())}
                  className="text-caption text-text-3 underline-offset-2 hover:text-text hover:underline"
                >
                  {t('common.clearAll')}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
          <PanelSection title={t('pdf.redact.quality')}>
            <SegmentedControl
              label={t('pdf.redact.quality')}
              full
              size="sm"
              value={dpi}
              onChange={setDpi}
              options={[
                { value: '150', label: '150 dpi' },
                { value: '200', label: '200 dpi' },
                { value: '300', label: '300 dpi' },
              ]}
            />
          </PanelSection>
          <Switch label={t('pdf.redact.stripMeta')} checked={stripMeta} onChange={setStripMeta} />
          <Callout tone="warning" icon={<Eraser size={16} aria-hidden />}>
            {t('pdf.redact.warning')}
          </Callout>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!total}
              leading={<Eraser size={18} aria-hidden />}
              onClick={run}
            >
              {t('pdf.redact.run', { count: total })}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
