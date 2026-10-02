import { motion } from 'motion/react'
import { FileCheck2, RotateCcw, TextCursorInput } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, Callout, EmptyState, Select, Skeleton, Switch } from '@/components/ui'
import { spring } from '@/design/motion'
import { outputName } from '@/lib/filename'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { fillForm, isLatin, readForm, type FormFieldInfo } from '../lib/form'
import { renderTextStamp } from '../lib/raster'
import { sourceBytes, type PdfSource } from '../store'
import { PageThumb } from '../components/PageThumb'
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

const NONE = '__none__'

export function FormTool() {
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
      <Working title={t('pdf.form.working')} progress={runner.progress} onCancel={runner.cancel} />
    )
  if (runner.phase === 'done' && runner.output)
    return (
      <ResultCard
        files={runner.output.files}
        onReset={runner.reset}
        resetLabel={t('pdf.form.backToEdit')}
      />
    )
  return (
    <div className="flex flex-col gap-3">
      <SourceBar source={source} />
      <SourceNotices source={source} tool={toolById.form} />
      {source.status === 'ready' && !editBlocked(source, toolById.form) && (
        <FormEditor key={source.id} source={source} runner={runner} />
      )}
    </div>
  )
}

/** 欄位名稱轉成較好讀的標籤（topmostSubform[0].Page1[0].Name → Name） */
const prettyName = (n: string) => {
  const last = n.split('.').pop() ?? n
  return (
    last
      .replace(/\[\d+\]$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || n
  )
}

function FormEditor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const id = useId()
  const pattern = useSettings((s) => s.filenamePattern)
  const [fields, setFields] = useState<FormFieldInfo[] | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [focus, setFocus] = useState<string | null>(null)
  const [flatten, setFlatten] = useState(false)

  useEffect(() => {
    let alive = true
    sourceBytes(source)
      .then(readForm)
      .then((f) => {
        if (!alive) return
        setFields(f)
        setValues(Object.fromEntries(f.map((x) => [x.name, x.value])))
      })
      .catch((e) => {
        console.error(e)
        if (alive) setFields([])
      })
    return () => {
      alive = false
    }
  }, [source])

  const editable = useMemo(() => (fields ?? []).filter((f) => f.kind !== 'other'), [fields])
  const groups = useMemo(() => {
    const m = new Map<number, FormFieldInfo[]>()
    for (const f of fields ?? []) {
      const list = m.get(f.page) ?? []
      list.push(f)
      m.set(f.page, list)
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [fields])
  const changed = (fields ?? []).filter((f) => values[f.name] !== f.value)
  const nonLatin = editable.some(
    (f) => (f.kind === 'text' || f.kind === 'dropdown') && !isLatin(values[f.name] ?? ''),
  )
  const focused = (fields ?? []).find((f) => f.name === focus) ?? editable[0]

  const set = (name: string, v: string) => setValues((s) => ({ ...s, [name]: v }))

  const save = () => {
    const name = outputName(source.name, t('pdf.actions.form'), 'pdf', pattern)
    const changes = Object.fromEntries(changed.map((f) => [f.name, values[f.name]]))
    const lock = flatten
    void runner.start(t('pdf.form.task', { name: source.name }), async ({ progress }) => {
      progress(null)
      const out = await fillForm(await sourceBytes(source), changes, {
        flatten: lock,
        renderText: (text, sizePt) => renderTextStamp({ text, sizePt, color: '#000000' }),
      })
      return {
        files: [
          { blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name },
        ],
      }
    })
  }

  if (!fields) return <Skeleton className="h-[320px] rounded-lg" />
  if (!editable.length)
    return (
      <div className="card">
        <EmptyState
          illustration={
            <span className="grid size-14 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
              <TextCursorInput size={26} aria-hidden />
            </span>
          }
          title={t('pdf.form.noFieldsTitle')}
          description={t('pdf.form.noFieldsDesc')}
        />
      </div>
    )

  return (
    <Workspace
      main={
        <div className="card flex flex-col gap-6 p-5">
          {groups.map(([page, list]) => (
            <section key={page} aria-labelledby={`${id}-p${page}`}>
              <h3 id={`${id}-p${page}`} className="mb-3 text-small font-semibold text-text-2">
                {t('pdf.grid.page', { n: page + 1 })}
              </h3>
              <div className="flex flex-col gap-4">
                {list.map((f) => {
                  const fid = `${id}-${f.name}`
                  const label = prettyName(f.name)
                  const common = {
                    onFocus: () => setFocus(f.name),
                    disabled: f.readOnly,
                  }
                  return (
                    <div
                      key={f.name}
                      className={cn(
                        'rounded-md transition-colors duration-(--dur-fast)',
                        focused?.name === f.name &&
                          'bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] -mx-2 px-2 py-1',
                      )}
                    >
                      {f.kind === 'checkbox' ? (
                        <div onFocusCapture={() => setFocus(f.name)}>
                          <Switch
                            label={label}
                            description={f.readOnly ? t('pdf.form.readOnly') : undefined}
                            checked={values[f.name] === 'true'}
                            onChange={(v) => set(f.name, v ? 'true' : '')}
                            disabled={f.readOnly}
                          />
                        </div>
                      ) : f.kind === 'radio' || f.kind === 'dropdown' ? (
                        <div onFocusCapture={() => setFocus(f.name)}>
                          <Select
                            label={label}
                            value={values[f.name] || NONE}
                            onChange={(v) => set(f.name, v === NONE ? '' : v)}
                            disabled={f.readOnly}
                            options={[
                              { value: NONE, label: t('pdf.form.unselected') },
                              ...f.options.map((o) => ({ value: o, label: o })),
                            ]}
                          />
                        </div>
                      ) : f.kind === 'list' ? (
                        <fieldset onFocusCapture={() => setFocus(f.name)}>
                          <legend className="label">{label}</legend>
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {f.options.map((o) => {
                              const sel = (values[f.name] ?? '').split('\n').filter(Boolean)
                              const on = sel.includes(o)
                              return (
                                <label key={o} className="flex items-center gap-2 text-body">
                                  <input
                                    type="checkbox"
                                    className="size-4 accent-[var(--accent)]"
                                    checked={on}
                                    disabled={f.readOnly}
                                    onChange={() =>
                                      set(
                                        f.name,
                                        (on ? sel.filter((x) => x !== o) : [...sel, o]).join('\n'),
                                      )
                                    }
                                  />
                                  {o}
                                </label>
                              )
                            })}
                          </div>
                        </fieldset>
                      ) : f.kind === 'text' ? (
                        <div className="flex flex-col">
                          <label htmlFor={fid} className="label">
                            {label}
                          </label>
                          {f.multiline ? (
                            <textarea
                              id={fid}
                              className="field"
                              rows={3}
                              value={values[f.name] ?? ''}
                              maxLength={f.maxLength}
                              onChange={(e) => set(f.name, e.target.value)}
                              {...common}
                            />
                          ) : (
                            <input
                              id={fid}
                              className="field"
                              value={values[f.name] ?? ''}
                              maxLength={f.maxLength}
                              onChange={(e) => set(f.name, e.target.value)}
                              {...common}
                            />
                          )}
                          {f.maxLength !== undefined && (
                            <p className="mt-1 text-right text-caption tabular-nums text-text-3">
                              {(values[f.name] ?? '').length} / {f.maxLength}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-small text-text-3">
                          {label}：{t('pdf.form.unsupportedField')}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.form.name')}>
          {focused && <FieldPreview source={source} field={focused} />}
          <p className="text-small text-text-2 tabular-nums">
            {t('pdf.form.stats', { count: editable.length, changed: changed.length })}
          </p>
          <Switch
            label={t('pdf.form.flatten')}
            description={t('pdf.form.flattenDesc')}
            checked={flatten}
            onChange={setFlatten}
          />
          {nonLatin && !flatten && (
            <Callout tone="accent" className="text-small">
              {t('pdf.form.cjkNote')}
            </Callout>
          )}
          <PanelFooter>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                disabled={!changed.length}
                leading={<RotateCcw size={15} aria-hidden />}
                onClick={() => setValues(Object.fromEntries(fields.map((x) => [x.name, x.value])))}
              >
                {t('common.reset')}
              </Button>
              <Button
                variant="primary"
                className="flex-[2]"
                disabled={!changed.length && !flatten}
                leading={<FileCheck2 size={16} aria-hidden />}
                onClick={save}
              >
                {t('pdf.form.save')}
              </Button>
            </div>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}

/** 目前欄位所在頁的預覽，並標出欄位位置 */
function FieldPreview({ source, field }: { source: PdfSource; field: FormFieldInfo }) {
  const t = useT()
  const size = source.sizes[field.page] ?? source.sizes[0] ?? { w: 595, h: 842 }
  const r = field.rect
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-md bg-surface-2 p-3">
      <div
        className="relative w-full max-w-[240px] overflow-hidden rounded-[3px] shadow-e2"
        style={{ aspectRatio: String(size.w / size.h) }}
      >
        <PageThumb
          docId={source.id}
          index={field.page}
          aspect={size.w / size.h}
          renderWidth={240}
          className="absolute inset-0"
        />
        {r && (
          <motion.span
            aria-hidden
            className="absolute rounded-[2px] border-2 border-accent bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]"
            initial={false}
            animate={{
              left: `${(r.x / size.w) * 100}%`,
              top: `${(r.y / size.h) * 100}%`,
              width: `${(r.w / size.w) * 100}%`,
              height: `${(r.h / size.h) * 100}%`,
            }}
            transition={spring.smooth}
          />
        )}
      </div>
      <p className="text-caption text-text-3">
        {t('pdf.form.where', { name: prettyName(field.name), n: field.page + 1 })}
      </p>
    </div>
  )
}
