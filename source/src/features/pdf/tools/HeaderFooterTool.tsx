import { AnimatePresence, motion } from 'motion/react'
import { LayoutPanelTop } from 'lucide-react'
import { useId, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, ColorPicker, NumberField, SegmentedControl, SliderField, Switch } from '@/components/ui'
import { spring } from '@/design/motion'
import { outputName } from '@/lib/filename'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { useLang, useT, type TKey } from '@/i18n'
import { stampPages, MM_TO_PT, type StampSpec } from '../lib/ops'
import { anchorPlacement, type Anchor } from '../lib/placement'
import { parsePageRange } from '../lib/pageRange'
import { renderTextStamp, STAMP_FONT } from '../lib/raster'
import { sourceBytes, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { PagePager, PageStage, ToolFrame } from '../components/Frame'
import { RangeInput } from '../components/RangeInput'
import { PanelFooter, PanelSection, ToolPanel } from '../components/Shared'

const SLOTS = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'] as const
type Slot = (typeof SLOTS)[number]

export interface Bates {
  enabled: boolean
  prefix: string
  suffix: string
  start: number
  digits: number
}

export interface HeaderFooterVars {
  page: number
  total: number
  date: string
  file: string
  bates: string
}

export const batesNumber = (b: Bates, index: number) =>
  `${b.prefix}${String(b.start + index).padStart(b.digits, '0')}${b.suffix}`

/** 代入 {page}、{total}、{date}、{file}、{bates} */
export const fillTokens = (s: string, v: HeaderFooterVars) =>
  s.replace(/\{(page|total|date|file|bates)\}/g, (_, k: keyof HeaderFooterVars) => String(v[k]))

export function HeaderFooterTool() {
  const t = useT()
  const runner = useRunner()
  return (
    <ToolFrame
      tool="headerFooter"
      runner={runner}
      workingTitle={t('pdf.headerFooter.working')}
      resetLabel={t('pdf.headerFooter.again')}
    >
      {(source) => <Editor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

function Editor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const lang = useLang()
  const id = useId()
  const pattern = useSettings((s) => s.filenamePattern)
  const [page, setPage] = useState(0)
  const [texts, setTexts] = useState<Record<Slot, string>>({
    tl: '',
    tc: '',
    tr: '{date}',
    bl: '{file}',
    bc: '',
    br: t('pdf.headerFooter.defaultPage'),
  })
  const [focus, setFocus] = useState<Slot>('br')
  const [size, setSize] = useState(9)
  const [color, setColor] = useState('#334155')
  const [margin, setMargin] = useState(12)
  const [startAt, setStartAt] = useState(1)
  const [scope, setScope] = useState<'all' | 'range'>('all')
  const [range, setRange] = useState('')
  const [bates, setBates] = useState<Bates>({ enabled: false, prefix: 'ABC', suffix: '', start: 1, digits: 6 })
  const parsed = scope === 'range' ? parsePageRange(range, source.pageCount) : null
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date())
  const file = source.name.replace(/\.pdf$/i, '')

  const included = (i: number) =>
    scope === 'all' || (parsed?.ok ? parsed.pages.includes(i + 1) : false)
  const order = Array.from({ length: source.pageCount }, (_, i) => i).filter(included)
  const vars = (i: number): HeaderFooterVars => {
    const k = order.indexOf(i)
    return {
      page: startAt + Math.max(0, k),
      total: startAt + order.length - 1,
      date,
      file,
      bates: bates.enabled ? batesNumber(bates, Math.max(0, k)) : '',
    }
  }
  const insert = (token: string) =>
    setTexts((x) => ({ ...x, [focus]: `${x[focus]}${x[focus] && !x[focus].endsWith(' ') ? ' ' : ''}${token}` }))

  const run = () => {
    const name = outputName(source.name, t('pdf.actions.headerFooter'), 'pdf', pattern)
    const marginPt = margin * MM_TO_PT
    void runner.start(t('pdf.headerFooter.task', { name: source.name }), async ({ progress, signal }) => {
      // 先把每頁每格的文字畫成圖章（相同文字共用）
      const cache = new Map<string, StampSpec | null>()
      const per = new Map<string, StampSpec | null>()
      for (let n = 0; n < order.length; n++) {
        const i = order[n]
        for (const s of SLOTS) {
          const raw = texts[s].trim()
          if (!raw) continue
          const text = fillTokens(raw, vars(i)).trim()
          if (!cache.has(text)) {
            const r = await renderTextStamp({ text, sizePt: size, color, align: s[1] === 'l' ? 'left' : 'center' })
            cache.set(text, r ? { image: r.image, size: r.size, opacity: 1 } : null)
          }
          per.set(`${i}-${s}`, cache.get(text) ?? null)
        }
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        progress((n / Math.max(1, order.length)) * 0.4)
      }
      const out = await stampPages(
        await sourceBytes(source),
        SLOTS.map((s) => ({
          stampFor: (i: number) => per.get(`${i}-${s}`) ?? null,
          placements: (_i: number, visual: { w: number; h: number }, st: StampSpec) => [
            anchorPlacement(visual, st.size, s as Anchor, marginPt),
          ],
        })),
        signal,
        (p) => progress(0.4 + p * 0.6),
      )
      return { files: [{ blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name }] }
    })
  }

  const pageSize = source.sizes[page] ?? source.sizes[0] ?? { w: 595, h: 842 }
  const v = vars(page)
  const show = included(page)
  return (
    <Workspace
      main={
        <div className="flex flex-col gap-3">
          <PagePager index={page} count={source.pageCount} onChange={setPage} />
          <PageStage source={source} index={page}>
            <div className="absolute inset-0 [container-type:inline-size]">
              <AnimatePresence>
                {show &&
                  SLOTS.map((s) => {
                    const text = texts[s].trim() ? fillTokens(texts[s], v) : ''
                    if (!text) return null
                    const m = `${((margin * MM_TO_PT) / pageSize.w) * 100}cqw`
                    return (
                      <motion.button
                        type="button"
                        key={s}
                        onClick={() => setFocus(s)}
                        initial={{ opacity: 0, y: s[0] === 't' ? -6 : 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={spring.smooth}
                        className={cn(
                          'absolute whitespace-pre rounded-[3px] px-[0.3em] leading-tight outline-offset-2',
                          focus === s && 'outline-2 outline-dashed outline-[var(--accent)]',
                        )}
                        style={{
                          fontFamily: STAMP_FONT,
                          fontWeight: 500,
                          fontSize: `${(size / pageSize.w) * 100}cqw`,
                          color,
                          top: s[0] === 't' ? m : undefined,
                          bottom: s[0] === 'b' ? m : undefined,
                          left: s[1] === 'l' ? m : s[1] === 'c' ? '50%' : undefined,
                          right: s[1] === 'r' ? m : undefined,
                          translate: s[1] === 'c' ? '-50% 0' : undefined,
                          textAlign: s[1] === 'l' ? 'left' : s[1] === 'r' ? 'right' : 'center',
                        }}
                      >
                        {text}
                      </motion.button>
                    )
                  })}
              </AnimatePresence>
            </div>
          </PageStage>
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.headerFooter.name')}>
          <PanelSection title={t('pdf.headerFooter.slots')}>
            <div className="grid grid-cols-3 gap-1.5">
              {SLOTS.map((s) => (
                <div key={s} className="flex flex-col">
                  <label htmlFor={`${id}-${s}`} className="mb-0.5 text-[11px] text-text-3">
                    {t(`pdf.headerFooter.slot.${s}` as TKey)}
                  </label>
                  <input
                    id={`${id}-${s}`}
                    className={cn('field h-9 px-2 text-small', focus === s && 'border-[var(--accent)]')}
                    value={texts[s]}
                    onFocus={() => setFocus(s)}
                    onChange={(e) => setTexts((x) => ({ ...x, [s]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {(['page', 'total', 'date', 'file', 'bates'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => insert(`{${k}}`)}
                  className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-text-2 transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-accent-ink"
                >
                  {`{${k}}`}
                </button>
              ))}
            </div>
            <p className="text-caption text-text-3">{t('pdf.headerFooter.tokens')}</p>
          </PanelSection>
          <SliderField label={t('pdf.headerFooter.size')} value={size} min={6} max={24} onChange={setSize} format={(x) => `${x} pt`} />
          <ColorPicker label={t('pdf.headerFooter.color')} value={color} onChange={setColor} />
          <SliderField label={t('pdf.layout.margin')} value={margin} min={4} max={40} onChange={setMargin} format={(x) => `${x} mm`} />
          <NumberField label={t('pdf.headerFooter.startAt')} value={startAt} min={0} max={99999} onChange={setStartAt} />
          <PanelSection title={t('pdf.crop.applyTo')}>
            <SegmentedControl<'all' | 'range'>
              label={t('pdf.crop.applyTo')}
              full
              size="sm"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: t('pdf.crop.all') },
                { value: 'range', label: t('pdf.crop.range') },
              ]}
            />
            {scope === 'range' && (
              <RangeInput value={range} onChange={setRange} result={range ? parsed : null} label={t('pdf.crop.range')} hideLabel />
            )}
          </PanelSection>
          <PanelSection title={t('pdf.headerFooter.bates')}>
            <Switch
              label={t('pdf.headerFooter.batesOn')}
              description={t('pdf.headerFooter.batesHint')}
              checked={bates.enabled}
              onChange={(enabled) => {
                setBates((b) => ({ ...b, enabled }))
                if (enabled && !Object.values(texts).some((x) => x.includes('{bates}')))
                  setTexts((x) => ({ ...x, br: '{bates}' }))
              }}
            />
            <AnimatePresence initial={false}>
              {bates.enabled && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={spring.smooth}
                  className="grid grid-cols-2 gap-2 overflow-hidden"
                >
                  <div className="flex flex-col">
                    <label htmlFor={`${id}-bp`} className="label">{t('pdf.headerFooter.prefix')}</label>
                    <input id={`${id}-bp`} className="field" value={bates.prefix} onChange={(e) => setBates((b) => ({ ...b, prefix: e.target.value }))} />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor={`${id}-bs`} className="label">{t('pdf.headerFooter.suffix')}</label>
                    <input id={`${id}-bs`} className="field" value={bates.suffix} onChange={(e) => setBates((b) => ({ ...b, suffix: e.target.value }))} />
                  </div>
                  <NumberField label={t('pdf.headerFooter.batesStart')} value={bates.start} min={0} max={99999999} onChange={(start) => setBates((b) => ({ ...b, start }))} />
                  <NumberField label={t('pdf.headerFooter.digits')} value={bates.digits} min={1} max={12} onChange={(digits) => setBates((b) => ({ ...b, digits }))} />
                  <p className="col-span-2 text-caption tabular-nums text-text-3">
                    {t('pdf.headerFooter.batesSample', { first: batesNumber(bates, 0), last: batesNumber(bates, Math.max(0, order.length - 1)) })}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </PanelSection>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!order.length || !SLOTS.some((s) => texts[s].trim())}
              leading={<LayoutPanelTop size={18} aria-hidden />}
              onClick={run}
            >
              {t('pdf.headerFooter.run')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
