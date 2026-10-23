import { motion } from 'motion/react'
import { Gauge, Wrench } from 'lucide-react'
import { Workspace } from '@/components/layout/ModulePage'
import { AnimatedNumber, Button } from '@/components/ui'
import { spring } from '@/design/motion'
import { outputName } from '@/lib/filename'
import { formatBytes } from '@/lib/format'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { optimizePdf, type OptimizeReport } from '../lib/acrobat'
import { decryptPdf } from '../lib/unlock'
import { getDoc, sourceBytes, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { ToolFrame } from '../components/Frame'
import { PanelFooter, ToolPanel } from '../components/Shared'

export function OptimizeTool() {
  const t = useT()
  const runner = useRunner<OptimizeReport>()
  return (
    <ToolFrame
      tool="optimize"
      runner={runner}
      workingTitle={t('pdf.optimize.working')}
      resetLabel={t('pdf.optimize.again')}
      resultSummary={(r) =>
        r
          ? t('pdf.optimize.summary', {
              before: formatBytes(r.before),
              after: formatBytes(r.after),
            })
          : null
      }
      resultExtra={(r) => (r ? <Stats r={r} /> : null)}
    >
      {(source) => <Editor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

function Stats({ r }: { r: OptimizeReport }) {
  const t = useT()
  const pct = Math.round((1 - r.after / Math.max(1, r.before)) * 100)
  const items = [
    { label: t('pdf.optimize.saved'), value: Math.max(0, pct), suffix: '%' },
    { label: t('pdf.optimize.removed'), value: r.removedObjects },
    { label: t('pdf.optimize.compressed'), value: r.compressedStreams },
  ]
  return (
    <div className="mt-4 grid w-full grid-cols-3 gap-2">
      {items.map((it, i) => (
        <motion.div
          key={it.label}
          initial={{ opacity: 0, y: 10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...spring.bouncy, delay: 0.25 + i * 0.08 }}
          className="rounded-md bg-surface-2 px-3 py-3 text-center"
        >
          <p className="text-h2 font-semibold tabular-nums text-accent-ink">
            <AnimatedNumber value={it.value} />
            {it.suffix}
          </p>
          <p className="text-caption text-text-3">{it.label}</p>
        </motion.div>
      ))}
      {r.repaired && (
        <p className="col-span-3 mt-1 flex items-center justify-center gap-1.5 text-small text-success-ink">
          <Wrench size={14} aria-hidden /> {t('pdf.optimize.repaired')}
        </p>
      )}
    </div>
  )
}

function Editor({ source, runner }: { source: PdfSource; runner: Runner<OptimizeReport> }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const run = () => {
    const name = outputName(source.name, t('pdf.actions.optimize'), 'pdf', pattern)
    void runner.start(t('pdf.optimize.task', { name: source.name }), async ({ progress }) => {
      progress(null)
      const { bytes, report } = await optimizePdf(await sourceBytes(source), async () =>
        decryptPdf(await getDoc(source.id)),
      )
      return {
        files: [{ blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name }],
        data: report,
      }
    }, { minDuration: 700 })
  }
  return (
    <Workspace
      main={
        <div className="card flex flex-col gap-3 p-5">
          <h3 className="text-h3 font-semibold">{t('pdf.optimize.what')}</h3>
          <ul className="flex flex-col gap-2 text-body text-text-2">
            {(['p1', 'p2', 'p3', 'p4'] as const).map((k) => (
              <li key={k} className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                {t(`pdf.optimize.${k}`)}
              </li>
            ))}
          </ul>
          <p className="text-small text-text-3">{t('pdf.optimize.tip')}</p>
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.optimize.name')}>
          <p className="text-small text-text-2">
            {t('pdf.optimize.current', { size: formatBytes(source.size) })}
          </p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              leading={<Gauge size={18} aria-hidden />}
              onClick={run}
            >
              {t('pdf.optimize.run')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
