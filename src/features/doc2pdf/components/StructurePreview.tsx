import { motion } from 'motion/react'
import { Check, FileText, ImageOff, Images, Link2Off, ListTree } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Callout, Select, Skeleton } from '@/components/ui'
import { spring, staggerDelay } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { buildEntries, type TocEntry } from '../engine/toc'
import { isExternalUrl, matchImageFile } from '../engine/images'
import { walkBlocks, type DocModel } from '../engine/model'
import { useDoc2Pdf } from '../store'

const MAX_ROWS = 400

interface Group {
  key: string
  name: string | null
  entries: TocEntry[]
  raw: boolean
}

export function StructurePreview() {
  const t = useT()
  const sources = useDoc2Pdf((s) => s.sources)
  const merge = useDoc2Pdf((s) => s.merge)
  const exclude = useDoc2Pdf((s) => s.exclude)
  const setExcluded = useDoc2Pdf((s) => s.setExcluded)
  const tocLevel = useDoc2Pdf((s) => s.options.tocLevel)
  const attachments = useDoc2Pdf((s) => s.attachments)
  const ready = useMemo(() => sources.filter((s) => s.status === 'ready' && s.doc), [sources])
  const [pick, setPick] = useState<string | null>(null)
  const picked = ready.find((s) => s.id === pick) ?? ready[0]

  const groups: Group[] = useMemo(() => {
    if (!ready.length) return []
    if (merge && ready.length > 1)
      return [
        {
          key: 'all',
          name: null,
          entries: buildEntries(
            ready.map((s) => s.doc!),
            new Map(),
          ),
          raw: false,
        },
      ]
    return [
      {
        key: picked.id,
        name: picked.name,
        entries: buildEntries([picked.doc!], new Map()),
        raw: picked.raw,
      },
    ]
  }, [ready, merge, picked])

  const all = groups.flatMap((g) => g.entries)
  const eligible = all.filter((e) => e.level <= tocLevel)
  const ex = new Set(exclude)
  const selected = eligible.filter((e) => !ex.has(e.id)).length

  const images = useMemo(
    () =>
      imageReport(
        ready.map((s) => s.doc!),
        attachments,
      ),
    [ready, attachments],
  )
  const parsing = sources.some((s) => s.status === 'parsing')

  return (
    <section className="card flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="doc2pdf-structure">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="doc2pdf-structure" className="flex items-center gap-2 text-h3 font-semibold">
            <ListTree size={18} className="text-accent-ink" aria-hidden />
            {t('doc2pdf.structure.tocDraft')}
          </h3>
          <p className="mt-0.5 text-small text-text-2">{t('doc2pdf.structure.desc')}</p>
        </div>
        {eligible.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="mr-1 text-caption tabular-nums text-text-3" aria-live="polite">
              {t('doc2pdf.structure.selected', { n: selected, total: eligible.length })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setExcluded(
                  eligible.map((e) => e.id),
                  false,
                )
              }
            >
              {t('doc2pdf.structure.all')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setExcluded(
                  eligible.map((e) => e.id),
                  true,
                )
              }
            >
              {t('doc2pdf.structure.none')}
            </Button>
          </div>
        )}
      </div>

      {!merge && ready.length > 1 && (
        <Select
          size="sm"
          className="max-w-xs"
          label={t('doc2pdf.structure.pickFile')}
          value={picked.id}
          onChange={setPick}
          options={ready.map((s) => ({ value: s.id, label: s.name }))}
        />
      )}

      {!ready.length && parsing ? (
        <div className="flex flex-col gap-2" aria-label={t('doc2pdf.structure.waiting')}>
          {[70, 52, 60, 44].map((w, i) => (
            <Skeleton
              key={i}
              className="h-5 rounded-sm"
              style={{ width: `${w}%`, marginLeft: i % 2 ? 24 : 0 }}
            />
          ))}
        </div>
      ) : all.length === 0 ? (
        <p className="rounded-md bg-surface-2 px-4 py-6 text-center text-small text-text-2">
          {groups[0]?.raw
            ? t('doc2pdf.structure.noHeadingsRaw')
            : t('doc2pdf.structure.noHeadings')}
        </p>
      ) : (
        <ul
          className="-mx-1 flex max-h-[min(60vh,560px)] flex-col overflow-y-auto pr-1"
          aria-label={t('doc2pdf.structure.tocDraft')}
        >
          {all.slice(0, MAX_ROWS).map((e, i) => (
            <EntryRow
              key={e.id}
              entry={e}
              index={i}
              beyond={e.level > tocLevel}
              checked={!ex.has(e.id)}
              onToggle={(on) => setExcluded([e.id], !on)}
            />
          ))}
          {all.length > MAX_ROWS && (
            <li className="px-3 py-2 text-caption text-text-3">… +{all.length - MAX_ROWS}</li>
          )}
        </ul>
      )}

      {(images.ok > 0 || images.external > 0 || images.missing > 0) && (
        <div className="flex flex-col gap-2">
          {images.ok > 0 && (
            <Callout tone="success" icon={<Images size={16} aria-hidden />}>
              {t('doc2pdf.structure.imagesOk', { n: images.ok })}
            </Callout>
          )}
          {images.external > 0 && (
            <Callout tone="neutral" icon={<Link2Off size={16} aria-hidden />}>
              {t('doc2pdf.structure.imagesExternal', { n: images.external })}
            </Callout>
          )}
          {images.missing > 0 && (
            <Callout tone="warning" icon={<ImageOff size={16} aria-hidden />}>
              {t('doc2pdf.structure.imagesMissing', { n: images.missing })}
            </Callout>
          )}
        </div>
      )}
    </section>
  )
}

function EntryRow({
  entry: e,
  index,
  beyond,
  checked,
  onToggle,
}: {
  entry: TocEntry
  index: number
  beyond: boolean
  checked: boolean
  onToggle: (on: boolean) => void
}) {
  const t = useT()
  const isFile = e.id.startsWith('doc:')
  const on = checked && !beyond
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...spring.smooth, delay: staggerDelay(index) }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-disabled={beyond}
        title={beyond ? t('doc2pdf.structure.beyondLevel') : undefined}
        onClick={() => !beyond && onToggle(!checked)}
        aria-label={t('doc2pdf.structure.toggle', { name: e.text })}
        className={cn(
          'group flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-(--dur-fast)',
          beyond ? 'cursor-default' : 'hover:bg-surface-2',
        )}
        style={{ paddingLeft: 8 + (e.level - 1) * 20 }}
      >
        <span
          aria-hidden
          className={cn(
            'grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors duration-(--dur-fast)',
            on ? 'border-transparent bg-accent text-white' : 'border-border-strong bg-surface',
            beyond && 'opacity-40',
          )}
        >
          {on && <Check size={13} strokeWidth={3} />}
        </span>
        {isFile && <FileText size={15} className="shrink-0 text-text-3" aria-hidden />}
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            e.level === 1 ? 'text-body font-semibold' : 'text-small',
            beyond || !checked ? 'text-text-3' : 'text-text',
            !checked && !beyond && 'line-through decoration-text-3/60',
          )}
        >
          {e.text}
        </span>
        <span className="shrink-0 rounded-sm bg-[color-mix(in_srgb,var(--text)_6%,transparent)] px-1.5 text-caption tabular-nums text-text-3">
          {isFile ? t('doc2pdf.structure.fileEntry') : t('doc2pdf.structure.level', { n: e.level })}
        </span>
      </button>
    </motion.li>
  )
}

function imageReport(docs: DocModel[], attachments: { name: string; path?: string }[]) {
  let ok = 0
  let external = 0
  let missing = 0
  for (const d of docs) {
    walkBlocks(d.blocks, (b) => {
      if (b.type !== 'image') return
      if (b.data || b.src.startsWith('data:')) ok++
      else if (isExternalUrl(b.src)) external++
      else if (b.src && matchImageFile(b.src, attachments)) ok++
      else missing++
    })
  }
  return { ok, external, missing }
}
