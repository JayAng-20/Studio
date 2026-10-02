import { motion, AnimatePresence } from 'motion/react'
import { AlertTriangle, ClipboardPaste, FileCode2, FileText, FileType2, Image as ImageIcon, Trash2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  AddFilesButton,
  Badge,
  Button,
  FileName,
  SegmentedControl,
  Select,
  SortableList,
  Spinner,
  Tooltip,
} from '@/components/ui'
import { spring, staggerDelay } from '@/design/motion'
import { formatBytes } from '@/lib/format'
import { useT } from '@/i18n'
import { ENCODINGS, ENCODING_LABEL, type TextEncodingId } from '../engine/encoding'
import { ACCEPT, useDoc2Pdf, type Source } from '../store'

const KIND_ICON = { md: FileCode2, txt: FileText, rtf: FileType2 }

export function SourceList({ onFiles, onPaste }: { onFiles: (f: File[]) => void; onPaste: () => void }) {
  const t = useT()
  const sources = useDoc2Pdf((s) => s.sources)
  const reorder = useDoc2Pdf((s) => s.reorder)
  const clear = useDoc2Pdf((s) => s.clear)
  const merge = useDoc2Pdf((s) => s.merge)
  return (
    <section className="flex flex-col gap-3" aria-labelledby="doc2pdf-files">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 id="doc2pdf-files" className="text-h3 font-semibold">
            {t('doc2pdf.files.title')}
          </h3>
          <span className="text-small tabular-nums text-text-3">{sources.length}</span>
          {merge && sources.length > 1 && <span className="hidden text-caption text-text-3 sm:inline">· {t('doc2pdf.files.reorderHint')}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" leading={<Trash2 size={16} aria-hidden />} onClick={clear}>
            {t('doc2pdf.files.clear')}
          </Button>
          <Button size="sm" variant="ghost" leading={<ClipboardPaste size={16} aria-hidden />} onClick={onPaste}>
            {t('doc2pdf.pasteText')}
          </Button>
          <AddFilesButton size="sm" accept={ACCEPT} onFiles={onFiles} label={t('doc2pdf.files.add')} />
        </div>
      </div>
      <SortableList
        items={sources}
        getId={(s) => s.id}
        onReorder={sources.length > 1 ? reorder : undefined}
        label={t('doc2pdf.files.listLabel')}
        render={(s, _i, handle) => <SourceCard source={s} handle={handle} />}
      />
      <Attachments />
    </section>
  )
}

function SourceCard({ source: s, handle }: { source: Source; handle: ReactNode }) {
  const t = useT()
  const remove = useDoc2Pdf((st) => st.remove)
  const setEncoding = useDoc2Pdf((st) => st.setEncoding)
  const setRaw = useDoc2Pdf((st) => st.setRaw)
  const Icon = KIND_ICON[s.kind]
  const name = s.pasted ? s.name.replace(/\.(md|txt)$/, '') : s.name
  return (
    <div className="card relative flex flex-col">
      <Tooltip content={t('common.remove')}>
        <button
          type="button"
          onClick={() => remove(s.id)}
          aria-label={t('doc2pdf.files.remove', { name })}
          className="absolute right-1.5 top-1.5 grid size-11 place-items-center rounded-md text-text-3 transition-colors hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-danger-ink sm:right-2 sm:top-3 sm:size-9"
        >
          <X size={16} aria-hidden />
        </button>
      </Tooltip>
      <div className="flex items-center gap-2 p-2.5 pr-14">
        {handle}
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
          {s.status === 'parsing' ? <Spinner size={20} /> : <Icon size={20} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <FileName name={name} className="min-w-0 text-body font-medium" />
            <Badge className="hidden sm:inline-flex">{s.pasted ? t('doc2pdf.files.pasted') : t(`doc2pdf.files.kind.${s.kind}`)}</Badge>
          </div>
          <p className="truncate text-caption tabular-nums text-text-3" aria-live="polite">
            {s.status === 'parsing'
              ? t('doc2pdf.files.parsing')
              : s.status === 'error'
                ? formatBytes(s.size)
                : `${formatBytes(s.size)} · ${t('doc2pdf.files.stats', {
                    headings: s.stats?.headings ?? 0,
                    tables: s.stats?.tables ?? 0,
                    chars: (s.stats?.chars ?? 0).toLocaleString(),
                  })}`}
          </p>
        </div>
      </div>
      {s.status === 'error' && s.error && (
        <p role="alert" className="mx-2.5 mb-2.5 flex items-start gap-2 rounded-sm bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-small text-danger-ink">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {t(`doc2pdf.files.errors.${s.error}`)}
        </p>
      )}
      {s.kind !== 'rtf' && !s.pasted && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-border px-3 py-2.5">
          <Select<TextEncodingId>
            size="sm"
            className="w-[150px]"
            label={t('doc2pdf.files.encoding')}
            value={s.encoding ?? 'utf-8'}
            onChange={(v) => setEncoding(s.id, v)}
            options={ENCODINGS.map((e) => ({
              value: e,
              label: e === s.detected ? t('doc2pdf.files.encodingAuto', { name: ENCODING_LABEL[e] }) : ENCODING_LABEL[e],
            }))}
          />
          {s.kind === 'txt' && (
            <div className="flex flex-col">
              <span className="label">{t('doc2pdf.files.mode')}</span>
              <SegmentedControl<'detect' | 'raw'>
                size="sm"
                label={t('doc2pdf.files.mode')}
                value={s.raw ? 'raw' : 'detect'}
                onChange={(v) => setRaw(s.id, v === 'raw')}
                options={[
                  { value: 'detect', label: t('doc2pdf.files.modeDetect') },
                  { value: 'raw', label: t('doc2pdf.files.modeRaw'), title: t('doc2pdf.files.modeRawHint') },
                ]}
              />
            </div>
          )}
          {s.lossy && s.status !== 'parsing' && (
            <p className="flex basis-full items-center gap-1.5 text-caption text-warning-ink">
              <AlertTriangle size={14} aria-hidden />
              {t('doc2pdf.files.encodingLossy')}
            </p>
          )}
          {s.kind === 'txt' && s.raw && <p className="basis-full text-caption text-text-3">{t('doc2pdf.files.modeRawHint')}</p>}
        </div>
      )}
    </div>
  )
}

function Attachments() {
  const t = useT()
  const atts = useDoc2Pdf((s) => s.attachments)
  const removeAttachment = useDoc2Pdf((s) => s.removeAttachment)
  if (!atts.length) return null
  return (
    <div className="card flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2 text-small font-medium">
        <ImageIcon size={16} className="text-text-3" aria-hidden />
        {t('doc2pdf.files.images')}
        <span className="tabular-nums text-text-3">{atts.length}</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        <AnimatePresence initial={false}>
          {atts.map((a, i) => (
            <motion.li
              key={a.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ ...spring.smooth, delay: staggerDelay(i) }}
              className="flex max-w-[220px] items-center gap-2 rounded-md bg-surface-2 py-1 pl-1 pr-1"
            >
              <img src={a.url} alt="" className="size-8 shrink-0 rounded-[4px] object-cover" />
              <FileName name={a.name} className="min-w-0 text-caption" />
              <Tooltip content={t('doc2pdf.files.removeImage', { name: a.name })}>
                <Button
                  icon
                  size="sm"
                  variant="ghost"
                  aria-label={t('doc2pdf.files.removeImage', { name: a.name })}
                  onClick={() => removeAttachment(a.id)}
                >
                  <X size={14} aria-hidden />
                </Button>
              </Tooltip>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <p className="text-caption text-text-3">{t('doc2pdf.files.imagesHint')}</p>
    </div>
  )
}
