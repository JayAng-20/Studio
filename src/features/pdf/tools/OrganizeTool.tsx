import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AnimatePresence, motion } from 'motion/react'
import {
  BookOpen,
  Check,
  CopyPlus,
  Download,
  FilePlus2,
  Redo2,
  RotateCcw,
  RotateCw,
  SquareCheck,
  Trash2,
  Undo2,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Badge, Button, Toolbar, Tooltip } from '@/components/ui'
import { cssEasing, duration, sec, spring } from '@/design/motion'
import { uid } from '@/lib/files'
import { outputName } from '@/lib/filename'
import { modKey } from '@/lib/capabilities'
import { cn } from '@/lib/cn'
import { asFile } from '@/stores/fileBus'
import { useSettings } from '@/stores/settings'
import { useModuleShortcuts, useUnsaved } from '@/stores/ui'
import { useT } from '@/i18n'
import { assemble, type PlanItem } from '../lib/ops'
import { normRotation } from '../lib/placement'
import { addPdfFiles, sourceBytes, usePdf, type PdfSource } from '../store'
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
  useGoTool,
  useStage,
  ToolPanel,
  PanelFooter,
} from '../components/Shared'
import { toolById } from '../tools'

interface OrgPage {
  key: string
  kind: 'page' | 'blank'
  /** 原始頁碼（0 起算；空白頁為 -1） */
  src: number
  /** 額外旋轉（順時針度數；不正規化，讓動畫連續） */
  rotation: number
  /** 空白頁的尺寸（一般頁面的尺寸以來源為準） */
  size: { w: number; h: number }
}

const initialPages = (s: PdfSource): OrgPage[] =>
  Array.from({ length: s.pageCount }, (_, i) => ({
    key: `p${i}`,
    kind: 'page',
    src: i,
    rotation: 0,
    size: s.sizes[i] ?? s.sizes[0] ?? { w: 595, h: 842 },
  }))

export function OrganizeTool() {
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
  return (
    <div className="flex flex-col gap-3">
      {runner.phase !== 'done' && <SourceBar source={source} />}
      {runner.phase !== 'done' && <SourceNotices source={source} tool={toolById.organize} />}
      {runner.phase === 'working' && (
        <Working
          title={t('pdf.organize.working')}
          progress={runner.progress}
          onCancel={runner.cancel}
        />
      )}
      {source.status === 'ready' && <Organizer key={source.id} source={source} runner={runner} />}
    </div>
  )
}

function Organizer({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const go = useGoTool()
  const pattern = useSettings((s) => s.filenamePattern)
  const [hist, setHist] = useState<{ pages: OrgPage[]; past: OrgPage[][]; future: OrgPage[][] }>(
    () => ({ pages: initialPages(source), past: [], future: [] }),
  )
  const { pages, past, future } = hist
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const blocked = editBlocked(source, toolById.organize)

  /** 記錄一步（最多 50 步可復原） */
  const commit = useCallback((next: OrgPage[]) => {
    setHist((h) =>
      next === h.pages ? h : { pages: next, past: [...h.past.slice(-49), h.pages], future: [] },
    )
  }, [])
  const undo = useCallback(() => {
    setHist((h) =>
      h.past.length
        ? {
            pages: h.past[h.past.length - 1],
            past: h.past.slice(0, -1),
            future: [h.pages, ...h.future],
          }
        : h,
    )
  }, [])
  const redo = useCallback(() => {
    setHist((h) =>
      h.future.length
        ? { pages: h.future[0], past: [...h.past, h.pages], future: h.future.slice(1) }
        : h,
    )
  }, [])

  const sizeOf = (p: OrgPage) =>
    p.kind === 'page' ? (source.sizes[p.src] ?? source.sizes[0] ?? p.size) : p.size
  const dirty = past.length > 0
  useUnsaved('pdf-organize', dirty && runner.phase !== 'done')

  const sel = useMemo(() => pages.filter((p) => selected.has(p.key)), [pages, selected])
  const targets = (key?: string) => (key && !selected.has(key) ? new Set([key]) : selected)

  const rotate = (deg: number, key?: string) => {
    const set = targets(key)
    if (!set.size) return
    commit(pages.map((p) => (set.has(p.key) ? { ...p, rotation: p.rotation + deg } : p)))
  }
  const remove = (key?: string) => {
    const set = targets(key)
    if (!set.size) return
    const next = pages.filter((p) => !set.has(p.key))
    if (!next.length) return
    commit(next)
    setSelected(new Set())
  }
  const duplicate = (key?: string) => {
    const set = targets(key)
    if (!set.size) return
    const added: string[] = []
    const next = pages.flatMap((p) => {
      if (!set.has(p.key)) return [p]
      const copy = { ...p, key: uid('dup') }
      added.push(copy.key)
      return [p, copy]
    })
    commit(next)
    setSelected(new Set(added))
  }
  const insertBlank = () => {
    const ref = sel.length ? sel[sel.length - 1] : pages[pages.length - 1]
    const r = normRotation(ref?.rotation ?? 0)
    const base = ref ? sizeOf(ref) : { w: 595, h: 842 }
    const size = r === 90 || r === 270 ? { w: base.h, h: base.w } : base
    const blank: OrgPage = { key: uid('blank'), kind: 'blank', src: -1, rotation: 0, size }
    const idx = ref ? pages.findIndex((p) => p.key === ref.key) : pages.length - 1
    const next = [...pages]
    next.splice(idx + 1, 0, blank)
    commit(next)
    setSelected(new Set([blank.key]))
  }
  const selectAll = () =>
    setSelected((s) => (s.size === pages.length ? new Set() : new Set(pages.map((p) => p.key))))
  const resetAll = () => {
    commit(initialPages(source))
    setSelected(new Set())
  }

  // 點選：單擊選一頁、⌘／Ctrl 切換、Shift 選一段；觸控時點一下切換
  const touch = useRef(false)
  const onTileClick = (key: string, e: MouseEvent | KeyboardEvent) => {
    const idx = pages.findIndex((p) => p.key === key)
    const a = anchor.current ? pages.findIndex((p) => p.key === anchor.current) : -1
    if (e.shiftKey && a >= 0) {
      const [lo, hi] = a < idx ? [a, idx] : [idx, a]
      const next = new Set(e.metaKey || e.ctrlKey ? selected : [])
      for (let i = lo; i <= hi; i++) next.add(pages[i].key)
      setSelected(next)
      return
    }
    anchor.current = key
    if (e.metaKey || e.ctrlKey || touch.current || e.type === 'keydown') {
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(key)) n.delete(key)
        else n.add(key)
        return n
      })
    } else {
      setSelected((s) => (s.size === 1 && s.has(key) ? new Set() : new Set([key])))
    }
  }

  // 鍵盤快捷鍵
  const handlers = useRef({ remove, rotate, duplicate, undo, redo, selectAll })
  useEffect(() => {
    handlers.current = { remove, rotate, duplicate, undo, redo, selectAll }
  })
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      const mod = e.metaKey || e.ctrlKey
      const h = handlers.current
      const k = e.key.toLowerCase()
      if (mod && k === 'z' && !e.shiftKey) h.undo()
      else if ((mod && k === 'z' && e.shiftKey) || (mod && k === 'y')) h.redo()
      else if (mod && k === 'a') h.selectAll()
      else if (mod && k === 'd') h.duplicate()
      else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) h.remove()
      else if (!mod && k === 'r') h.rotate(e.shiftKey ? -90 : 90)
      else if (e.key === 'Escape') setSelected(new Set())
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useModuleShortcuts([
    { keys: ['R'], label: t('pdf.organize.keyRotate') },
    { keys: ['Shift', 'R'], label: t('pdf.organize.keyRotateLeft') },
    { keys: ['Delete'], label: t('pdf.organize.keyDelete') },
    { keys: [modKey(), 'D'], label: t('pdf.organize.keyDuplicate') },
    { keys: [modKey(), 'A'], label: t('pdf.organize.keySelectAll') },
    { keys: [modKey(), 'Z'], label: t('common.undo') },
    { keys: ['Shift', modKey(), 'Z'], label: t('common.redo') },
    { keys: ['Enter'], label: t('pdf.organize.keyMove') },
  ])

  // 拖曳排序：滑鼠拖 6 px 啟動；觸控長按啟動（不影響捲動）；鍵盤 Enter 拿起、方向鍵移動
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 260, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Enter'], cancel: ['Escape'], end: ['Enter', 'Space'] },
    }),
  )
  const onDragStart = (e: DragStartEvent) => setDragging(String(e.active.id))
  const onDragEnd = (e: DragEndEvent) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setDragging(null)))
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = pages.findIndex((p) => p.key === active.id)
    const to = pages.findIndex((p) => p.key === over.id)
    if (selected.has(String(active.id)) && selected.size > 1) {
      // 多選一起移動：保持相對順序，放到目標位置
      const moving = pages.filter((p) => selected.has(p.key))
      const rest = pages.filter((p) => !selected.has(p.key))
      const overIdx = rest.findIndex((p) => p.key === over.id)
      const insertAt = overIdx < 0 ? rest.length : to > from ? overIdx + 1 : overIdx
      commit([...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)])
    } else {
      commit(arrayMove(pages, from, to))
    }
  }

  const exportPdf = () => {
    const plan: PlanItem[] = pages.map((p) =>
      p.kind === 'blank'
        ? { kind: 'blank', size: [p.size.w, p.size.h] }
        : { kind: 'page', src: 0, page: p.src, rotate: normRotation(p.rotation) },
    )
    const name = outputName(source.name, t('pdf.actions.organize'), 'pdf', pattern)
    void runner.start(
      t('pdf.organize.task', { name: source.name }),
      async ({ signal, progress }) => {
        const out = await assemble([await sourceBytes(source)], plan, {
          signal,
          onProgress: progress,
        })
        return {
          files: [
            { blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name },
          ],
        }
      },
    )
  }

  const stats = useMemo(() => {
    const rotated = pages.filter((p) => p.kind === 'page' && normRotation(p.rotation) !== 0).length
    const blanks = pages.filter((p) => p.kind === 'blank').length
    const kept = new Set(pages.filter((p) => p.kind === 'page').map((p) => p.src))
    const deleted = source.pageCount - kept.size
    const copies = pages.filter((p) => p.kind === 'page').length - kept.size
    const moved = pages.some((p, i) => p.kind !== 'page' || p.src !== i)
    return { rotated, blanks, deleted, copies, moved }
  }, [pages, source.pageCount])

  if (runner.phase === 'working') return null
  if (runner.phase === 'done' && runner.output) {
    const file = runner.output.files[0]
    return (
      <ResultCard
        files={runner.output.files}
        summary={t('pdf.organize.done', { pages: pages.length })}
        onReset={runner.reset}
        resetLabel={t('pdf.organize.backToEdit')}
        actions={
          <Button
            variant="secondary"
            leading={<BookOpen size={16} aria-hidden />}
            onClick={async () => {
              await addPdfFiles([asFile(file.blob, file.name)])
              const s = usePdf.getState().sources
              usePdf.getState().setActive(s[s.length - 1].id)
              go('viewer')
            }}
          >
            {t('pdf.result.openViewer')}
          </Button>
        }
      />
    )
  }

  const noSel = !selected.size
  return (
    <Workspace
      main={
        <div className="card overflow-hidden">
          <Toolbar
            label={t('pdf.organize.toolbar')}
            className="sticky top-0 z-10 border-b border-border bg-surface px-2 py-1.5 sm:px-3"
          >
            <Button
              size="sm"
              variant="ghost"
              leading={<SquareCheck size={16} aria-hidden />}
              onClick={selectAll}
            >
              {selected.size === pages.length
                ? t('pdf.organize.selectNone')
                : t('pdf.organize.selectAll')}
            </Button>
            <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
            <ToolButton
              label={t('pdf.organize.rotateLeft')}
              shortcut="⇧R"
              disabled={noSel}
              onClick={() => rotate(-90)}
            >
              <RotateCcw size={17} aria-hidden />
            </ToolButton>
            <ToolButton
              label={t('pdf.organize.rotateRight')}
              shortcut="R"
              disabled={noSel}
              onClick={() => rotate(90)}
            >
              <RotateCw size={17} aria-hidden />
            </ToolButton>
            <ToolButton
              label={t('pdf.organize.duplicate')}
              shortcut={`${modKey()}D`}
              disabled={noSel}
              onClick={() => duplicate()}
            >
              <CopyPlus size={17} aria-hidden />
            </ToolButton>
            <ToolButton
              label={t('pdf.organize.delete')}
              shortcut="Del"
              disabled={noSel || selected.size >= pages.length}
              onClick={() => remove()}
              danger
            >
              <Trash2 size={17} aria-hidden />
            </ToolButton>
            <ToolButton label={t('pdf.organize.insertBlank')} onClick={insertBlank}>
              <FilePlus2 size={17} aria-hidden />
            </ToolButton>
            <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
            <ToolButton
              label={t('common.undo')}
              shortcut={`${modKey()}Z`}
              disabled={!past.length}
              onClick={undo}
            >
              <Undo2 size={17} aria-hidden />
            </ToolButton>
            <ToolButton
              label={t('common.redo')}
              shortcut={`⇧${modKey()}Z`}
              disabled={!future.length}
              onClick={redo}
            >
              <Redo2 size={17} aria-hidden />
            </ToolButton>
            <span
              className="ml-auto pr-1 text-caption tabular-nums text-text-3 max-sm:order-last max-sm:w-full max-sm:pl-2"
              aria-live="polite"
            >
              {selected.size
                ? t('pdf.organize.selectedCount', { count: selected.size })
                : t('pdf.organize.tip')}
            </span>
          </Toolbar>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragCancel={() => setDragging(null)}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={pages.map((p) => p.key)} strategy={rectSortingStrategy}>
              <ul
                aria-label={t('pdf.organize.gridLabel')}
                className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3 p-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4 sm:p-4"
                onPointerDown={(e: PointerEvent) => {
                  touch.current = e.pointerType === 'touch'
                }}
              >
                <AnimatePresence initial={false}>
                  {pages.map((p, i) => (
                    <Tile
                      key={p.key}
                      page={p}
                      size={sizeOf(p)}
                      index={i}
                      source={source}
                      selected={selected.has(p.key)}
                      groupCount={dragging === p.key && selected.has(p.key) ? selected.size : 0}
                      suppressLayout={!!dragging}
                      onClick={(e) => onTileClick(p.key, e)}
                      onRotate={(d) => rotate(d, p.key)}
                      onDuplicate={() => duplicate(p.key)}
                      onDelete={pages.length > 1 ? () => remove(p.key) : undefined}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </SortableContext>
          </DndContext>
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.organize.summary')}>
          <p className="text-body text-text-2">
            {t('pdf.organize.pagesNow', { now: pages.length, before: source.pageCount })}
          </p>
          <ul className="flex flex-wrap gap-1.5" aria-label={t('pdf.organize.changes')}>
            {stats.moved && <Badge tone="accent">{t('pdf.organize.statMoved')}</Badge>}
            {stats.rotated > 0 && (
              <Badge tone="accent">{t('pdf.organize.statRotated', { count: stats.rotated })}</Badge>
            )}
            {stats.deleted > 0 && (
              <Badge tone="danger">{t('pdf.organize.statDeleted', { count: stats.deleted })}</Badge>
            )}
            {stats.copies > 0 && (
              <Badge tone="accent">{t('pdf.organize.statCopies', { count: stats.copies })}</Badge>
            )}
            {stats.blanks > 0 && (
              <Badge tone="neutral">{t('pdf.organize.statBlanks', { count: stats.blanks })}</Badge>
            )}
            {!dirty && <Badge tone="neutral">{t('pdf.organize.statNone')}</Badge>}
          </ul>
          <div className="rounded-md bg-surface-2 p-3 text-small text-text-2">
            <p className="mb-1.5 font-medium text-text">{t('pdf.organize.howTitle')}</p>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>{t('pdf.organize.how1')}</li>
              <li>{t('pdf.organize.how2', { mod: modKey() })}</li>
              <li>{t('pdf.organize.how3')}</li>
            </ul>
          </div>
          <PanelFooter>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" disabled={!dirty} onClick={resetAll}>
                {t('common.reset')}
              </Button>
              <Button
                variant="primary"
                className="flex-[2]"
                disabled={blocked}
                leading={<Download size={16} aria-hidden />}
                onClick={exportPdf}
              >
                {t('pdf.organize.export')}
              </Button>
            </div>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}

function ToolButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
  danger,
}: {
  label: string
  shortcut?: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <Button
        icon
        size="sm"
        variant="ghost"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={danger ? 'hover:text-danger-ink' : undefined}
      >
        {children}
      </Button>
    </Tooltip>
  )
}

/** 單一頁面方塊：拖曳排序時其他方塊以彈簧讓位；刪除時縮小淡出、鄰近補位 */
function Tile({
  page,
  size,
  index,
  source,
  selected,
  groupCount,
  suppressLayout,
  onClick,
  onRotate,
  onDuplicate,
  onDelete,
}: {
  page: OrgPage
  size: { w: number; h: number }
  index: number
  source: PdfSource
  selected: boolean
  groupCount: number
  suppressLayout: boolean
  onClick: (e: MouseEvent | KeyboardEvent) => void
  onRotate: (deg: number) => void
  onDuplicate: () => void
  onDelete?: () => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.key,
    transition: { duration: duration.slow, easing: cssEasing('emphasized') },
  })
  const aspect = size.w / size.h
  const r = normRotation(page.rotation)
  const label =
    page.kind === 'blank'
      ? t('pdf.organize.blankLabel', { n: index + 1 })
      : t('pdf.organize.tileLabel', { n: index + 1, src: page.src + 1 })
  return (
    <motion.li
      layout={suppressLayout ? false : 'position'}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6, transition: { duration: sec(duration.base) } }}
      transition={spring.smooth}
      className="relative"
      style={{ zIndex: isDragging ? 20 : undefined }}
    >
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        className="group relative"
      >
        <div className="relative">
          <div
            {...attributes}
            {...listeners}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={label}
            aria-roledescription={t('pdf.organize.sortable')}
            onClick={onClick}
            onKeyDown={(e) => {
              if (e.key === ' ') {
                e.preventDefault()
                onClick(e)
                return
              }
              listeners?.onKeyDown?.(e)
            }}
            className={cn(
              'relative grid aspect-square w-full cursor-grab place-items-center rounded-lg p-2.5 outline-none transition-[background-color,box-shadow] duration-(--dur-fast) active:cursor-grabbing',
              'focus-visible:ring-2 focus-visible:ring-accent',
              selected
                ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] ring-2 ring-accent'
                : 'bg-surface-2 hover:bg-surface-3',
              isDragging && 'shadow-e4',
            )}
          >
            <motion.span
              className="relative block"
              animate={{ rotate: page.rotation, scale: isDragging ? 1.04 : 1 }}
              transition={spring.smooth}
              style={
                aspect >= 1
                  ? { width: '100%', aspectRatio: String(aspect) }
                  : { height: '100%', aspectRatio: String(aspect) }
              }
            >
              {page.kind === 'page' ? (
                <span className="block size-full overflow-hidden rounded-[3px] shadow-e2">
                  <PageThumb
                    docId={source.id}
                    index={page.src}
                    aspect={aspect}
                    renderWidth={160}
                    className="size-full"
                  />
                </span>
              ) : (
                <span className="grid size-full place-items-center rounded-[3px] border border-dashed border-border-strong paper text-caption shadow-e1">
                  {t('pdf.organize.blank')}
                </span>
              )}
            </motion.span>
            <span
              aria-hidden
              className={cn(
                'absolute left-2 top-2 grid size-5 place-items-center rounded-full border text-[10px] transition-all duration-(--dur-fast)',
                selected
                  ? 'border-transparent bg-accent-strong text-white'
                  : 'border-border-strong bg-surface/90 text-transparent opacity-0 group-hover:opacity-100',
              )}
            >
              <Check size={12} strokeWidth={3} />
            </span>
            {groupCount > 1 && (
              <span className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-accent-strong text-caption font-semibold text-white shadow-e2">
                {groupCount}
              </span>
            )}
            {r !== 0 && page.kind === 'page' && (
              <span className="absolute bottom-2 right-2 rounded-full bg-surface/95 px-1.5 text-[10px] font-medium tabular-nums text-text-2 shadow-e1">
                {r}°
              </span>
            )}
          </div>
          {/* 單頁快速操作：hover 或聚焦時出現；觸控裝置在選取後出現 */}
          <div
            className={cn(
              'absolute inset-x-0 -bottom-1 flex translate-y-1/2 justify-center gap-0.5 transition-opacity duration-(--dur-fast)',
              selected
                ? 'opacity-100'
                : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
            )}
          >
            <span className="flex gap-0.5 rounded-full border border-border bg-surface p-0.5 shadow-e2">
              <MiniButton label={t('pdf.organize.rotateLeft')} onClick={() => onRotate(-90)}>
                <RotateCcw size={14} aria-hidden />
              </MiniButton>
              <MiniButton label={t('pdf.organize.rotateRight')} onClick={() => onRotate(90)}>
                <RotateCw size={14} aria-hidden />
              </MiniButton>
              <MiniButton label={t('pdf.organize.duplicate')} onClick={onDuplicate}>
                <CopyPlus size={14} aria-hidden />
              </MiniButton>
              {onDelete && (
                <MiniButton label={t('pdf.organize.delete')} onClick={onDelete} danger>
                  <Trash2 size={14} aria-hidden />
                </MiniButton>
              )}
            </span>
          </div>
        </div>
        <p className="mt-5 text-center text-caption tabular-nums text-text-3">
          {page.kind === 'blank'
            ? t('pdf.organize.blank')
            : index === page.src
              ? index + 1
              : `${index + 1}（${page.src + 1}）`}
        </p>
      </div>
    </motion.li>
  )
}

function MiniButton({
  label,
  onClick,
  children,
  danger,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'grid size-7 place-items-center rounded-full text-text-2 transition-colors hover:bg-surface-2 hover:text-text max-sm:size-9',
        danger && 'hover:text-danger-ink',
      )}
    >
      {children}
    </button>
  )
}
