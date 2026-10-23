import { motion } from 'motion/react'
import { FileDown, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, Callout, SegmentedControl, Skeleton, Switch } from '@/components/ui'
import { spring, staggerDelay } from '@/design/motion'
import { replaceExt } from '@/lib/filename'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { buildDocx, pdfToParas, type Para } from '../lib/docx'
import { parsePageRange } from '../lib/pageRange'
import { getDoc, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { ToolFrame } from '../components/Frame'
import { RangeInput } from '../components/RangeInput'
import { PanelFooter, PanelSection, ToolPanel } from '../components/Shared'

export function ToWordTool() {
  const t = useT()
  const runner = useRunner()
  return (
    <ToolFrame
      tool="toWord"
      runner={runner}
      workingTitle={t('pdf.toWord.working')}
      resetLabel={t('pdf.toWord.again')}
      workingArt={<DocArt />}
    >
      {(source) => <Editor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

function DocArt() {
  return (
    <div className="relative h-24 w-[4.5rem] rounded-md bg-white shadow-e2 ring-1 ring-border">
      <span className="absolute left-2 top-2 rounded-[3px] bg-[#2b579a] px-1 text-[9px] font-bold text-white">W</span>
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.span
          key={i}
          className="absolute left-2 h-1.5 origin-left rounded-full bg-[#2b579a]/70"
          style={{ top: 26 + i * 12, width: i === 0 ? 40 : 52 - ((i * 7) % 16) }}
          animate={{ scaleX: [0, 1, 1] }}
          transition={{ duration: 1.6, times: [0, 0.5, 1], repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
    </div>
  )
}

function Editor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const [scope, setScope] = useState<'all' | 'range'>('all')
  const [range, setRange] = useState('')
  const [breaks, setBreaks] = useState(true)
  const [preview, setPreview] = useState<Para[] | null>(null)
  const parsed = scope === 'range' ? parsePageRange(range, source.pageCount) : null

  useEffect(() => {
    let alive = true
    getDoc(source.id)
      .then((doc) => pdfToParas(doc, Array.from({ length: Math.min(3, source.pageCount) }, (_, i) => i)))
      .then((p) => alive && setPreview(p))
      .catch(() => alive && setPreview([]))
    return () => {
      alive = false
    }
  }, [source.id, source.pageCount])

  const pages =
    scope === 'all'
      ? Array.from({ length: source.pageCount }, (_, i) => i)
      : parsed?.ok
        ? [...new Set(parsed.pages.map((p) => p - 1))]
        : []

  const run = () => {
    const name = replaceExt(source.name, 'docx')
    void runner.start(t('pdf.toWord.task', { name: source.name }), async ({ progress, signal }) => {
      const paras = await pdfToParas(await getDoc(source.id), pages, (p) => progress(p * 0.9), signal)
      const blob = await buildDocx(paras, { keepBreaks: breaks, title: source.name.replace(/\.pdf$/i, '') })
      return { files: [{ blob, name }] }
    }, { minDuration: 900 })
  }

  return (
    <Workspace
      main={
        <div className="card flex flex-col gap-3 p-5">
          <h3 className="flex items-center gap-2 text-h3 font-semibold">
            <FileText size={18} className="text-accent-ink" aria-hidden />
            {t('pdf.toWord.preview')}
          </h3>
          {preview === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : preview.length === 0 ? (
            <Callout tone="warning">{t('pdf.toWord.noText')}</Callout>
          ) : (
            <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto rounded-md bg-white p-6 text-slate-900 shadow-inner ring-1 ring-border">
              {preview.slice(0, 40).map((p, i) => (
                <motion.p
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...spring.smooth, delay: staggerDelay(Math.min(i, 14)) }}
                  className={cn(
                    p.heading === 1 && 'mt-2 text-[22px] font-bold',
                    p.heading === 2 && 'mt-1 text-[17px] font-bold',
                    !p.heading && 'text-[14px] leading-relaxed',
                    p.pageBreak && 'mt-4 border-t border-dashed border-slate-300 pt-4',
                  )}
                >
                  {p.text}
                </motion.p>
              ))}
            </div>
          )}
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.toWord.name')}>
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
          <Switch label={t('pdf.toWord.breaks')} checked={breaks} onChange={setBreaks} />
          <p className="text-caption text-text-3">{t('pdf.toWord.note')}</p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!pages.length}
              leading={<FileDown size={18} aria-hidden />}
              onClick={run}
            >
              {t('pdf.toWord.run')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
