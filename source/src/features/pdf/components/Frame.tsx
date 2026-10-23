/**
 * 新工具共用的骨架與元件：
 * - ToolFrame：沒有檔案 → 拖放區；處理中 → Working；完成 → ResultCard；其餘交給工具的編輯畫面。
 * - PageStage：大尺寸頁面預覽＋可疊加的互動圖層（裁切框、塗黑框），座標一律用「視覺座標的 0–1 比例」。
 * - PagePager：上一頁／下一頁＋頁碼。
 * - DrawLayer：拖曳畫出矩形；既有矩形可移動、刪除；動畫進出。
 */
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui'
import { spring } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import type { PdfSource } from '../store'
import { toolById, type ToolId } from '../tools'
import { PageThumb } from './PageThumb'
import { ResultCard, type ResultFile } from './ResultCard'
import { Working } from './Working'
import type { Runner } from './useRunner'
import {
  PdfDrop,
  SourceBar,
  SourceNotices,
  editBlocked,
  useActiveSource,
  useStage,
} from './Shared'

export function ToolFrame<T>({
  tool,
  runner,
  workingTitle,
  resetLabel,
  resultTitle,
  resultSummary,
  resultExtra,
  workingArt,
  children,
}: {
  tool: ToolId
  runner: Runner<T>
  workingTitle: string
  resetLabel?: string
  resultTitle?: string
  resultSummary?: (data: T | undefined, files: ResultFile[]) => ReactNode
  resultExtra?: (data: T | undefined) => ReactNode
  workingArt?: ReactNode
  children: (source: PdfSource) => ReactNode
}) {
  const source = useActiveSource()
  const def = toolById[tool]
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
      <Working title={workingTitle} progress={runner.progress} onCancel={runner.cancel}>
        {workingArt}
      </Working>
    )
  if (runner.phase === 'done' && runner.output)
    return (
      <ResultCard
        files={runner.output.files}
        title={resultTitle}
        summary={resultSummary?.(runner.output.data, runner.output.files)}
        onReset={runner.reset}
        resetLabel={resetLabel}
      >
        {resultExtra?.(runner.output.data)}
      </ResultCard>
    )
  return (
    <div className="flex flex-col gap-3">
      <SourceBar source={source} />
      <SourceNotices source={source} tool={def} />
      {source.status === 'ready' && !editBlocked(source, def) && children(source)}
    </div>
  )
}

/** 0–1 比例的矩形（視覺座標：左上原點） */
export interface NRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export function PagePager({
  index,
  count,
  onChange,
  extra,
}: {
  index: number
  count: number
  onChange: (i: number) => void
  extra?: ReactNode
}) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        icon
        size="sm"
        variant="secondary"
        aria-label={t('pdf.viewer.prev')}
        disabled={index <= 0}
        onClick={() => onChange(index - 1)}
      >
        <ChevronLeft size={16} aria-hidden />
      </Button>
      <span className="min-w-[88px] text-center text-small tabular-nums text-text-2" aria-live="polite">
        {t('pdf.viewer.pageLabel', { n: index + 1, total: count })}
      </span>
      <Button
        icon
        size="sm"
        variant="secondary"
        aria-label={t('pdf.viewer.next')}
        disabled={index >= count - 1}
        onClick={() => onChange(index + 1)}
      >
        <ChevronRight size={16} aria-hidden />
      </Button>
      {extra && <div className="ml-auto flex flex-wrap items-center gap-2">{extra}</div>}
    </div>
  )
}

/** 大頁面預覽：頁面渲染＋疊加圖層，切頁時淡入並輕微位移 */
export function PageStage({
  source,
  index,
  children,
  className,
  maxWidth = 760,
}: {
  source: PdfSource
  index: number
  children?: ReactNode
  className?: string
  maxWidth?: number
}) {
  const size = source.sizes[index] ?? source.sizes[0] ?? { w: 595, h: 842 }
  return (
    <div className={cn('card grid place-items-center overflow-hidden bg-surface-2 p-3 sm:p-5', className)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${source.id}-${index}`}
          className="relative w-full shadow-e3"
          style={{ maxWidth, aspectRatio: String(size.w / size.h) }}
          initial={{ opacity: 0, y: 10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.985 }}
          transition={spring.smooth}
        >
          <PageThumb
            docId={source.id}
            index={index}
            aspect={size.w / size.h}
            renderWidth={900}
            priority={10}
            className="absolute inset-0 rounded-[3px]"
          />
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
let rid = 0
export const rectId = () => `r${++rid}`

/**
 * 拖曳畫框圖層：在空白處拖曳畫新矩形；拖曳既有矩形可移動；點右上角 × 刪除。
 * tone：redact＝黑色實心、crop 由呼叫端自行繪製（這裡只負責畫）。
 */
export function DrawLayer({
  rects,
  onChange,
  tone = 'redact',
  single = false,
  labelRemove,
}: {
  rects: NRect[]
  onChange: (r: NRect[]) => void
  tone?: 'redact' | 'select'
  /** 只允許一個矩形（新的取代舊的） */
  single?: boolean
  labelRemove: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<NRect | null>(null)
  const drag = useRef<{
    mode: 'new' | 'move'
    id?: string
    sx: number
    sy: number
    orig?: NRect
  } | null>(null)

  const point = (e: RPointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const p = point(e)
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-rect]')
    box.current!.setPointerCapture(e.pointerId)
    if (target) {
      const orig = rects.find((r) => r.id === target.dataset.rect)
      if (orig) drag.current = { mode: 'move', id: orig.id, sx: p.x, sy: p.y, orig }
      return
    }
    drag.current = { mode: 'new', sx: p.x, sy: p.y }
    setDraft({ id: rectId(), x: p.x, y: p.y, w: 0, h: 0 })
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const p = point(e)
    if (d.mode === 'new') {
      setDraft((cur) =>
        cur
          ? {
              ...cur,
              x: Math.min(d.sx, p.x),
              y: Math.min(d.sy, p.y),
              w: Math.abs(p.x - d.sx),
              h: Math.abs(p.y - d.sy),
            }
          : cur,
      )
    } else if (d.orig) {
      const o = d.orig
      const nx = Math.min(1 - o.w, Math.max(0, o.x + p.x - d.sx))
      const ny = Math.min(1 - o.h, Math.max(0, o.y + p.y - d.sy))
      onChange(rects.map((r) => (r.id === o.id ? { ...r, x: nx, y: ny } : r)))
    }
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.mode === 'new' && draft) {
      if (draft.w > 0.008 && draft.h > 0.006) onChange(single ? [draft] : [...rects, draft])
      setDraft(null)
    }
  }

  const all = draft ? [...rects, draft] : rects
  return (
    <div
      ref={box}
      className="absolute inset-0 cursor-crosshair touch-none select-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <AnimatePresence>
        {all.map((r) => (
          <motion.div
            key={r.id}
            data-rect={r.id}
            className={cn(
              'group absolute cursor-move',
              tone === 'redact'
                ? 'bg-black/85 ring-2 ring-[var(--accent)] ring-offset-1'
                : 'border-2 border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]',
            )}
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
            }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.16 } }}
            transition={spring.snappy}
          >
            {r !== draft && (
              <button
                type="button"
                aria-label={labelRemove}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onChange(rects.filter((x) => x.id !== r.id))}
                className="absolute -right-2.5 -top-2.5 grid size-5 place-items-center rounded-full bg-surface text-text shadow-e2 opacity-90 transition-transform hover:scale-110"
              >
                <X size={12} aria-hidden />
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
