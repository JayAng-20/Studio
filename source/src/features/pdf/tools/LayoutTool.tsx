import { LayoutGroup, motion } from 'motion/react'
import { BookOpenText, Columns2, Grid2x2 } from 'lucide-react'
import { useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, Select, SegmentedControl, SliderField, Switch } from '@/components/ui'
import { spring } from '@/design/motion'
import { outputName } from '@/lib/filename'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { useT, type TKey } from '@/i18n'
import {
  NUP_GRID,
  PAPERS,
  bookletOrder,
  layoutPages,
  nupOrder,
  type LayoutOptions,
  type NUp,
  type PaperId,
} from '../lib/acrobat'
import { MM_TO_PT } from '../lib/ops'
import { sourceBytes, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { ToolFrame } from '../components/Frame'
import { PanelFooter, PanelSection, ToolPanel } from '../components/Shared'

export const PAPER_IDS = Object.keys(PAPERS) as PaperId[]

export function LayoutTool() {
  const t = useT()
  const runner = useRunner()
  return (
    <ToolFrame tool="layout" runner={runner} workingTitle={t('pdf.layout.working')} resetLabel={t('pdf.layout.again')}>
      {(source) => <Editor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

/** 拼版示意：每張紙上的頁碼方塊以 layoutId 在設定改變時飛到新位置 */
function Preview({ o, count }: { o: LayoutOptions; count: number }) {
  const t = useT()
  const sheets =
    o.mode === 'booklet' ? bookletOrder(count, o.rtl).map((s) => [...s]) : nupOrder(count, o.n, o.order, o.rtl)
  const grid = o.mode === 'booklet' ? { cols: 2, rows: 1, landscape: true } : NUP_GRID[o.n]
  const shown = sheets.slice(0, 6)
  return (
    <LayoutGroup>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {shown.map((cells, si) => (
          <motion.div
            key={`${o.mode}-${si}`}
            layout
            initial={{ opacity: 0, y: 12, rotate: -2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ ...spring.smooth, delay: si * 0.05 }}
            className="flex flex-col items-center gap-1.5"
          >
            <motion.div
              layout
              className="grid w-full gap-[3px] rounded-[4px] bg-white p-[6px] shadow-e2 ring-1 ring-border"
              style={{
                aspectRatio: grid.landscape ? '1.414' : '0.707',
                gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
                gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
              }}
              transition={spring.smooth}
            >
              {cells.map((p, ci) =>
                p < 0 ? (
                  <span key={`e${si}-${ci}`} className="rounded-[2px] border border-dashed border-slate-300" />
                ) : (
                  <motion.span
                    key={p}
                    layoutId={`pg-${p}`}
                    transition={spring.smooth}
                    className={cn(
                      'grid place-items-center rounded-[2px] text-[11px] font-semibold tabular-nums text-white',
                      o.border && 'ring-1 ring-slate-400',
                    )}
                    style={{ background: `color-mix(in srgb, var(--accent) ${55 + ((p * 9) % 40)}%, #1e293b)` }}
                  >
                    {p + 1}
                  </motion.span>
                ),
              )}
            </motion.div>
            <span className="text-caption text-text-3">
              {o.mode === 'booklet'
                ? t(si % 2 ? 'pdf.layout.back' : 'pdf.layout.front', { n: Math.floor(si / 2) + 1 })
                : t('pdf.layout.sheet', { n: si + 1 })}
            </span>
          </motion.div>
        ))}
      </div>
      {sheets.length > shown.length && (
        <p className="mt-3 text-center text-caption text-text-3">{t('pdf.layout.more', { count: sheets.length - shown.length })}</p>
      )}
    </LayoutGroup>
  )
}

function Editor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [o, setO] = useState<LayoutOptions>({
    mode: 'nup',
    n: 4,
    paper: 'a4',
    order: 'z',
    rtl: false,
    margin: 10 * MM_TO_PT,
    gap: 4 * MM_TO_PT,
    border: true,
  })
  const set = (p: Partial<LayoutOptions>) => setO((x) => ({ ...x, ...p }))
  const sheets =
    o.mode === 'booklet' ? Math.ceil(source.pageCount / 4) * 2 : Math.ceil(source.pageCount / o.n)
  const run = () => {
    const name = outputName(source.name, t('pdf.actions.layout'), 'pdf', pattern)
    void runner.start(t('pdf.layout.task', { name: source.name }), async ({ progress, signal }) => {
      const out = await layoutPages(await sourceBytes(source), o, signal, progress)
      return { files: [{ blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name }] }
    })
  }
  return (
    <Workspace
      main={
        <div className="card p-5">
          <Preview o={o} count={source.pageCount} />
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.layout.name')}>
          <SegmentedControl<'nup' | 'booklet'>
            label={t('pdf.layout.mode')}
            full
            value={o.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'nup', label: <span className="inline-flex items-center gap-1.5"><Grid2x2 size={14} aria-hidden />{t('pdf.layout.nup')}</span> },
              { value: 'booklet', label: <span className="inline-flex items-center gap-1.5"><BookOpenText size={14} aria-hidden />{t('pdf.layout.booklet')}</span> },
            ]}
          />
          {o.mode === 'nup' && (
            <PanelSection title={t('pdf.layout.perSheet')}>
              <SegmentedControl
                label={t('pdf.layout.perSheet')}
                full
                size="sm"
                value={String(o.n)}
                onChange={(v) => set({ n: Number(v) as NUp })}
                options={(['2', '4', '6', '9', '16'] as const).map((v) => ({ value: v, label: v }))}
              />
              <SegmentedControl<'z' | 'n'>
                label={t('pdf.layout.order')}
                full
                size="sm"
                value={o.order}
                onChange={(order) => set({ order })}
                options={[
                  { value: 'z', label: t('pdf.layout.orderZ') },
                  { value: 'n', label: t('pdf.layout.orderN') },
                ]}
              />
            </PanelSection>
          )}
          <Select<PaperId>
            label={t('pdf.layout.paper')}
            value={o.paper}
            onChange={(paper) => set({ paper })}
            options={PAPER_IDS.map((p) => ({ value: p, label: t(`pdf.paper.${p}` as TKey) }))}
          />
          {o.mode === 'nup' && (
            <>
              <SliderField
                label={t('pdf.layout.margin')}
                value={Math.round(o.margin / MM_TO_PT)}
                min={0}
                max={30}
                format={(v) => `${v} mm`}
                onChange={(v) => set({ margin: v * MM_TO_PT })}
              />
              <SliderField
                label={t('pdf.layout.gap')}
                value={Math.round(o.gap / MM_TO_PT)}
                min={0}
                max={20}
                format={(v) => `${v} mm`}
                onChange={(v) => set({ gap: v * MM_TO_PT })}
              />
            </>
          )}
          <Switch label={t('pdf.layout.border')} checked={o.border} onChange={(border) => set({ border })} />
          <Switch
            label={t('pdf.layout.rtl')}
            description={t('pdf.layout.rtlHint')}
            checked={o.rtl}
            onChange={(rtl) => set({ rtl })}
          />
          {o.mode === 'booklet' && <p className="text-caption text-text-3">{t('pdf.layout.bookletHint')}</p>}
          <PanelFooter>
            <Button variant="primary" size="lg" className="w-full" leading={<Columns2 size={18} aria-hidden />} onClick={run}>
              {t('pdf.layout.run', { count: sheets })}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
