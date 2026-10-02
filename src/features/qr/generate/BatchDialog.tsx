import { FileSpreadsheet } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import { Button, Callout, Dialog, FileName, SegmentedControl, Switch, toast } from '@/components/ui'
import { useTask, isAbortError } from '@/stores/tasks'
import { useRecents } from '@/stores/recents'
import { downloadBlob } from '@/lib/download'
import { createZip, type ZipEntry } from '@/lib/zip'
import { useT } from '@/i18n'
import { batchFileStem, parseCsvEntries, parseLines, type BatchEntry } from '../lib/batch'
import { buildGeometry } from '../lib/geometry'
import { createMatrixSync, loadQrLib, QrTooLongError } from '../lib/matrix'
import { exportBlob, loadLogoImage, svgBlob } from '../lib/render'
import { useQrStore } from '../store'

export const BATCH_MAX = 500

type Source = 'lines' | 'csv'

/** 批次產生：多行文字或 CSV → 每筆一個 PNG＋SVG → ZIP（走任務中心） */
export function BatchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const run = useTask('qr')
  const textId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<Source>('lines')
  const [text, setText] = useState('')
  const [csv, setCsv] = useState<{ name: string; entries: BatchEntry[] } | null>(null)
  const [png, setPng] = useState(true)
  const [svg, setSvg] = useState(true)
  const size = useQrStore((s) => s.style.size)

  const entries = useMemo(
    () => (source === 'lines' ? parseLines(text) : (csv?.entries ?? [])),
    [source, text, csv],
  )
  const count = Math.min(entries.length, BATCH_MAX)

  const readCsv = async (file: File | undefined) => {
    if (!file) return
    try {
      const content = await file.text()
      setCsv({ name: file.name, entries: parseCsvEntries(content) })
    } catch (e) {
      console.error(e)
      toast.error(t('qr.batch.csvFailed'), { description: t('qr.batch.csvFailedDesc') })
    }
  }

  const start = () => {
    const list = entries.slice(0, BATCH_MAX)
    const style = useQrStore.getState().style
    const ecc = style.logo ? 'H' : style.ecc
    const wantPng = png
    const wantSvg = svg
    onOpenChange(false)
    let skipped = 0
    run(t('qr.batch.task', { count: list.length }), async ({ signal, progress }) => {
      const lib = await loadQrLib()
      const logo = style.logo ? await loadLogoImage(style.logo.src) : null
      const files: ZipEntry[] = []
      for (let i = 0; i < list.length; i++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const entry = list[i]
        let matrix
        try {
          matrix = createMatrixSync(lib, entry.content, ecc)
        } catch (e) {
          if (e instanceof QrTooLongError) {
            skipped++
            continue
          }
          throw e
        }
        const geo = buildGeometry(matrix, style)
        const stem = batchFileStem(entry, i, list.length)
        if (wantSvg) files.push({ name: `${stem}.svg`, data: svgBlob(geo, style) })
        if (wantPng) files.push({ name: `${stem}.png`, data: await exportBlob(geo, style, 'png', { logo }) })
        progress(((i + 1) / list.length) * 0.9)
        // 讓出主執行緒，畫面與進度保持流暢
        await new Promise((r) => setTimeout(r, 0))
      }
      if (!files.length) throw new QrTooLongError()
      const zip = await createZip(files, signal)
      progress(1)
      const name = `${t('qr.batch.zipName')}_${list.length - skipped}.zip`
      downloadBlob(zip, name)
      useRecents.getState().visit('qr', name)
      return [{ blob: zip, name }]
    })
      .then(() => {
        toast.success(t('qr.batch.done', { count: list.length - skipped }), {
          description:
            t('qr.batch.doneDesc') + (skipped ? ` ${t('qr.batch.skipped', { count: skipped })}` : ''),
        })
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return
        console.error(e)
        toast.error(t('qr.batch.failed'), {
          description: e instanceof QrTooLongError ? t('qr.preview.tooLongDesc') : t('qr.batch.failedDesc'),
        })
      })
  }

  const preview = entries.slice(0, 5)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('qr.batch.title')}
      description={t('qr.batch.desc')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!count || (!png && !svg)} onClick={start}>
            {t('qr.batch.run', { count })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl<Source>
          label={t('qr.batch.sourceLabel')}
          value={source}
          onChange={setSource}
          options={[
            { value: 'lines', label: t('qr.batch.lines') },
            { value: 'csv', label: t('qr.batch.csv') },
          ]}
        />
        {source === 'lines' ? (
          <div className="flex flex-col">
            <label htmlFor={textId} className="label">
              {t('qr.batch.linesLabel')}
            </label>
            <textarea
              id={textId}
              rows={7}
              className="field font-mono text-small"
              value={text}
              spellCheck={false}
              placeholder={t('qr.batch.linesPlaceholder')}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                leading={<FileSpreadsheet size={16} aria-hidden />}
                onClick={() => fileRef.current?.click()}
              >
                {t('qr.batch.csvPick')}
              </Button>
              <span className="min-w-0 flex-1 text-small text-text-2">
                {csv ? <FileName name={csv.name} /> : t('qr.batch.csvEmpty')}
              </span>
            </div>
            <p className="text-caption text-text-3">{t('qr.batch.csvHint')}</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                void readCsv(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        )}

        {entries.length > 0 && (
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="mb-2 text-small font-medium text-text" aria-live="polite">
              {t('qr.batch.count', { count: entries.length })}
            </p>
            <ol className="flex flex-col gap-1 text-small">
              {preview.map((e, i) => (
                <li key={i} className="flex min-w-0 items-baseline gap-2">
                  <span className="w-8 shrink-0 text-right text-caption tabular-nums text-text-3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-text-2">{e.content}</span>
                  <span className="max-w-[40%] shrink-0 truncate text-caption text-text-3">
                    {batchFileStem(e, i, entries.length)}
                  </span>
                </li>
              ))}
            </ol>
            {entries.length > preview.length && (
              <p className="mt-1 pl-10 text-caption text-text-3">
                {t('qr.batch.more', { count: entries.length - preview.length })}
              </p>
            )}
          </div>
        )}
        {entries.length > BATCH_MAX && (
          <Callout tone="warning">{t('qr.batch.tooMany', { max: BATCH_MAX })}</Callout>
        )}

        <div className="flex flex-col gap-2">
          <span className="label mb-0">{t('qr.batch.formats')}</span>
          <div className="grid max-w-xs grid-cols-2 gap-6">
            <Switch checked={png} onChange={setPng} label={t('qr.batch.includePng')} />
            <Switch checked={svg} onChange={setSvg} label={t('qr.batch.includeSvg')} />
          </div>
          <p className={!png && !svg ? 'text-caption text-warning-ink' : 'text-caption text-text-3'}>
            {!png && !svg ? t('qr.batch.needFormat') : t('qr.batch.styleNote', { size })}
          </p>
        </div>
      </div>
    </Dialog>
  )
}
