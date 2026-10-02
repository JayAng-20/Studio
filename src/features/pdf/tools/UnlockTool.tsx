import { BookOpen, Check, Lock, LockOpen, ShieldCheck } from 'lucide-react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, Callout, toast } from '@/components/ui'
import { outputName } from '@/lib/filename'
import { asFile } from '@/stores/fileBus'
import { useSettings } from '@/stores/settings'
import { useT, type TKey } from '@/i18n'
import { decryptPdf } from '../lib/unlock'
import { getDoc, replaceSource, usePdf } from '../store'
import { ResultCard } from '../components/ResultCard'
import { Working } from '../components/Working'
import { useRunner } from '../components/useRunner'
import {
  PdfDrop,
  SourceBar,
  useActiveSource,
  useGoTool,
  useStage,
  ToolPanel,
  PanelFooter,
} from '../components/Shared'

export function UnlockTool() {
  const t = useT()
  const source = useActiveSource()
  const pattern = useSettings((s) => s.filenamePattern)
  const runner = useRunner()
  const go = useGoTool()
  const sourceCount = usePdf((s) => s.sources.length)
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
  if (runner.phase === 'working')
    return (
      <Working
        title={t('pdf.unlock.working')}
        progress={runner.progress}
        onCancel={runner.cancel}
      />
    )
  if (runner.phase === 'done' && runner.output) {
    const file = runner.output.files[0]
    const applyResult = async (tool?: 'viewer') => {
      const id = await replaceSource(source.id, asFile(file.blob, file.name))
      if (!id) return
      toast.success(t('pdf.unlock.replaced'))
      runner.reset()
      if (tool) go(tool)
    }
    return (
      <ResultCard
        files={runner.output.files}
        summary={t('pdf.unlock.done')}
        onReset={runner.reset}
        actions={
          <>
            <Button
              variant="secondary"
              leading={<LockOpen size={16} aria-hidden />}
              onClick={() => applyResult()}
            >
              {t('pdf.unlock.useIt')}
            </Button>
            <Button
              variant="ghost"
              leading={<BookOpen size={16} aria-hidden />}
              onClick={() => applyResult('viewer')}
            >
              {t('pdf.result.openViewer')}
            </Button>
          </>
        }
      />
    )
  }

  const ready = source.status === 'ready'
  const kind: 'none' | 'password' | 'owner' = !source.encrypted
    ? 'none'
    : source.password
      ? 'password'
      : 'owner'
  const run = () => {
    const name = outputName(source.name, t('pdf.actions.unlock'), 'pdf', pattern)
    void runner.start(t('pdf.unlock.task', { name: source.name }), async ({ progress }) => {
      progress(null)
      const doc = await getDoc(source.id)
      const out = await decryptPdf(doc)
      return {
        files: [
          { blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name },
        ],
      }
    })
  }
  const points: TKey[] = ['pdf.unlock.point1', 'pdf.unlock.point2', 'pdf.unlock.point3']
  return (
    <div className="flex flex-col gap-3">
      <SourceBar source={source} />
      <Workspace
        main={
          <div className="card flex flex-col items-center gap-4 px-6 py-10 text-center">
            <span
              className={`grid size-16 place-items-center rounded-2xl ${
                kind === 'none'
                  ? 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-success-ink'
                  : 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent-ink'
              }`}
            >
              {kind === 'none' ? (
                <ShieldCheck size={30} aria-hidden />
              ) : (
                <Lock size={30} aria-hidden />
              )}
            </span>
            <div>
              <h3 className="text-h2 font-semibold">{t(`pdf.unlock.${kind}Title` as TKey)}</h3>
              <p className="mx-auto mt-1.5 max-w-lg text-body text-text-2">
                {t(`pdf.unlock.${kind}Desc` as TKey)}
              </p>
            </div>
            {kind !== 'none' && (
              <ul className="flex flex-col gap-1.5 text-left text-small text-text-2">
                {points.map((p) => (
                  <li key={p} className="flex items-start gap-2">
                    <Check size={15} className="mt-0.5 shrink-0 text-success-ink" aria-hidden />
                    {t(p)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        }
        panel={
          <ToolPanel title={t('pdf.tools.unlock.name')}>
            <Callout tone="neutral">{t('pdf.unlock.legal')}</Callout>
            <p className="text-caption text-text-3">{t('pdf.unlock.noEncrypt')}</p>
            <PanelFooter>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={!ready || kind === 'none'}
                leading={<LockOpen size={18} aria-hidden />}
                onClick={run}
              >
                {t('pdf.unlock.start')}
              </Button>
              {sourceCount > 1 && kind === 'none' && (
                <p className="text-caption text-text-3">{t('pdf.unlock.pickOther')}</p>
              )}
            </PanelFooter>
          </ToolPanel>
        }
      />
    </div>
  )
}
