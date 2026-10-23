import { Eraser, Save } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, Skeleton } from '@/components/ui'
import { outputName } from '@/lib/filename'
import { useSettings } from '@/stores/settings'
import { useLang, useT, type TKey } from '@/i18n'
import { readMeta, writeMeta, type PdfMeta } from '../lib/ops'
import { sourceBytes, type PdfSource } from '../store'
import { ResultCard } from '../components/ResultCard'
import { Working } from '../components/Working'
import { useRunner, type Runner } from '../components/useRunner'
import {
  PdfDrop,
  SourceBar,
  SourceNotices,
  editBlocked,
  useActiveSource,
  useStage,
  ToolPanel,
  PanelFooter,
} from '../components/Shared'
import { toolById } from '../tools'

type EditableKey = 'title' | 'author' | 'subject' | 'keywords'
const FIELDS: EditableKey[] = ['title', 'author', 'subject', 'keywords']

export function MetaTool() {
  const t = useT()
  const source = useActiveSource()
  const runner = useRunner()
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
      <Working title={t('pdf.meta.working')} progress={runner.progress} onCancel={runner.cancel} />
    )
  if (runner.phase === 'done' && runner.output)
    return (
      <ResultCard
        files={runner.output.files}
        onReset={runner.reset}
        resetLabel={t('pdf.meta.backToEdit')}
      />
    )
  return (
    <div className="flex flex-col gap-3">
      <SourceBar source={source} />
      <SourceNotices source={source} tool={toolById.meta} />
      {source.status === 'ready' && !editBlocked(source, toolById.meta) && (
        <MetaEditor key={source.id} source={source} runner={runner} />
      )}
    </div>
  )
}

function MetaEditor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const lang = useLang()
  const id = useId()
  const pattern = useSettings((s) => s.filenamePattern)
  const [meta, setMeta] = useState<PdfMeta | null>(null)
  const [form, setForm] = useState<Record<EditableKey, string>>({
    title: '',
    author: '',
    subject: '',
    keywords: '',
  })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    sourceBytes(source)
      .then(readMeta)
      .then((m) => {
        if (!alive) return
        setMeta(m)
        setForm({ title: m.title, author: m.author, subject: m.subject, keywords: m.keywords })
      })
      .catch((e) => {
        console.error(e)
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [source])

  const dirty = !!meta && FIELDS.some((k) => form[k] !== meta[k])
  const fmtDate = (d?: Date) =>
    d ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(d) : '—'

  const save = (clear: boolean) => {
    const name = outputName(source.name, t('pdf.actions.meta'), 'pdf', pattern)
    const values = { ...form }
    void runner.start(t('pdf.meta.task', { name: source.name }), async ({ progress }) => {
      progress(null)
      const out = await writeMeta(await sourceBytes(source), values, clear)
      return {
        files: [
          { blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name },
        ],
      }
    })
  }

  if (failed)
    return (
      <p className="card p-5 text-body text-text-2">
        {t('pdf.errors.invalidDesc', { name: source.name })}
      </p>
    )

  return (
    <Workspace
      main={
        <div className="card flex flex-col gap-4 p-5">
          {FIELDS.map((k) => (
            <div key={k} className="flex flex-col">
              <label htmlFor={`${id}-${k}`} className="label">
                {t(`pdf.meta.${k}` as TKey)}
              </label>
              {meta ? (
                k === 'subject' ? (
                  <textarea
                    id={`${id}-${k}`}
                    className="field"
                    rows={2}
                    value={form[k]}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  />
                ) : (
                  <input
                    id={`${id}-${k}`}
                    className="field"
                    value={form[k]}
                    placeholder={k === 'keywords' ? t('pdf.meta.keywordsPlaceholder') : undefined}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  />
                )
              ) : (
                <Skeleton className="h-10" />
              )}
              {k === 'keywords' && (
                <p className="mt-1 text-caption text-text-3">{t('pdf.meta.keywordsHint')}</p>
              )}
            </div>
          ))}
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.meta.readonly')}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-small">
            {(
              [
                ['creator', meta?.creator || '—'],
                ['producer', meta?.producer || '—'],
                ['created', fmtDate(meta?.created)],
                ['modified', fmtDate(meta?.modified)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-text-3">{t(`pdf.meta.${k}` as TKey)}</dt>
                <dd className="min-w-0 truncate text-text" title={v}>
                  {meta ? v : <Skeleton className="h-4 w-24" />}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-caption text-text-3">{t('pdf.meta.note')}</p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!meta || !dirty}
              leading={<Save size={18} aria-hidden />}
              onClick={() => save(false)}
            >
              {t('pdf.meta.save')}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={!meta}
              leading={<Eraser size={16} aria-hidden />}
              onClick={() => save(true)}
            >
              {t('pdf.meta.clear')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
