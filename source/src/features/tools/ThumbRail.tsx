/** 縮圖列：桌機為左側直列，平板與手機為橫向捲動列。含加入圖片、拼貼與全部移除 */
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, LayoutGrid, MapPin, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog, Skeleton, Tooltip, useFileIntake, useFlyIn } from '@/components/ui'
import { spring } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { useTools, type Doc } from './store'
import { ACCEPT } from './constants'

export function ThumbRail({ onCollage }: { onCollage: () => void }) {
  const t = useT()
  const docs = useTools((s) => s.docs)
  const selectedId = useTools((s) => s.selectedId)
  const select = useTools((s) => s.select)
  const removeDoc = useTools((s) => s.removeDoc)
  const clearAll = useTools((s) => s.clearAll)
  const addFiles = useTools((s) => s.addFiles)
  const states = useTools((s) => s.history.present)
  const [confirm, setConfirm] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)

  // 選取的縮圖捲到可見範圍
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const ready = docs.filter((d) => d.status === 'ready').length

  return (
    <nav
      aria-label={t('tools.rail.label')}
      className="card flex min-w-0 gap-2 p-2 lg:sticky lg:top-[calc(var(--topbar-h)+16px)] lg:h-(--tl-h) lg:flex-col lg:p-2"
    >
      <ul
        ref={listRef}
        className="tl-fade-x hide-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:[mask-image:none]"
      >
        <AnimatePresence initial={false}>
          {docs.map((d, i) => (
            <Thumb
              key={d.id}
              doc={d}
              index={i}
              selected={d.id === selectedId}
              edited={!!d.editedThumbUrl || (states[d.id]?.meta ?? 'keep') !== 'keep'}
              onSelect={() => select(d.id)}
              onRemove={() => removeDoc(d.id)}
            />
          ))}
        </AnimatePresence>
        <li className="shrink-0">
          <AddTile onFiles={addFiles} />
        </li>
      </ul>
      <div className="flex shrink-0 items-center justify-center gap-1 border-l border-border pl-2 lg:flex-col lg:border-l-0 lg:border-t lg:pl-0 lg:pt-2">
        <Tooltip content={t('tools.rail.collage')} side="right">
          <button
            type="button"
            onClick={onCollage}
            disabled={ready < 2}
            aria-label={t('tools.rail.collage')}
            className="grid size-11 place-items-center rounded-md text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-35"
          >
            <LayoutGrid size={18} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip content={t('tools.rail.clearAll')} side="right">
          <button
            type="button"
            onClick={() => setConfirm(true)}
            aria-label={t('tools.rail.clearAll')}
            className="grid size-11 place-items-center rounded-md text-text-2 transition-colors hover:bg-surface-2 hover:text-danger-ink"
          >
            <Trash2 size={18} aria-hidden />
          </button>
        </Tooltip>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('tools.rail.clearConfirm')}
        description={t('tools.rail.clearConfirmDesc')}
        confirmLabel={t('tools.rail.clearAll')}
        danger
        onConfirm={clearAll}
      />
    </nav>
  )
}

function Thumb({
  doc,
  index,
  selected,
  edited,
  onSelect,
  onRemove,
}: {
  doc: Doc
  index: number
  selected: boolean
  edited: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  const t = useT()
  const fly = useFlyIn<HTMLLIElement>()
  const src = doc.editedThumbUrl ?? doc.thumbUrl
  return (
    <motion.li
      ref={fly}
      layout
      data-id={doc.id}
      className="group relative shrink-0"
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={spring.snappy}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${index + 1}. ${doc.name}${doc.hasGps ? `（${t('tools.rail.gps')}）` : ''}`}
        className={cn(
          'tl-checker relative block size-16 overflow-hidden rounded-md transition-shadow duration-(--dur-fast) lg:size-[60px]',
          selected
            ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--accent)]'
            : 'shadow-[0_0_0_1px_var(--border)] hover:shadow-[0_0_0_1px_var(--border-strong)]',
        )}
      >
        {doc.status === 'loading' && <Skeleton className="absolute inset-0 rounded-none" />}
        {doc.status === 'error' && (
          <span className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface))] text-danger-ink">
            <AlertTriangle size={18} aria-hidden />
          </span>
        )}
        {src && (
          <motion.img
            key={src}
            src={src}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full object-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          />
        )}
        {doc.hasGps && (
          <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-warning text-white shadow-e1">
            <MapPin size={11} aria-hidden />
          </span>
        )}
        {edited && (
          <span
            aria-hidden
            className="absolute right-1 top-1 size-2 rounded-full bg-accent shadow-[0_0_0_1.5px_var(--surface)]"
          />
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('tools.rail.remove', { name: doc.name })}
        className={cn(
          'absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-surface text-text-2 shadow-e2 transition-opacity duration-(--dur-fast) hover:text-danger-ink focus-visible:opacity-100',
          selected
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-0',
        )}
      >
        <X size={13} aria-hidden />
      </button>
    </motion.li>
  )
}

function AddTile({ onFiles }: { onFiles: (f: File[]) => void }) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const { intake, pendingLarge, confirmLarge, cancelLarge, largeSize } = useFileIntake({
    accept: ACCEPT,
    onFiles,
  })
  return (
    <>
      <Tooltip content={t('tools.rail.add')} side="right">
        <button
          type="button"
          onClick={() => input.current?.click()}
          aria-label={t('tools.rail.add')}
          className="grid size-16 place-items-center rounded-md border-[1.5px] border-dashed border-border-strong text-text-3 transition-colors hover:border-accent hover:text-accent-ink lg:size-[60px]"
        >
          <Plus size={20} aria-hidden />
        </button>
      </Tooltip>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          intake(Array.from(e.target.files || []))
          e.target.value = ''
        }}
      />
      <ConfirmDialog
        open={!!pendingLarge}
        onOpenChange={(o) => !o && cancelLarge()}
        title={t('errors.fileTooLarge', { size: largeSize })}
        description={t('errors.fileTooLargeDesc')}
        confirmLabel={t('errors.continueAnyway')}
        onConfirm={confirmLarge}
      />
    </>
  )
}
