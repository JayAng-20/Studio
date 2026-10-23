import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftRight, GitCompareArrows } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { AddFilesButton, AnimatedNumber, Button, Select, Skeleton, Spinner, Switch } from '@/components/ui'
import { spring, staggerDelay } from '@/design/motion'
import { canvasToBlob, createCanvas, releaseCanvas } from '@/lib/image'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { diffPage, pixelDiff, type PageDiff } from '../lib/compare'
import { pageText, renderToCanvas } from '../lib/pdfjs'
import { addPdfFiles, getDoc, usePdf, type PdfSource } from '../store'
import { PageThumb } from '../components/PageThumb'
import { PagePager } from '../components/Frame'
import { PDF_ACCEPT, PdfDrop, ToolPanel, PanelSection, useStage } from '../components/Shared'

export function CompareTool() {
  const t = useT()
  const all = usePdf((s) => s.sources)
  const sources = useMemo(() => all.filter((x) => x.status === 'ready'), [all])
  const [aId, setA] = useState<string | null>(null)
  const [bId, setB] = useState<string | null>(null)
  const a = sources.find((s) => s.id === aId) ?? sources[0]
  const b = sources.find((s) => s.id === bId && s.id !== a?.id) ?? sources.find((s) => s.id !== a?.id)
  useStage(!all.length ? 'empty' : 'ready')
  if (!all.length) return <PdfDrop multiple title={t('pdf.compare.dropTitle')} />
  if (!a || !b)
    return (
      <div className="card flex flex-col items-center gap-4 p-8 text-center">
        <motion.div
          className="flex items-center gap-3 text-accent-ink"
          animate={{ x: [0, 4, 0, -4, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <GitCompareArrows size={40} aria-hidden />
        </motion.div>
        <div>
          <h3 className="text-h3 font-semibold">{t('pdf.compare.needTwo')}</h3>
          <p className="mt-1 text-body text-text-2">{t('pdf.compare.needTwoDesc')}</p>
        </div>
        {all.some((s) => s.status === 'loading') ? (
          <Spinner size={22} />
        ) : (
          <AddFilesButton
            onFiles={(f) => void addPdfFiles(f)}
            accept={PDF_ACCEPT}
            variant="primary"
            label={t('pdf.compare.addSecond')}
          />
        )}
      </div>
    )
  return (
    <Comparison
      key={`${a.id}-${b.id}`}
      a={a}
      b={b}
      sources={sources}
      onA={setA}
      onB={setB}
      onSwap={() => {
        setA(b.id)
        setB(a.id)
      }}
    />
  )
}

function Comparison({
  a,
  b,
  sources,
  onA,
  onB,
  onSwap,
}: {
  a: PdfSource
  b: PdfSource
  sources: PdfSource[]
  onA: (id: string) => void
  onB: (id: string) => void
  onSwap: () => void
}) {
  const t = useT()
  const [diffs, setDiffs] = useState<PageDiff[] | null>(null)
  const [progress, setProgress] = useState(0)
  const [page, setPage] = useState(0)
  const [overlay, setOverlay] = useState(true)
  const [onlyChanged, setOnlyChanged] = useState(false)
  const count = Math.max(a.pageCount, b.pageCount)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [da, db] = await Promise.all([getDoc(a.id), getDoc(b.id)])
      const out: PageDiff[] = []
      for (let i = 0; i < count; i++) {
        const text = async (doc: typeof da, n: number) => {
          if (i >= n) return null
          const p = await doc.getPage(i + 1)
          try {
            return await pageText(p)
          } finally {
            p.cleanup()
          }
        }
        const [ta, tb] = await Promise.all([text(da, a.pageCount), text(db, b.pageCount)])
        if (!alive) return
        out.push(diffPage(i, ta, tb))
        setProgress((i + 1) / count)
        if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0))
      }
      if (alive) setDiffs(out)
    })().catch((e) => console.error(e))
    return () => {
      alive = false
    }
  }, [a.id, b.id, a.pageCount, b.pageCount, count])

  const changed = useMemo(
    () => (diffs ?? []).filter((d) => d.inserted || d.deleted || d.missing),
    [diffs],
  )
  const ins = changed.reduce((n, d) => n + d.inserted, 0)
  const del = changed.reduce((n, d) => n + d.deleted, 0)
  const cur = diffs?.[page]

  return (
    <Workspace
      main={
        <div className="flex flex-col gap-3">
          <PagePager index={page} count={count} onChange={setPage} />
          <div className="grid grid-cols-2 gap-3">
            <PaneHead label={t('pdf.compare.original')} name={a.name} tone="del" />
            <PaneHead label={t('pdf.compare.revised')} name={b.name} tone="ins" />
            <Pane source={a} index={page} />
            <Pane source={b} index={page} diffWith={overlay ? a : undefined} />
          </div>
          <div className="card p-4">
            <h4 className="mb-2 text-small font-semibold text-text-2">{t('pdf.compare.textChanges')}</h4>
            {!cur ? (
              <Skeleton className="h-16" />
            ) : !cur.inserted && !cur.deleted ? (
              <p className="text-body text-text-3">{t('pdf.compare.sameText')}</p>
            ) : (
              <p className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-body leading-relaxed">
                {cur.ops.map((o, i) =>
                  o.type === 'eq' ? (
                    <span key={i} className="text-text-3">
                      {o.text.length > 160 ? `${o.text.slice(0, 70)} … ${o.text.slice(-70)}` : o.text}
                    </span>
                  ) : (
                    <motion.mark
                      key={i}
                      initial={{ backgroundColor: 'rgba(0,0,0,0)' }}
                      animate={{
                        backgroundColor: o.type === 'ins' ? 'rgba(34,197,94,.22)' : 'rgba(239,68,68,.2)',
                      }}
                      transition={{ duration: 0.4, delay: Math.min(i * 0.02, 0.4) }}
                      className={cn(
                        'rounded-[3px] px-0.5 text-text',
                        o.type === 'del' && 'line-through decoration-danger',
                      )}
                    >
                      {o.text}
                    </motion.mark>
                  ),
                )}
              </p>
            )}
          </div>
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.compare.name')}>
          <PanelSection>
            <Select label={t('pdf.compare.original')} value={a.id} onChange={onA} options={sources.map((s) => ({ value: s.id, label: s.name }))} />
            <div className="flex justify-center">
              <Button size="sm" variant="ghost" leading={<ArrowLeftRight size={14} aria-hidden />} onClick={onSwap}>
                {t('pdf.compare.swap')}
              </Button>
            </div>
            <Select label={t('pdf.compare.revised')} value={b.id} onChange={onB} options={sources.filter((s) => s.id !== a.id).map((s) => ({ value: s.id, label: s.name }))} />
          </PanelSection>
          {!diffs ? (
            <div className="flex flex-col gap-2">
              <p className="text-small text-text-2">{t('pdf.compare.analyzing', { percent: Math.round(progress * 100) })}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <motion.div className="h-full bg-[var(--accent)]" animate={{ width: `${progress * 100}%` }} transition={spring.smooth} />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { v: changed.length, l: t('pdf.compare.pagesChanged'), c: 'text-text' },
                  { v: ins, l: t('pdf.compare.inserted'), c: 'text-success-ink' },
                  { v: del, l: t('pdf.compare.deleted'), c: 'text-danger-ink' },
                ].map((x, i) => (
                  <motion.div
                    key={x.l}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...spring.bouncy, delay: i * 0.06 }}
                    className="rounded-md bg-surface-2 px-1 py-2"
                  >
                    <p className={cn('text-h3 font-semibold tabular-nums', x.c)}>
                      <AnimatedNumber value={x.v} />
                    </p>
                    <p className="text-[11px] text-text-3">{x.l}</p>
                  </motion.div>
                ))}
              </div>
              <Switch label={t('pdf.compare.overlay')} description={t('pdf.compare.overlayHint')} checked={overlay} onChange={setOverlay} />
              <Switch label={t('pdf.compare.onlyChanged')} checked={onlyChanged} onChange={setOnlyChanged} />
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                <AnimatePresence initial={false}>
                  {(onlyChanged ? changed : diffs).map((d, i) => {
                    const has = d.inserted || d.deleted || d.missing
                    return (
                      <motion.li
                        key={d.index}
                        layout
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ ...spring.smooth, delay: staggerDelay(Math.min(i, 12)) }}
                      >
                        <button
                          type="button"
                          onClick={() => setPage(d.index)}
                          className={cn(
                            'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-small transition-colors',
                            page === d.index ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-text' : 'text-text-2 hover:bg-surface-2',
                          )}
                        >
                          <span>{t('pdf.grid.page', { n: d.index + 1 })}</span>
                          {d.missing ? (
                            <span className="text-caption text-warning-ink">{t(d.missing === 'a' ? 'pdf.compare.onlyB' : 'pdf.compare.onlyA')}</span>
                          ) : has ? (
                            <span className="flex gap-1.5 text-caption tabular-nums">
                              <span className="text-success-ink">+{d.inserted}</span>
                              <span className="text-danger-ink">−{d.deleted}</span>
                            </span>
                          ) : (
                            <span className="text-caption text-text-3">{t('pdf.compare.same')}</span>
                          )}
                        </button>
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
              </ul>
            </>
          )}
          <AddFilesButton onFiles={(f) => void addPdfFiles(f)} accept={PDF_ACCEPT} size="sm" variant="ghost" label={t('pdf.compare.addMore')} />
        </ToolPanel>
      }
    />
  )
}

function PaneHead({ label, name, tone }: { label: string; name: string; tone: 'ins' | 'del' }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={cn('size-2 shrink-0 rounded-full', tone === 'ins' ? 'bg-success' : 'bg-danger')} />
      <span className="shrink-0 text-small font-semibold">{label}</span>
      <span className="truncate text-caption text-text-3">{name}</span>
    </div>
  )
}

/** 一側頁面；diffWith 時在上方疊加與另一份的像素差異 */
function Pane({ source, index, diffWith }: { source: PdfSource; index: number; diffWith?: PdfSource }) {
  const t = useT()
  const size = source.sizes[index] ?? source.sizes[0] ?? { w: 595, h: 842 }
  const exists = index < source.pageCount
  const [mask, setMask] = useState<{ key: string; url: string; ratio: number } | null>(null)
  const key = `${diffWith?.id}-${source.id}-${index}`
  useEffect(() => {
    if (!diffWith || !exists || index >= diffWith.pageCount) return
    let alive = true
    let url = ''
    ;(async () => {
      const W = 700
      const render = async (src: PdfSource) => {
        const doc = await getDoc(src.id)
        const p = await doc.getPage(index + 1)
        const vp = p.getViewport({ scale: 1 })
        const c = await renderToCanvas(p, W / vp.width)
        p.cleanup()
        return c
      }
      const [ca, cb] = await Promise.all([render(diffWith), render(source)])
      try {
        const w = Math.min(ca.width, cb.width)
        const h = Math.min(ca.height, cb.height)
        const ia = ca.getContext('2d')!.getImageData(0, 0, w, h)
        const ib = cb.getContext('2d')!.getImageData(0, 0, w, h)
        const out = new ImageData(w, h)
        const ratio = pixelDiff(ia.data, ib.data, out.data)
        const c = createCanvas(w, h)
        c.getContext('2d')!.putImageData(out, 0, 0)
        url = URL.createObjectURL(await canvasToBlob(c, 'image/png'))
        releaseCanvas(c)
        if (alive) setMask({ key, url, ratio })
        else URL.revokeObjectURL(url)
      } finally {
        releaseCanvas(ca)
        releaseCanvas(cb)
      }
    })().catch((e) => console.error(e))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [diffWith, source, index, exists, key])

  if (!exists)
    return (
      <div className="grid aspect-[0.707] place-items-center rounded-md border border-dashed border-border-strong text-small text-text-3">
        {t('pdf.compare.noPage')}
      </div>
    )
  const m = mask?.key === key && diffWith ? mask : null
  return (
    <div className="relative">
      <PageThumb docId={source.id} index={index} aspect={size.w / size.h} renderWidth={700} className="rounded-[3px] shadow-e2" />
      <AnimatePresence>
        {m && (
          <motion.img
            key={m.url}
            src={m.url}
            alt=""
            className="pointer-events-none absolute inset-0 size-full mix-blend-multiply"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.55, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2 }}
          />
        )}
      </AnimatePresence>
      {m && m.ratio > 0 && (
        <span className="absolute right-2 top-2 rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-white shadow-e2">
          {t('pdf.compare.pixels', { percent: Math.max(0.1, Math.round(m.ratio * 1000) / 10) })}
        </span>
      )}
    </div>
  )
}
