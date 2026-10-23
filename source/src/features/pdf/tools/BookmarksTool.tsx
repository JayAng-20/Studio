import { AnimatePresence, Reorder, motion, useDragControls } from 'motion/react'
import {
  Bookmark,
  BookmarkPlus,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  Save,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, EmptyState, Skeleton, Tooltip, toast } from '@/components/ui'
import { spring } from '@/design/motion'
import { outputName } from '@/lib/filename'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { writeBookmarks, type BookmarkItem } from '../lib/acrobat'
import { getDoc, sourceBytes, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { PagePager, PageStage, ToolFrame, rectId } from '../components/Frame'
import { PanelFooter, ToolPanel } from '../components/Shared'
import type { PDFDocumentProxy } from 'pdfjs-dist'

interface OutlineNode {
  title: string
  dest: unknown
  items: OutlineNode[]
}

/** 讀出既有書籤（攤平成含階層的清單） */
async function readOutline(doc: PDFDocumentProxy): Promise<BookmarkItem[]> {
  const outline = (await doc.getOutline()) as OutlineNode[] | null
  const out: BookmarkItem[] = []
  const pageOf = async (dest: unknown): Promise<number> => {
    try {
      const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(d) || !d[0]) return 0
      const ref = d[0]
      if (typeof ref === 'number') return ref
      return await doc.getPageIndex(ref as never)
    } catch {
      return 0
    }
  }
  const walk = async (nodes: OutlineNode[], level: number) => {
    for (const n of nodes) {
      out.push({ id: rectId(), title: n.title, page: await pageOf(n.dest), level })
      if (n.items?.length) await walk(n.items, level + 1)
    }
  }
  if (outline) await walk(outline, 0)
  return out
}

/** 每頁字最大的一行當作標題（自動產生書籤） */
async function headingsFromText(doc: PDFDocumentProxy): Promise<BookmarkItem[]> {
  const out: BookmarkItem[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    let best = { size: 0, text: '' }
    for (const it of tc.items as Array<{ str: string; transform: number[]; height: number }>) {
      const size = it.height || Math.hypot(it.transform[2], it.transform[3])
      const text = it.str.trim()
      if (text.length >= 2 && size > best.size + 0.5) best = { size, text }
    }
    page.cleanup()
    if (best.text) out.push({ id: rectId(), title: best.text.slice(0, 80), page: i - 1, level: 0 })
  }
  return out
}

export function BookmarksTool() {
  const t = useT()
  const runner = useRunner()
  return (
    <ToolFrame
      tool="bookmarks"
      runner={runner}
      workingTitle={t('pdf.bookmarks.working')}
      resetLabel={t('pdf.bookmarks.again')}
    >
      {(source) => <Editor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

function Row({
  item,
  max,
  onChange,
  onRemove,
  onFocusPage,
}: {
  item: BookmarkItem
  max: number
  onChange: (p: Partial<BookmarkItem>) => void
  onRemove: () => void
  onFocusPage: () => void
}) {
  const t = useT()
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      layout="position"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16, transition: { duration: 0.16 } }}
      transition={spring.smooth}
      className="flex items-center gap-2 rounded-md border border-border bg-surface p-1.5 pr-2"
      style={{ marginLeft: item.level * 22 }}
    >
      <button
        type="button"
        aria-label={t('a11y.dragHandle')}
        className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-text-3 hover:bg-surface-2 active:cursor-grabbing"
        onPointerDown={(e) => controls.start(e)}
      >
        <GripVertical size={16} aria-hidden />
      </button>
      <Bookmark size={15} className="shrink-0 text-accent-ink" aria-hidden />
      <input
        className="field h-9 min-w-0 flex-1"
        aria-label={t('pdf.bookmarks.titleLabel')}
        value={item.title}
        onFocus={onFocusPage}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <input
        type="number"
        min={1}
        max={max}
        className="field h-9 w-[4.5rem] shrink-0 tabular-nums"
        aria-label={t('pdf.bookmarks.pageLabel')}
        value={item.page + 1}
        onFocus={onFocusPage}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value))
          if (Number.isFinite(n)) onChange({ page: Math.min(max, Math.max(1, n)) - 1 })
        }}
      />
      <Tooltip content={t('pdf.bookmarks.outdent')}>
        <Button
          icon
          size="sm"
          variant="ghost"
          aria-label={t('pdf.bookmarks.outdent')}
          disabled={item.level === 0}
          onClick={() => onChange({ level: item.level - 1 })}
        >
          <IndentDecrease size={16} aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip content={t('pdf.bookmarks.indent')}>
        <Button
          icon
          size="sm"
          variant="ghost"
          aria-label={t('pdf.bookmarks.indent')}
          disabled={item.level >= 4}
          onClick={() => onChange({ level: item.level + 1 })}
        >
          <IndentIncrease size={16} aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip content={t('common.remove')}>
        <Button icon size="sm" variant="ghost" aria-label={t('common.remove')} onClick={onRemove}>
          <Trash2 size={16} aria-hidden />
        </Button>
      </Tooltip>
    </Reorder.Item>
  )
}

function Editor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [items, setItems] = useState<BookmarkItem[] | null>(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    getDoc(source.id)
      .then(readOutline)
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [source.id])

  // 階層不能跳級（子項目最多比上一項深一層）
  const normalize = (list: BookmarkItem[]) =>
    list.map((it, i) => ({ ...it, level: i === 0 ? 0 : Math.min(it.level, list[i - 1].level + 1) }))
  const set = (list: BookmarkItem[]) => setItems(normalize(list))

  const add = () =>
    set([
      ...(items ?? []),
      { id: rectId(), title: t('pdf.bookmarks.newTitle', { n: page + 1 }), page, level: 0 },
    ])
  const auto = async () => {
    setBusy(true)
    try {
      const found = await headingsFromText(await getDoc(source.id))
      if (!found.length) toast(t('pdf.bookmarks.autoNone'))
      else {
        set(found)
        toast.success(t('pdf.bookmarks.autoDone', { count: found.length }))
      }
    } finally {
      setBusy(false)
    }
  }
  const save = () => {
    const list = normalize(items ?? [])
    const name = outputName(source.name, t('pdf.actions.bookmarks'), 'pdf', pattern)
    void runner.start(t('pdf.bookmarks.task', { name: source.name }), async ({ progress }) => {
      progress(null)
      const out = await writeBookmarks(await sourceBytes(source), list)
      return { files: [{ blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name }] }
    })
  }

  return (
    <Workspace
      main={
        <div className="card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-h3 font-semibold">{t('pdf.bookmarks.listTitle')}</h3>
            <Button size="sm" variant="secondary" leading={<BookmarkPlus size={15} aria-hidden />} onClick={add}>
              {t('pdf.bookmarks.add', { n: page + 1 })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              leading={<Wand2 size={15} aria-hidden />}
              onClick={auto}
            >
              {t('pdf.bookmarks.auto')}
            </Button>
          </div>
          {items === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              illustration={
                <motion.span
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  className="text-accent-ink"
                >
                  <Bookmark size={34} aria-hidden />
                </motion.span>
              }
              title={t('pdf.bookmarks.empty')}
              description={t('pdf.bookmarks.emptyDesc')}
            />
          ) : (
            <Reorder.Group axis="y" values={items} onReorder={set} className="flex flex-col gap-1.5">
              <AnimatePresence initial={false}>
                {items.map((it) => (
                  <Row
                    key={it.id}
                    item={it}
                    max={source.pageCount}
                    onFocusPage={() => setPage(it.page)}
                    onChange={(p) => set(items.map((x) => (x.id === it.id ? { ...x, ...p } : x)))}
                    onRemove={() => set(items.filter((x) => x.id !== it.id))}
                  />
                ))}
              </AnimatePresence>
            </Reorder.Group>
          )}
        </div>
      }
      panel={
        <ToolPanel>
          <PagePager index={page} count={source.pageCount} onChange={setPage} />
          <PageStage source={source} index={page} className="p-2! shadow-none" />
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={items === null}
              leading={<Save size={18} aria-hidden />}
              onClick={save}
            >
              {t('pdf.bookmarks.save')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
