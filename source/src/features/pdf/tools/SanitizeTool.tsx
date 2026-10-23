import { motion } from 'motion/react'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, Switch } from '@/components/ui'
import { spring, staggerDelay } from '@/design/motion'
import { outputName } from '@/lib/filename'
import { useSettings } from '@/stores/settings'
import { useT, type TKey } from '@/i18n'
import { sanitizePdf, type SanitizeOptions, type SanitizeReport } from '../lib/acrobat'
import { sourceBytes, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { ToolFrame } from '../components/Frame'
import { PanelFooter, ToolPanel } from '../components/Shared'

const KEYS: Array<keyof SanitizeOptions> = [
  'metadata',
  'javascript',
  'attachments',
  'annotations',
  'links',
  'forms',
  'bookmarks',
  'thumbnails',
  'layers',
]

export function SanitizeTool() {
  const t = useT()
  const runner = useRunner<SanitizeReport>()
  return (
    <ToolFrame
      tool="sanitize"
      runner={runner}
      workingTitle={t('pdf.sanitize.working')}
      resetLabel={t('pdf.sanitize.again')}
      resultSummary={(r) => {
        const n = Object.values(r ?? {}).reduce((a, b) => a + (b ?? 0), 0)
        return n ? t('pdf.sanitize.summary', { count: n }) : t('pdf.sanitize.nothing')
      }}
      resultExtra={(r) => <Report report={r ?? {}} />}
    >
      {(source) => <Editor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

function Report({ report }: { report: SanitizeReport }) {
  const t = useT()
  const rows = KEYS.filter((k) => report[k])
  if (!rows.length) return null
  return (
    <ul className="mt-4 grid w-full gap-1.5 text-left sm:grid-cols-2">
      {rows.map((k, i) => (
        <motion.li
          key={k}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...spring.smooth, delay: 0.2 + staggerDelay(i) }}
          className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2 text-small"
        >
          <span className="flex items-center gap-2">
            <Sparkles size={14} className="text-accent-ink" aria-hidden />
            {t(`pdf.sanitize.items.${k}` as TKey)}
          </span>
          <span className="tabular-nums text-text-2">{report[k]}</span>
        </motion.li>
      ))}
    </ul>
  )
}

function Editor({ source, runner }: { source: PdfSource; runner: Runner<SanitizeReport> }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [o, setO] = useState<SanitizeOptions>({
    metadata: true,
    javascript: true,
    attachments: true,
    annotations: false,
    links: false,
    forms: false,
    bookmarks: false,
    thumbnails: true,
    layers: false,
  })
  const any = KEYS.some((k) => o[k])
  const run = () => {
    const name = outputName(source.name, t('pdf.actions.sanitize'), 'pdf', pattern)
    void runner.start(t('pdf.sanitize.task', { name: source.name }), async ({ progress }) => {
      progress(null)
      const { bytes, report } = await sanitizePdf(await sourceBytes(source), o)
      return {
        files: [{ blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name }],
        data: report,
      }
    }, { minDuration: 700 })
  }
  return (
    <Workspace
      main={
        <div className="card grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
          {KEYS.map((k, i) => (
            <motion.div
              key={k}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.smooth, delay: staggerDelay(i) }}
            >
              <Switch
                label={t(`pdf.sanitize.items.${k}` as TKey)}
                description={t(`pdf.sanitize.hints.${k}` as TKey)}
                checked={o[k]}
                onChange={(v) => setO((p) => ({ ...p, [k]: v }))}
              />
            </motion.div>
          ))}
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.sanitize.title')}>
          <p className="text-small text-text-2">{t('pdf.sanitize.desc')}</p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!any}
              leading={<ShieldCheck size={18} aria-hidden />}
              onClick={run}
            >
              {t('pdf.sanitize.run')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
