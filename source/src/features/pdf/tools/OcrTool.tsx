import { AnimatePresence, motion } from 'motion/react'
import { ScanText } from 'lucide-react'
import { useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, CopyButton, Select, SegmentedControl, Switch } from '@/components/ui'
import { spring } from '@/design/motion'
import { outputName, replaceExt } from '@/lib/filename'
import { useSettings } from '@/stores/settings'
import { copyText } from '@/lib/download'
import { useT, type TKey } from '@/i18n'
import { loadFonts } from '@/features/doc2pdf/lib/fonts'
import { glyphsAreEven, padGlyphs } from '@/features/doc2pdf/engine/fontfix'
import { createOcr, makeSearchable, ocrPage, type OcrLang, type OcrPage } from '../lib/ocr'
import { parsePageRange } from '../lib/pageRange'
import { getDoc, sourceBytes, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { PagePager, PageStage, ToolFrame } from '../components/Frame'
import { RangeInput } from '../components/RangeInput'
import { PanelFooter, PanelSection, ToolPanel } from '../components/Shared'

interface OcrResult {
  text: string
  confidence: number
}

export function OcrTool() {
  const t = useT()
  const runner = useRunner<OcrResult>()
  return (
    <ToolFrame
      tool="ocr"
      runner={runner}
      workingTitle={t('pdf.ocr.working')}
      resetLabel={t('pdf.ocr.again')}
      workingArt={<ScanArt />}
      resultSummary={(r) => (r ? t('pdf.ocr.summary', { confidence: Math.round(r.confidence) }) : null)}
      resultExtra={(r) => (r ? <TextResult text={r.text} /> : null)}
    >
      {(source) => <Editor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

/** 處理中：掃描光束上下掃過紙張，文字逐行浮現 */
function ScanArt() {
  return (
    <div className="relative h-28 w-[5.5rem] overflow-hidden rounded-md bg-white shadow-e2 ring-1 ring-border">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <motion.span
          key={i}
          className="absolute left-2.5 h-1.5 rounded-full bg-slate-300"
          style={{ top: 14 + i * 15, width: 58 - ((i * 11) % 20) }}
          animate={{ backgroundColor: ['#cbd5e1', 'var(--accent)', '#cbd5e1'] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
      <motion.span
        className="absolute inset-x-0 h-6 bg-gradient-to-b from-transparent via-[color-mix(in_srgb,var(--accent)_45%,transparent)] to-transparent"
        animate={{ top: ['-20%', '100%', '-20%'] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}

function TextResult({ text }: { text: string }) {
  const t = useT()
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.smooth, delay: 0.3 }}
      className="mt-4 w-full text-left"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-small font-semibold text-text-2">{t('pdf.ocr.text')}</span>
        <CopyButton onCopy={() => copyText(text)} size="sm" />
      </div>
      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-sans text-small leading-relaxed text-text">
        {text || t('pdf.ocr.empty')}
      </pre>
    </motion.div>
  )
}

function Editor({ source, runner }: { source: PdfSource; runner: Runner<OcrResult> }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [lang, setLang] = useState<OcrLang>('chi_tra+eng')
  const [scope, setScope] = useState<'all' | 'range'>('all')
  const [range, setRange] = useState('')
  const [dpi, setDpi] = useState('300')
  const [searchable, setSearchable] = useState(!source.encrypted)
  const [page, setPage] = useState(0)
  const [live, setLive] = useState<string[]>([])
  const parsed = scope === 'range' ? parsePageRange(range, source.pageCount) : null
  const pages =
    scope === 'all'
      ? Array.from({ length: source.pageCount }, (_, i) => i)
      : parsed?.ok
        ? [...new Set(parsed.pages.map((p) => p - 1))]
        : []

  const run = () => {
    const base = source.name
    setLive([])
    void runner.start(t('pdf.ocr.task', { name: base }), async ({ progress, signal }) => {
      const doc = await getDoc(source.id)
      const share = searchable ? 0.85 : 1
      let stage = 0
      const worker = await createOcr(lang, (status, p) => {
        if (status.startsWith('recognizing')) progress(((stage + p) / pages.length) * share)
        else if (stage === 0) progress(null)
      })
      const results: OcrPage[] = []
      try {
        for (const i of pages) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          const r = await ocrPage(worker, doc, i, Number(dpi), signal)
          results.push(r)
          setLive((l) => [...l, r.text.split('\n').find((x) => x.trim()) ?? ''])
          stage++
          progress((stage / pages.length) * share)
        }
      } finally {
        await worker.terminate()
      }
      const text = results.map((r) => r.text).join('\n\n\f\n\n').replace(/\f/g, '')
      const files = [
        {
          blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
          name: replaceExt(base, 'txt'),
        },
      ]
      if (searchable) {
        let font: Uint8Array | null = null
        if (lang !== 'eng') {
          const f = await loadFonts(() => {}, signal)
          font = glyphsAreEven(f.regular) ? f.regular : padGlyphs(f.regular)
        }
        const out = await makeSearchable(await sourceBytes(source), results, font)
        files.unshift({
          blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
          name: outputName(base, t('pdf.actions.ocr'), 'pdf', pattern),
        })
      }
      progress(1)
      const confidence = results.reduce((n, r) => n + r.confidence, 0) / Math.max(1, results.length)
      return { files, data: { text, confidence } }
    })
  }

  return (
    <Workspace
      main={
        <div className="flex flex-col gap-3">
          <PagePager index={page} count={source.pageCount} onChange={setPage} />
          <PageStage source={source} index={page} maxWidth={640}>
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-[color-mix(in_srgb,var(--accent)_30%,transparent)] to-transparent mix-blend-multiply motion-decor"
              animate={{ top: ['-8%', '100%'] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', repeatType: 'reverse' }}
            />
          </PageStage>
          <AnimatePresence>
            {live.length > 0 && (
              <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-1">
                {live.map((l, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="truncate text-small text-text-2">
                    {t('pdf.grid.page', { n: pages[i] + 1 })}：{l}
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.ocr.name')}>
          <Select<OcrLang>
            label={t('pdf.ocr.lang')}
            value={lang}
            onChange={setLang}
            options={(['chi_tra+eng', 'chi_tra', 'eng'] as const).map((v) => ({
              value: v,
              label: t(`pdf.ocr.langs.${v.replace('+', '_')}` as TKey),
            }))}
          />
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
          <PanelSection title={t('pdf.ocr.dpi')}>
            <SegmentedControl
              label={t('pdf.ocr.dpi')}
              full
              size="sm"
              value={dpi}
              onChange={setDpi}
              options={[
                { value: '200', label: t('pdf.ocr.fast') },
                { value: '300', label: t('pdf.ocr.balanced') },
                { value: '400', label: t('pdf.ocr.fine') },
              ]}
            />
          </PanelSection>
          <Switch
            label={t('pdf.ocr.searchable')}
            description={source.encrypted ? t('pdf.ocr.searchableEncrypted') : t('pdf.ocr.searchableHint')}
            checked={searchable}
            disabled={source.encrypted}
            onChange={setSearchable}
          />
          <p className="text-caption text-text-3">{t('pdf.ocr.note')}</p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!pages.length}
              leading={<ScanText size={18} aria-hidden />}
              onClick={run}
            >
              {t('pdf.ocr.run', { count: pages.length })}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
