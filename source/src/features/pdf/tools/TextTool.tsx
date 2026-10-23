import { Download, ScanText, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, Callout, CopyButton, Switch, toast } from '@/components/ui'
import { downloadBlob, copyText } from '@/lib/download'
import { outputName } from '@/lib/filename'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { parsePageRange } from '../lib/pageRange'
import { pageText } from '../lib/pdfjs'
import { getDoc, type PdfSource } from '../store'
import { RangeInput } from '../components/RangeInput'
import { Working } from '../components/Working'
import { useRunner, type Runner } from '../components/useRunner'
import {
  PdfDrop,
  SourceBar,
  useActiveSource,
  useStage,
  ToolPanel,
  PanelFooter,
} from '../components/Shared'

interface Extracted {
  pages: Array<{ n: number; text: string }>
  separators: boolean
}

export function TextTool() {
  const t = useT()
  const source = useActiveSource()
  const runner = useRunner<Extracted>()
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
      <SourceBar source={source} />
      {runner.phase === 'working' ? (
        <Working
          title={t('pdf.text.working')}
          progress={runner.progress}
          onCancel={runner.cancel}
        />
      ) : (
        source.status === 'ready' && (
          <TextExtractor key={source.id} source={source} runner={runner} />
        )
      )}
    </div>
  )
}

function TextExtractor({ source, runner }: { source: PdfSource; runner: Runner<Extracted> }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [range, setRange] = useState('')
  const [separators, setSeparators] = useState(true)
  const count = source.pageCount
  const parsed = useMemo(() => (range.trim() ? parsePageRange(range, count) : null), [range, count])
  const pages = parsed
    ? parsed.ok
      ? [...new Set(parsed.pages)]
      : []
    : Array.from({ length: count }, (_, i) => i + 1)

  const result = runner.phase === 'done' ? runner.output?.data : undefined
  const text = useMemo(() => {
    if (!result) return ''
    return result.pages
      .map((p) => (separators ? `${t('pdf.text.pageSeparator', { n: p.n })}\n${p.text}` : p.text))
      .join(separators ? '\n\n' : '\n')
      .trim()
  }, [result, separators, t])
  const empty = !!result && !result.pages.some((p) => p.text.trim())
  const chars = text.replace(/\s/g, '').length

  const run = () => {
    const list = pages
    void runner.start(t('pdf.text.task', { name: source.name }), async ({ signal, progress }) => {
      const doc = await getDoc(source.id)
      const out: Extracted['pages'] = []
      for (let i = 0; i < list.length; i++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const page = await doc.getPage(list[i])
        try {
          out.push({ n: list[i], text: await pageText(page) })
        } finally {
          page.cleanup()
        }
        progress((i + 1) / list.length)
      }
      return { files: [], data: { pages: out, separators } }
    })
  }

  const download = () => {
    const blob = new Blob([String.fromCharCode(0xfeff), text], { type: 'text/plain;charset=utf-8' })
    downloadBlob(blob, outputName(source.name, t('pdf.actions.text'), 'txt', pattern))
    toast.success(t('pdf.result.downloaded'))
  }

  return (
    <Workspace
      main={
        result ? (
          <div className="card flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <p className="text-small text-text-2 tabular-nums" aria-live="polite">
                {t('pdf.text.stats', { pages: result.pages.length, chars })}
              </p>
              <div className="flex gap-1.5">
                <CopyButton
                  size="sm"
                  variant="secondary"
                  disabled={empty}
                  onCopy={() => copyText(text)}
                />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={empty}
                  leading={<Download size={15} aria-hidden />}
                  onClick={download}
                >
                  {t('pdf.text.download')}
                </Button>
              </div>
            </div>
            {empty ? (
              <Callout
                tone="warning"
                icon={<TriangleAlert size={16} />}
                title={t('pdf.text.emptyTitle')}
                className="m-4"
              >
                {t('pdf.text.emptyDesc')}
              </Callout>
            ) : (
              <textarea
                readOnly
                aria-label={t('pdf.text.resultLabel')}
                value={text}
                className="h-[max(360px,calc(100dvh-380px))] w-full resize-none bg-surface p-4 font-mono text-small leading-6 text-text outline-none"
              />
            )}
          </div>
        ) : (
          <div className="card flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="grid size-14 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
              <ScanText size={26} aria-hidden />
            </span>
            <h3 className="text-h3 font-semibold">{t('pdf.text.introTitle')}</h3>
            <p className="max-w-md text-body text-text-2">{t('pdf.text.introDesc')}</p>
          </div>
        )
      }
      panel={
        <ToolPanel title={t('pdf.tools.text.name')}>
          <RangeInput
            value={range}
            onChange={setRange}
            result={parsed}
            label={t('pdf.text.pages')}
            placeholder={t('pdf.toImages.allPages', { count })}
          />
          <Switch
            label={t('pdf.text.separators')}
            description={t('pdf.text.separatorsDesc')}
            checked={separators}
            onChange={setSeparators}
          />
          <PanelFooter>
            <Button
              variant={result ? 'secondary' : 'primary'}
              size="lg"
              className="w-full"
              disabled={!pages.length}
              leading={<ScanText size={18} aria-hidden />}
              onClick={run}
            >
              {result ? t('pdf.text.again') : t('pdf.text.start')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
