import { motion } from 'motion/react'
import { BookOpen, Combine, Lock, LayoutGrid } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import {
  AddFilesButton,
  Badge,
  Button,
  Callout,
  FileCard,
  FileName,
  SortableList,
  Spinner,
} from '@/components/ui'
import { duration, spring, stagger } from '@/design/motion'
import { formatBytes } from '@/lib/format'
import { outputName } from '@/lib/filename'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { assemble, type PlanItem } from '../lib/ops'
import { parsePageRange, type PageRangeResult } from '../lib/pageRange'
import { addPdfFiles, sourceBytes, usePdf, type PdfSource } from '../store'
import { PageThumb } from '../components/PageThumb'
import { RangeInput } from '../components/RangeInput'
import { ResultCard } from '../components/ResultCard'
import { Working } from '../components/Working'
import { useRunner } from '../components/useRunner'
import {
  PDF_ACCEPT,
  PdfDrop,
  useGoTool,
  useStage,
  ToolPanel,
  PanelFooter,
} from '../components/Shared'
import { asFile } from '@/stores/fileBus'

export function MergeTool() {
  const t = useT()
  const sources = usePdf((s) => s.sources)
  const reorder = usePdf((s) => s.reorder)
  const remove = usePdf((s) => s.remove)
  const pattern = useSettings((s) => s.filenamePattern)
  const [ranges, setRanges] = useState<Record<string, string>>({})
  const runner = useRunner()
  const go = useGoTool()
  useStage(
    runner.phase === 'working'
      ? 'working'
      : runner.phase === 'done'
        ? 'done'
        : sources.length
          ? 'ready'
          : 'empty',
  )

  const parsed = useMemo(() => {
    const out: Record<string, PageRangeResult | null> = {}
    for (const s of sources) {
      const v = (ranges[s.id] ?? '').trim()
      out[s.id] = v && s.status === 'ready' ? parsePageRange(v, s.pageCount) : null
    }
    return out
  }, [sources, ranges])

  const ready = sources.filter((s) => s.status === 'ready')
  const loading = sources.some((s) => s.status === 'loading')
  const encrypted = ready.filter((s) => s.encrypted)
  const hasForm = ready.some((s) => s.hasForm)
  const invalid = ready.some((s) => parsed[s.id] && !parsed[s.id]!.ok)
  const pagesOf = (s: PdfSource) => {
    const r = parsed[s.id]
    return r && r.ok ? r.pages.length : s.pageCount
  }
  const totalPages = ready.reduce((n, s) => n + pagesOf(s), 0)
  const canMerge = ready.length >= 2 && !loading && !encrypted.length && !invalid

  const merge = () => {
    const list = ready
    const first = list[0]
    const name = outputName(first.name, t('pdf.actions.merge'), 'pdf', pattern)
    void runner.start(
      t('pdf.merge.task', { count: list.length }),
      async ({ signal, progress }) => {
        const bytes: Uint8Array[] = []
        for (const s of list) bytes.push(await sourceBytes(s))
        const plan: PlanItem[] = []
        list.forEach((s, src) => {
          const r = parsed[s.id]
          const pages = r && r.ok ? r.pages : Array.from({ length: s.pageCount }, (_, i) => i + 1)
          pages.forEach((p) => plan.push({ kind: 'page', src, page: p - 1 }))
        })
        const out = await assemble(bytes, plan, { signal, onProgress: progress })
        return {
          files: [
            { blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name },
          ],
        }
      },
      { minDuration: duration.hero + duration.slow },
    )
  }

  if (runner.phase === 'working')
    return (
      <Working
        title={t('pdf.merge.working', { count: ready.length })}
        progress={runner.progress}
        onCancel={runner.cancel}
      >
        <PaperStack sources={ready} />
      </Working>
    )

  if (runner.phase === 'done' && runner.output) {
    const file = runner.output.files[0]
    const openAs = async (tool: 'viewer' | 'organize') => {
      await addPdfFiles([asFile(file.blob, file.name)])
      const s = usePdf.getState().sources
      usePdf.getState().setActive(s[s.length - 1].id)
      go(tool)
    }
    return (
      <ResultCard
        files={runner.output.files}
        summary={t('pdf.merge.done', {
          count: ready.length,
          pages: totalPages,
          size: formatBytes(file.blob.size),
        })}
        onReset={runner.reset}
        resetLabel={t('pdf.merge.again')}
        actions={
          <>
            <Button
              variant="secondary"
              leading={<BookOpen size={16} aria-hidden />}
              onClick={() => openAs('viewer')}
            >
              {t('pdf.result.openViewer')}
            </Button>
            <Button
              variant="ghost"
              leading={<LayoutGrid size={16} aria-hidden />}
              onClick={() => openAs('organize')}
            >
              {t('pdf.result.organize')}
            </Button>
          </>
        }
      />
    )
  }

  if (!sources.length) return <PdfDrop title={t('pdf.drop.pdfsTitle')} multiple />

  return (
    <Workspace
      main={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-small text-text-2">{t('pdf.merge.hint')}</p>
            <AddFilesButton onFiles={(f) => void addPdfFiles(f)} accept={PDF_ACCEPT} size="sm" />
          </div>
          <SortableList
            items={sources}
            getId={(s) => s.id}
            onReorder={(items) => reorder(items.map((s) => s.id))}
            label={t('pdf.merge.listLabel')}
            render={(s, i, handle) => (
              <FileCard
                onRemove={() => remove(s.id)}
                removeLabel={t('pdf.source.remove')}
                className="items-start sm:items-center"
              >
                <div className="flex shrink-0 items-center gap-1 self-center">
                  {handle}
                  <span className="w-5 text-center text-caption font-semibold tabular-nums text-text-3">
                    {i + 1}
                  </span>
                </div>
                <div className="w-12 shrink-0 self-center overflow-hidden rounded-[4px] border border-border shadow-e1">
                  {s.status === 'ready' ? (
                    <PageThumb
                      docId={s.id}
                      index={0}
                      aspect={s.sizes[0] ? s.sizes[0].w / s.sizes[0].h : 0.707}
                      renderWidth={96}
                    />
                  ) : (
                    <div className="grid aspect-[0.707] place-items-center bg-surface-2">
                      <Spinner size={16} />
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <FileName name={s.name} className="text-body font-medium" />
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-caption text-text-3">
                      <span className="tabular-nums">
                        {s.status === 'ready'
                          ? t('pdf.source.meta', { pages: s.pageCount, size: formatBytes(s.size) })
                          : t('pdf.source.opening')}
                      </span>
                      {s.encrypted && (
                        <Badge
                          tone="warning"
                          className="h-5 px-2"
                          icon={<Lock size={11} aria-hidden />}
                        >
                          {t('pdf.source.encrypted')}
                        </Badge>
                      )}
                    </p>
                  </div>
                  {s.status === 'ready' && (
                    <RangeInput
                      value={ranges[s.id] ?? ''}
                      onChange={(v) => setRanges((r) => ({ ...r, [s.id]: v }))}
                      result={parsed[s.id]}
                      label={t('pdf.merge.rangeLabel', { name: s.name })}
                      hideLabel
                      size="sm"
                      placeholder={t('pdf.merge.allPages', { count: s.pageCount })}
                      hint={t('pdf.merge.rangeHint')}
                      className="sm:w-[200px]"
                    />
                  )}
                </div>
              </FileCard>
            )}
          />
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.merge.summary')}>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-md bg-surface-2 px-3 py-2.5">
              <dt className="text-caption text-text-3">{t('pdf.merge.files')}</dt>
              <dd className="text-h2 font-semibold tabular-nums">{ready.length}</dd>
            </div>
            <div className="rounded-md bg-surface-2 px-3 py-2.5">
              <dt className="text-caption text-text-3">{t('pdf.merge.pages')}</dt>
              <dd className="text-h2 font-semibold tabular-nums">{totalPages}</dd>
            </div>
          </dl>
          {encrypted.length > 0 && (
            <Callout tone="danger" icon={<Lock size={16} />} title={t('pdf.merge.encryptedTitle')}>
              <p>{t('pdf.merge.encryptedDesc', { name: encrypted[0].name })}</p>
              <Button
                size="sm"
                className="mt-2"
                variant="secondary"
                onClick={() => {
                  usePdf.getState().setActive(encrypted[0].id)
                  go('unlock')
                }}
              >
                {t('pdf.notice.unlockAction')}
              </Button>
            </Callout>
          )}
          {hasForm && !encrypted.length && (
            <Callout tone="warning" title={t('pdf.notice.formTitle')}>
              {t('pdf.notice.formDesc')}
            </Callout>
          )}
          {ready.length < 2 && !loading && (
            <p className="text-small text-text-3">{t('pdf.merge.needTwo')}</p>
          )}
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!canMerge}
              loading={loading}
              leading={<Combine size={18} aria-hidden />}
              onClick={merge}
            >
              {t('pdf.merge.start')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}

/** 合併時的 3D 疊牌：每份文件的第一頁像紙張一樣依序落下疊起來 */
function PaperStack({ sources }: { sources: PdfSource[] }) {
  const list = sources.slice(0, 8)
  return (
    <div
      className="grid h-[220px] w-full place-items-center"
      style={{ perspective: 900 }}
      aria-hidden
    >
      <div
        className="relative h-[168px] w-[124px]"
        style={{ transformStyle: 'preserve-3d', transform: 'rotateX(48deg) rotateZ(-14deg)' }}
      >
        {list.map((s, i) => (
          <motion.div
            key={s.id}
            className="absolute inset-0 overflow-hidden rounded-[4px] border border-border bg-white shadow-e3"
            initial={{
              z: 220,
              opacity: 0,
              rotate: (i % 2 ? 1 : -1) * 18,
              x: (i % 2 ? 1 : -1) * 60,
            }}
            animate={{ z: i * 7, opacity: 1, rotate: (i % 3) - 1, x: 0 }}
            transition={{
              ...spring.gentle,
              delay: 0.05 + Math.min(i, stagger.max) * stagger.step * 3,
            }}
          >
            <PageThumb
              docId={s.id}
              index={0}
              aspect={s.sizes[0] ? s.sizes[0].w / s.sizes[0].h : 0.707}
              renderWidth={96}
              className="size-full"
            />
          </motion.div>
        ))}
      </div>
    </div>
  )
}
