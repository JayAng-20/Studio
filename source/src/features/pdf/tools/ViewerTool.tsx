import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronLeft,
  ChevronRight,
  MoveHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  RectangleVertical,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Button, Select, Skeleton, Toolbar, Tooltip } from '@/components/ui'
import { duration, sec } from '@/design/motion'
import { useModuleShortcuts } from '@/stores/ui'
import { isAbortError } from '@/stores/tasks'
import { useMedia } from '@/lib/useMedia'
import { clamp } from '@/lib/format'
import { releaseCanvas } from '@/lib/image'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { clampScale, schedule } from '../lib/pdfjs'
import { getDoc, type PdfSource } from '../store'
import { PageThumb } from '../components/PageThumb'
import { PdfDrop, SourceBar, useActiveSource, useStage } from '../components/Shared'

/** 100% ＝ 實際尺寸（1 pt ＝ 96/72 CSS px） */
const PT_TO_CSS = 96 / 72
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const PAD = 16
const GAP = 16

type ZoomMode = 'width' | 'page' | number

export function ViewerTool() {
  const source = useActiveSource()
  useStage(source ? 'ready' : 'empty')
  if (!source) return <PdfDrop />
  return (
    <div className="flex flex-col gap-3">
      <SourceBar source={source} />
      {source.status === 'ready' ? (
        <Viewer key={source.id} source={source} />
      ) : (
        <Skeleton className="h-[60dvh] rounded-lg" />
      )}
    </div>
  )
}

function useDoc(id: string) {
  const [doc, setDoc] = useState<{ id: string; doc: PDFDocumentProxy } | null>(null)
  useEffect(() => {
    let alive = true
    getDoc(id)
      .then((d) => alive && setDoc({ id, doc: d }))
      .catch((e) => console.error(e))
    return () => {
      alive = false
    }
  }, [id])
  return doc?.id === id ? doc.doc : null
}

function Viewer({ source }: { source: PdfSource }) {
  const t = useT()
  const doc = useDoc(source.id)
  const wide = useMedia('(min-width: 768px)')
  const [thumbsOpen, setThumbsOpen] = useState(true)
  const showThumbs = wide && thumbsOpen
  const scroller = useRef<HTMLDivElement>(null)
  const pageEls = useRef<Array<HTMLDivElement | null>>([])
  const [box, setBox] = useState({ w: 800, h: 600 })
  const [zoom, setZoom] = useState<ZoomMode>('width')
  const [current, setCurrent] = useState(0)
  const [pageInput, setPageInput] = useState('1')
  const ratios = useRef(new Map<number, number>())
  const sizes = source.sizes
  const count = source.pageCount

  // 容器尺寸
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setBox({ w: e.contentRect.width, h: e.contentRect.height }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const ref = sizes[current] ?? sizes[0] ?? { w: 595, h: 842 }
  /** 每頁的縮放：符合寬度／頁面時每頁各自符合（混合直橫向的文件也整齊），百分比時一致 */
  const scaleFor = useCallback(
    (s: { w: number; h: number }) => {
      const fitW = (box.w - PAD * 2) / s.w
      const fitH = (box.h - PAD * 2) / s.h
      if (zoom === 'width') return clamp(fitW, 0.1, 8)
      if (zoom === 'page') return clamp(Math.min(fitW, fitH), 0.1, 8)
      return zoom * PT_TO_CSS
    },
    [zoom, box],
  )
  const scale = scaleFor(ref)
  const percent = Math.round((scale / PT_TO_CSS) * 100)

  // 目前頁：可見比例最高者
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.index)
          ratios.current.set(i, e.isIntersecting ? e.intersectionRatio : 0)
        }
        let best = -1
        let bestR = 0
        ratios.current.forEach((r, i) => {
          if (r > bestR + 0.001 || (Math.abs(r - bestR) <= 0.001 && r > 0 && i < best)) {
            best = i
            bestR = r
          }
        })
        if (best >= 0) {
          setCurrent(best)
          setPageInput(String(best + 1))
        }
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    )
    pageEls.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [count, doc])

  const goTo = useCallback(
    (i: number, smooth = true) => {
      const idx = clamp(i, 0, count - 1)
      const el = pageEls.current[idx]
      const root = scroller.current
      if (!el || !root) return
      root.scrollTo({ top: el.offsetTop - PAD, behavior: smooth ? 'smooth' : 'auto' })
      setCurrent(idx)
      setPageInput(String(idx + 1))
    },
    [count],
  )

  // 縮放時維持目前頁的位置
  const anchor = useRef<{ index: number; offset: number } | null>(null)
  const setZoomKeep = (z: ZoomMode) => {
    const root = scroller.current
    const el = pageEls.current[current]
    if (root && el) {
      anchor.current = { index: current, offset: (root.scrollTop - el.offsetTop) / el.offsetHeight }
    }
    setZoom(z)
  }
  useEffect(() => {
    const a = anchor.current
    const root = scroller.current
    if (!a || !root) return
    const el = pageEls.current[a.index]
    if (el) root.scrollTop = el.offsetTop + a.offset * el.offsetHeight
    anchor.current = null
  }, [scale, zoom])

  const zoomBy = (dir: 1 | -1) => {
    const cur = scale / PT_TO_CSS
    const next =
      dir > 0
        ? (ZOOM_STEPS.find((z) => z > cur + 0.01) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
        : ([...ZOOM_STEPS].reverse().find((z) => z < cur - 0.01) ?? ZOOM_STEPS[0])
    setZoomKeep(next)
  }

  // 鍵盤：← → PageUp PageDown Home End 翻頁；+ − 縮放（焦點在輸入框或對話框開啟時不處理）
  const zoomRef = useRef(zoomBy)
  const goRef = useRef(goTo)
  const curRef = useRef(current)
  useEffect(() => {
    zoomRef.current = zoomBy
    goRef.current = goTo
    curRef.current = current
  })
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable ||
          el.closest('[role="listbox"],[role="menu"]'))
      )
        return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      if (e.altKey) return
      const mod = e.metaKey || e.ctrlKey
      const c = curRef.current
      if (!mod && (e.key === 'ArrowRight' || e.key === 'PageDown')) goRef.current(c + 1)
      else if (!mod && (e.key === 'ArrowLeft' || e.key === 'PageUp')) goRef.current(c - 1)
      else if (!mod && e.key === 'Home') goRef.current(0)
      else if (!mod && e.key === 'End') goRef.current(Number.MAX_SAFE_INTEGER)
      else if (e.key === '+' || e.key === '=') zoomRef.current(1)
      else if (e.key === '-' || e.key === '_') zoomRef.current(-1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 觸控板捏合（ctrl＋滾輪）縮放
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    let acc = 0
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      acc += e.deltaY
      if (Math.abs(acc) > 40) {
        zoomRef.current(acc < 0 ? 1 : -1)
        acc = 0
      }
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [])

  useModuleShortcuts([
    { keys: ['←', '→'], label: t('pdf.viewer.keysPage') },
    { keys: ['Home', 'End'], label: t('pdf.viewer.keysEnds') },
    { keys: ['+', '−'], label: t('pdf.viewer.keysZoom') },
  ])

  const commitPage = () => {
    const n = Number(pageInput)
    if (Number.isInteger(n) && n >= 1 && n <= count) goTo(n - 1)
    else setPageInput(String(current + 1))
  }

  const zoomValue = typeof zoom === 'number' ? String(zoom) : zoom
  const zoomOptions = [
    { value: 'width', label: t('pdf.viewer.fitWidth') },
    { value: 'page', label: t('pdf.viewer.fitPage') },
    ...ZOOM_STEPS.map((z) => ({ value: String(z), label: `${Math.round(z * 100)}%` })),
  ]

  return (
    <div className="card overflow-hidden">
      <Toolbar
        label={t('pdf.viewer.toolbar')}
        className="justify-between gap-2 border-b border-border bg-surface px-2 py-1.5 sm:px-3"
      >
        <div className="flex items-center gap-1">
          {wide && (
            <Tooltip content={thumbsOpen ? t('pdf.viewer.hideThumbs') : t('pdf.viewer.showThumbs')}>
              <Button
                icon
                size="sm"
                variant="ghost"
                aria-pressed={thumbsOpen}
                aria-label={thumbsOpen ? t('pdf.viewer.hideThumbs') : t('pdf.viewer.showThumbs')}
                onClick={() => setThumbsOpen((o) => !o)}
              >
                {thumbsOpen ? (
                  <PanelLeftClose size={17} aria-hidden />
                ) : (
                  <PanelLeftOpen size={17} aria-hidden />
                )}
              </Button>
            </Tooltip>
          )}
          <Tooltip content={t('pdf.viewer.prev')} shortcut="←">
            <Button
              icon
              size="sm"
              variant="ghost"
              aria-label={t('pdf.viewer.prev')}
              disabled={current <= 0}
              onClick={() => goTo(current - 1)}
            >
              <ChevronLeft size={18} aria-hidden />
            </Button>
          </Tooltip>
          <div className="flex items-center gap-1.5 text-small text-text-2">
            <input
              aria-label={t('pdf.viewer.pageInput')}
              inputMode="numeric"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={commitPage}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  commitPage()
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
              onFocus={(e) => e.target.select()}
              className="field h-8! w-12! px-1! text-center tabular-nums"
            />
            <span className="whitespace-nowrap tabular-nums">/ {count}</span>
          </div>
          <Tooltip content={t('pdf.viewer.next')} shortcut="→">
            <Button
              icon
              size="sm"
              variant="ghost"
              aria-label={t('pdf.viewer.next')}
              disabled={current >= count - 1}
              onClick={() => goTo(current + 1)}
            >
              <ChevronRight size={18} aria-hidden />
            </Button>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip content={t('pdf.viewer.zoomOut')} shortcut="−">
            <Button
              icon
              size="sm"
              variant="ghost"
              aria-label={t('pdf.viewer.zoomOut')}
              onClick={() => zoomBy(-1)}
            >
              <ZoomOut size={17} aria-hidden />
            </Button>
          </Tooltip>
          <Select
            label={t('pdf.viewer.zoom')}
            hideLabel
            size="sm"
            value={zoomValue}
            onChange={(v) => setZoomKeep(v === 'width' || v === 'page' ? v : Number(v))}
            options={zoomOptions}
            className="w-[124px] max-sm:w-[104px]"
          />
          <Tooltip content={t('pdf.viewer.zoomIn')} shortcut="+">
            <Button
              icon
              size="sm"
              variant="ghost"
              aria-label={t('pdf.viewer.zoomIn')}
              onClick={() => zoomBy(1)}
            >
              <ZoomIn size={17} aria-hidden />
            </Button>
          </Tooltip>
          <span className="hidden w-12 text-right text-caption tabular-nums text-text-3 lg:inline">
            {percent}%
          </span>
          <div className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
          <Tooltip content={t('pdf.viewer.fitWidth')}>
            <Button
              icon
              size="sm"
              variant="ghost"
              className="max-sm:hidden"
              aria-pressed={zoom === 'width'}
              aria-label={t('pdf.viewer.fitWidth')}
              onClick={() => setZoomKeep('width')}
            >
              <MoveHorizontal size={17} aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content={t('pdf.viewer.fitPage')}>
            <Button
              icon
              size="sm"
              variant="ghost"
              className="max-sm:hidden"
              aria-pressed={zoom === 'page'}
              aria-label={t('pdf.viewer.fitPage')}
              onClick={() => setZoomKeep('page')}
            >
              <RectangleVertical size={17} aria-hidden />
            </Button>
          </Tooltip>
        </div>
      </Toolbar>
      <div className="viewer-body flex h-[max(440px,calc(100dvh-372px))] max-sm:h-[68dvh]">
        <AnimatePresence initial={false}>
          {showThumbs && doc && (
            <motion.div
              key="thumbs"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: sec(duration.base) }}
              className="relative w-[156px] shrink-0 overflow-y-auto border-r border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,var(--surface))] p-3"
            >
              <ThumbRail source={source} current={current} onPick={(i) => goTo(i)} />
            </motion.div>
          )}
        </AnimatePresence>
        <div
          ref={scroller}
          // 可捲動區域需要能用鍵盤聚焦，才能用方向鍵捲動
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          role="region"
          aria-label={t('pdf.viewer.pagesRegion', { name: source.name })}
          className="relative min-w-0 flex-1 overflow-auto bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <div className="flex min-w-fit flex-col items-center" style={{ padding: PAD, gap: GAP }}>
            {Array.from({ length: count }, (_, i) => {
              const s = sizes[i] ?? ref
              const ps = scaleFor(s)
              return (
                <div
                  key={i}
                  ref={(el) => {
                    pageEls.current[i] = el
                  }}
                  data-index={i}
                  className="relative shrink-0 bg-white shadow-e2"
                  style={{ width: Math.round(s.w * ps), height: Math.round(s.h * ps) }}
                  role="img"
                  aria-label={t('pdf.viewer.pageLabel', { n: i + 1, total: count })}
                >
                  {doc && <ViewerPage doc={doc} index={i} scale={ps} root={scroller} />}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 側欄縮圖：目前頁高亮並自動捲到可見處 */
function ThumbRail({
  source,
  current,
  onPick,
}: {
  source: PdfSource
  current: number
  onPick: (i: number) => void
}) {
  const t = useT()
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    // 只捲動側欄本身（scrollIntoView 會連帶捲動整個頁面）
    const ol = list.current
    const el = ol?.children[current] as HTMLElement | undefined
    const box = ol?.parentElement
    if (!el || !box) return
    const top = el.offsetTop
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTo({ top: top - box.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' })
  }, [current])
  return (
    <ol ref={list} className="flex flex-col gap-3" aria-label={t('pdf.viewer.thumbs')}>
      {Array.from({ length: source.pageCount }, (_, i) => {
        const s = source.sizes[i] ?? source.sizes[0]
        const active = i === current
        return (
          <li key={i}>
            <button
              type="button"
              onClick={() => onPick(i)}
              aria-current={active ? 'page' : undefined}
              aria-label={t('pdf.viewer.goPage', { n: i + 1 })}
              className="group flex w-full flex-col items-center gap-1.5 rounded-md p-1 outline-none"
            >
              <span
                className={cn(
                  'relative block w-full overflow-hidden rounded-[4px] shadow-e1 ring-offset-2 ring-offset-surface transition-shadow duration-(--dur-fast)',
                  active
                    ? 'ring-2 ring-accent'
                    : 'ring-1 ring-border group-hover:ring-2 group-hover:ring-border-strong',
                )}
              >
                <PageThumb
                  docId={source.id}
                  index={i}
                  aspect={s ? s.w / s.h : 0.707}
                  renderWidth={120}
                  priority={active ? 5 : 1}
                />
              </span>
              <span
                className={cn(
                  'text-caption tabular-nums',
                  active ? 'font-semibold text-accent-ink' : 'text-text-3',
                )}
              >
                {i + 1}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * 單一頁面：進入視窗附近才渲染；縮放時先以 CSS 拉伸舊畫面，新畫面完成後再替換；
 * 離開視窗夠遠就釋放 canvas 與 page.cleanup()。
 */
function ViewerPage({
  doc,
  index,
  scale,
  root,
}: {
  doc: PDFDocumentProxy
  index: number
  scale: number
  root: React.RefObject<HTMLDivElement | null>
}) {
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      root: root.current,
      rootMargin: '120% 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    const el = host.current
    if (!el) return
    if (!visible) {
      // 離開視窗：釋放畫布
      el.querySelectorAll('canvas').forEach((c) => {
        releaseCanvas(c)
        c.remove()
      })
      return
    }
    // 已有畫面時（縮放）稍微延遲，連續縮放只重畫最後一次
    const hasCanvas = !!el.querySelector('canvas')
    const ctrl = new AbortController()
    const timer = setTimeout(
      () => {
        schedule(
          async () => {
            const page = await doc.getPage(index + 1)
            try {
              const dpr = Math.min(2, window.devicePixelRatio || 1)
              const vp0 = page.getViewport({ scale: 1 })
              const s = clampScale(vp0.width, vp0.height, scale * dpr)
              const viewport = page.getViewport({ scale: s })
              const canvas = document.createElement('canvas')
              canvas.width = Math.floor(viewport.width)
              canvas.height = Math.floor(viewport.height)
              canvas.className = 'absolute inset-0 size-full'
              canvas.setAttribute('aria-hidden', 'true')
              const task = page.render({ canvas, viewport, background: '#ffffff' })
              const onAbort = () => task.cancel()
              ctrl.signal.addEventListener('abort', onAbort, { once: true })
              try {
                await task.promise
              } catch (e) {
                releaseCanvas(canvas)
                throw e
              } finally {
                ctrl.signal.removeEventListener('abort', onAbort)
              }
              if (ctrl.signal.aborted) {
                releaseCanvas(canvas)
                return
              }
              const old = Array.from(el.querySelectorAll('canvas'))
              canvas.dataset.fresh = old.length ? '0' : '1'
              el.appendChild(canvas)
              old.forEach((c) => {
                releaseCanvas(c)
                c.remove()
              })
            } finally {
              page.cleanup()
            }
          },
          { priority: 10, signal: ctrl.signal },
        ).catch((e) => {
          if (!isAbortError(e) && (e as Error)?.name !== 'RenderingCancelledException')
            console.error(e)
        })
      },
      hasCanvas ? 120 : 0,
    )
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [visible, scale, doc, index])

  useEffect(() => {
    const el = host.current
    return () => {
      el?.querySelectorAll('canvas').forEach((c) => releaseCanvas(c))
    }
  }, [])

  return (
    <div ref={host} className="viewer-page absolute inset-0">
      <div className="viewer-skel absolute inset-0 p-[8%]">
        <div className="flex h-full flex-col gap-3">
          <Skeleton className="h-[6%] w-2/3" />
          <Skeleton className="h-[3%] w-full" />
          <Skeleton className="h-[3%] w-11/12" />
          <Skeleton className="h-[3%] w-4/5" />
          <Skeleton className="mt-4 h-[28%] w-full" />
          <Skeleton className="h-[3%] w-full" />
          <Skeleton className="h-[3%] w-3/4" />
        </div>
      </div>
    </div>
  )
}
