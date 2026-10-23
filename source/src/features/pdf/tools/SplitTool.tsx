import { Scissors } from 'lucide-react'
import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, NumberField, SegmentedControl } from '@/components/ui'
import { outputName, sanitizeFilename, splitExt } from '@/lib/filename'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { assembleMany, type PlanItem } from '../lib/ops'
import {
  chunkPages,
  formatPageRange,
  parsePageRange,
  spanToIndices,
  type PageSpan,
} from '../lib/pageRange'
import { sourceBytes, type PdfSource } from '../store'
import { PageGrid, toggleSelection } from '../components/PageGrid'
import { RangeInput } from '../components/RangeInput'
import { ResultCard } from '../components/ResultCard'
import { Working } from '../components/Working'
import { useRunner, type Runner } from '../components/useRunner'
import {
  PanelSection,
  PdfDrop,
  SourceBar,
  SourceNotices,
  editBlocked,
  useActiveSource,
  useStage,
  ToolPanel,
  PanelFooter,
} from '../components/Shared'
import { toolById } from '../tools'

type Mode = 'extract' | 'ranges' | 'every'

export function SplitTool() {
  const t = useT()
  const source = useActiveSource()
  const runner = useRunner()
  useStage(
    runner.phase === 'working'
      ? 'working'
      : runner.phase === 'done'
        ? 'done'
        : source
          ? 'ready'
          : 'empty',
  )
  if (!source) return <PdfDrop />
  return (
    <div className="flex flex-col gap-3">
      {runner.phase === 'working' && (
        <Working
          title={t('pdf.split.working')}
          progress={runner.progress}
          onCancel={runner.cancel}
        />
      )}
      {runner.phase === 'done' && runner.output && (
        <ResultCard
          files={runner.output.files}
          zipName={`${sanitizeFilename(splitExt(source.name).base)}_split.zip`}
          onReset={runner.reset}
        />
      )}
      <div hidden={runner.phase !== 'idle'} className="flex flex-col gap-3">
        <SourceBar source={source} />
        <SourceNotices source={source} tool={toolById.split} />
        {source.status === 'ready' && (
          <SplitEditor key={source.id} source={source} runner={runner} />
        )}
      </div>
    </div>
  )
}

function SplitEditor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [mode, setMode] = useState<Mode>('extract')
  const [text, setText] = useState('')
  const [every, setEvery] = useState(Math.min(2, source.pageCount))
  const last = useRef<number | null>(null)
  const count = source.pageCount

  const parsed = useMemo(() => (text.trim() ? parsePageRange(text, count) : null), [text, count])
  const groups: PageSpan[] = useMemo(() => {
    if (mode === 'every') return chunkPages(count, every)
    if (parsed && parsed.ok) return mode === 'ranges' ? parsed.spans : [{ start: 0, end: -1 }]
    return []
  }, [mode, every, count, parsed])

  const selected = useMemo(
    () => new Set(parsed && parsed.ok ? parsed.pages.map((p) => p - 1) : []),
    [parsed],
  )
  /** 頁面 → 屬於第幾個輸出檔 */
  const groupOf = useMemo(() => {
    const m = new Map<number, number>()
    if (mode === 'extract') return m
    groups.forEach((g, gi) => spanToIndices(g).forEach((p) => !m.has(p) && m.set(p, gi)))
    return m
  }, [groups, mode])

  const onClick = (i: number, e: MouseEvent) => {
    if (mode === 'every') return
    const next = toggleSelection(selected, i, e, last.current)
    last.current = i
    setText(formatPageRange([...next].sort((a, b) => a - b).map((p) => p + 1)))
  }

  const blocked = editBlocked(source, toolById.split)
  const valid = mode === 'every' ? every >= 1 : !!parsed && parsed.ok
  const outputs = mode === 'extract' ? (valid ? 1 : 0) : groups.length

  const run = () => {
    if (!valid) return
    const base = source.name
    let plans: PlanItem[][]
    let names: string[]
    if (mode === 'extract' && parsed && parsed.ok) {
      plans = [parsed.pages.map((p) => ({ kind: 'page', src: 0, page: p - 1 }))]
      names = [outputName(base, t('pdf.actions.extract'), 'pdf', pattern)]
    } else {
      plans = groups.map((g) => spanToIndices(g).map((page) => ({ kind: 'page', src: 0, page })))
      const width = String(count).length
      names = groups.map((g) =>
        outputName(
          base,
          g.start === g.end
            ? `p${String(g.start).padStart(width, '0')}`
            : `p${String(g.start).padStart(width, '0')}-${String(g.end).padStart(width, '0')}`,
          'pdf',
          pattern,
        ),
      )
    }
    void runner.start(t('pdf.split.task', { name: source.name }), async ({ signal, progress }) => {
      const bytes = await sourceBytes(source)
      const outs = await assembleMany([bytes], plans, { signal, onProgress: progress })
      return {
        files: outs.map((o, i) => ({
          blob: new Blob([o as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
          name: names[i],
        })),
      }
    })
  }

  return (
    <Workspace
      main={
        <PageGrid
          source={source}
          label={t('pdf.split.gridLabel')}
          selectable={mode !== 'every'}
          onItemClick={mode === 'every' ? undefined : onClick}
          state={(i) => {
            const g = groupOf.get(i)
            return {
              selected: mode === 'every' ? false : selected.has(i),
              alt: g !== undefined && g % 2 === 1,
              badge:
                mode !== 'extract' && g !== undefined
                  ? t('pdf.split.fileN', { n: g + 1 })
                  : undefined,
              dim: mode !== 'extract' && g === undefined,
            }
          }}
        />
      }
      panel={
        <ToolPanel title={t('pdf.tools.split.name')}>
          <SegmentedControl
            full
            label={t('pdf.split.mode')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'extract', label: t('pdf.split.modeExtract') },
              { value: 'ranges', label: t('pdf.split.modeRanges') },
              { value: 'every', label: t('pdf.split.modeEvery') },
            ]}
          />
          <p className="-mt-1 text-small text-text-2">{t(`pdf.split.desc.${mode}`)}</p>
          {mode === 'every' ? (
            <NumberField
              label={t('pdf.split.everyLabel')}
              value={every}
              onChange={setEvery}
              min={1}
              max={count}
              suffix={t('pdf.split.pagesSuffix')}
            />
          ) : (
            <PanelSection>
              <RangeInput
                value={text}
                onChange={setText}
                result={parsed}
                label={t('pdf.split.rangeLabel')}
                hint={t('pdf.split.rangeHint', { count })}
              />
              <div className="flex flex-wrap gap-1.5">
                {[
                  {
                    label: t('pdf.split.presetOdd'),
                    pages: range(count).filter((p) => p % 2 === 1),
                  },
                  {
                    label: t('pdf.split.presetEven'),
                    pages: range(count).filter((p) => p % 2 === 0),
                  },
                  { label: t('pdf.split.presetAll'), pages: range(count) },
                ].map((p) => (
                  <Button
                    key={p.label}
                    size="sm"
                    variant="outline"
                    onClick={() => setText(formatPageRange(p.pages))}
                    disabled={!p.pages.length}
                  >
                    {p.label}
                  </Button>
                ))}
                {text && (
                  <Button size="sm" variant="ghost" onClick={() => setText('')}>
                    {t('common.clear')}
                  </Button>
                )}
              </div>
            </PanelSection>
          )}
          <p
            className="rounded-md bg-surface-2 px-3 py-2.5 text-small text-text-2"
            aria-live="polite"
          >
            {valid
              ? outputs > 1
                ? t('pdf.split.outputsZip', { count: outputs })
                : t('pdf.split.outputsOne', {
                    pages: mode === 'extract' && parsed && parsed.ok ? parsed.pages.length : count,
                  })
              : t('pdf.split.outputsNone')}
          </p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!valid || blocked}
              leading={<Scissors size={18} aria-hidden />}
              onClick={run}
            >
              {mode === 'extract' ? t('pdf.split.startExtract') : t('pdf.split.startSplit')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
