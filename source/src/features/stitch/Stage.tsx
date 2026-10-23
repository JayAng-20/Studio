/**
 * 拼接畫布：圖片可自由拖曳、右下角等比縮放；開啟輔助定位時吸附到其他圖片的邊、中線與間距，
 * 並以動畫參考線提示。拖曳期間畫布原點固定，放開後才正規化並以彈簧動畫歸位。
 */
import { AnimatePresence, motion } from 'motion/react'
import { Maximize2, Minus, Plus, ScanSearch } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Button, Tooltip } from '@/components/ui'
import { spring, staggerDelay } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { bounds, normalize, snapMove, snapResize, type Guide } from './lib'
import { useStitch, type StitchItem } from './store'

interface Drag {
  id: string
  mode: 'move' | 'resize'
  sx: number
  sy: number
  orig: StitchItem
  before: StitchItem[]
  origin: { x: number; y: number }
}

const SNAP_PX = 8

export function Stage() {
  const t = useT()
  const items = useStitch((s) => s.items)
  const selected = useStitch((s) => s.selected)
  const options = useStitch((s) => s.options)
  const flow = useStitch((s) => s.flow)
  // 動畫關閉時位置與尺寸（left／top／width／height 不是 transform）直接跳到定位
  const instant = useSettings((s) => s.motion) === 'off'
  const box = useRef<HTMLDivElement>(null)
  const [vw, setVw] = useState(800)
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [guides, setGuides] = useState<Guide[]>([])
  const [matched, setMatched] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setVw(el.clientWidth))
    ro.observe(el)
    setVw(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const pad = options.padding
  const b = bounds(items)
  const origin = drag ? drag.origin : { x: b.x, y: b.y }
  const right = Math.max(b.x + b.w, origin.x)
  const bottom = Math.max(b.y + b.h, origin.y)
  const boardW = right - origin.x + pad * 2
  const boardH = bottom - origin.y + pad * 2
  const fitZ =
    flow === 'horizontal'
      ? Math.min(1, (vw - 48) / Math.max(1, boardW), 560 / Math.max(1, boardH))
      : Math.min(1, (vw - 48) / Math.max(1, boardW))
  const z = zoom === 'fit' ? Math.max(0.02, fitZ) : zoom

  const start = (e: RPointerEvent<HTMLElement>, item: StitchItem, mode: Drag['mode']) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const st = useStitch.getState()
    st.select(item.id)
    const d: Drag = {
      id: item.id,
      mode,
      sx: e.clientX,
      sy: e.clientY,
      orig: item,
      before: st.items,
      origin: { x: b.x, y: b.y },
    }
    dragRef.current = d
    setDrag(d)
  }
  const move = (e: RPointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d) return
    const st = useStitch.getState()
    const dx = (e.clientX - d.sx) / z
    const dy = (e.clientY - d.sy) / z
    const others = st.items.filter((i) => i.id !== d.id)
    let next: StitchItem
    if (d.mode === 'move') {
      const cand = { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }
      if (st.options.snap && !e.altKey) {
        const r = snapMove(cand, others, SNAP_PX / z, st.options.gap)
        next = { ...cand, x: r.x, y: r.y }
        setGuides(r.guides)
      } else {
        next = cand
        setGuides([])
      }
    } else {
      const w = Math.max(24, d.orig.w + dx)
      const r = st.options.snap && !e.altKey ? snapResize(d.orig, w, others, SNAP_PX / z) : { w, h: (w * d.orig.h) / d.orig.w, matched: false }
      next = { ...d.orig, w: r.w, h: r.h }
      setMatched(r.matched ? d.id : null)
    }
    st.set(st.items.map((i) => (i.id === d.id ? next : i)))
  }
  const end = () => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    setDrag(null)
    setGuides([])
    setMatched(null)
    const st = useStitch.getState()
    const cur = st.items.find((i) => i.id === d.id)
    const changed = !!cur && (cur.x !== d.orig.x || cur.y !== d.orig.y || cur.w !== d.orig.w)
    if (changed) {
      st.commit(normalize(st.items), d.before)
      st.setFlow('free')
    }
  }

  // 縮放鍵：Ctrl／⌘＋滾輪
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      setZoom((cur) => {
        const base = cur === 'fit' ? fitZ : cur
        return Math.min(2, Math.max(0.03, base * (e.deltaY < 0 ? 1.1 : 0.9)))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [fitZ])

  const step = (f: number) => setZoom((cur) => Math.min(2, Math.max(0.03, (cur === 'fit' ? fitZ : cur) * f)))
  const toBoard = (x: number) => (x - origin.x + pad) * z
  const toBoardY = (y: number) => (y - origin.y + pad) * z

  return (
    <div className="card flex flex-col overflow-hidden" data-tour="stitch-stage">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-caption tabular-nums text-text-3">
          {t('stitch.size', { w: Math.round(boardW), h: Math.round(boardH) })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip content={t('stitch.zoomOut')}>
            <Button icon size="sm" variant="ghost" aria-label={t('stitch.zoomOut')} onClick={() => step(0.8)}>
              <Minus size={15} aria-hidden />
            </Button>
          </Tooltip>
          <span className="w-12 text-center text-caption tabular-nums text-text-2">{Math.round(z * 100)}%</span>
          <Tooltip content={t('stitch.zoomIn')}>
            <Button icon size="sm" variant="ghost" aria-label={t('stitch.zoomIn')} onClick={() => step(1.25)}>
              <Plus size={15} aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content={t('stitch.fit')}>
            <Button icon size="sm" variant={zoom === 'fit' ? 'secondary' : 'ghost'} aria-label={t('stitch.fit')} onClick={() => setZoom('fit')}>
              <Maximize2 size={14} aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content={t('stitch.actual')}>
            <Button icon size="sm" variant={zoom === 1 ? 'secondary' : 'ghost'} aria-label={t('stitch.actual')} onClick={() => setZoom(1)}>
              <ScanSearch size={15} aria-hidden />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div
        ref={box}
        className="relative max-h-[72dvh] min-h-[360px] overflow-auto bg-[radial-gradient(circle,var(--border-strong)_1px,transparent_1px)] bg-[length:18px_18px] p-6"
        onPointerDown={() => useStitch.getState().select(null)}
      >
        <motion.div
          className={cn(
            'relative mx-auto shadow-e3',
            options.transparent &&
              'bg-[repeating-conic-gradient(#e5e7eb_0%_25%,#ffffff_0%_50%)] bg-[length:16px_16px]',
          )}
          style={{
            width: boardW * z,
            height: boardH * z,
            background: options.transparent ? undefined : options.background,
          }}
          layout
          transition={drag || instant ? { duration: 0 } : spring.smooth}
        >
          <AnimatePresence>
            {items.map((it, i) => {
              const sel = it.id === selected
              return (
                <motion.div
                  key={it.id}
                  className={cn(
                    'group absolute touch-none select-none',
                    drag?.id === it.id ? 'z-20 cursor-grabbing' : 'cursor-grab',
                  )}
                  initial={{ opacity: 0, scale: 0.85, y: -24 }}
                  animate={{
                    opacity: 1,
                    scale: drag?.id === it.id && drag.mode === 'move' ? 1.012 : 1,
                    y: 0,
                    left: toBoard(it.x),
                    top: toBoardY(it.y),
                    width: it.w * z,
                    height: it.h * z,
                  }}
                  exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.18 } }}
                  transition={
                    instant
                      ? { duration: 0 }
                      : drag
                      ? { duration: 0, scale: spring.snappy }
                      : { ...spring.smooth, opacity: { delay: staggerDelay(i) }, y: { ...spring.bouncy, delay: staggerDelay(i) } }
                  }
                  onPointerDown={(e) => start(e, it, 'move')}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  role="button"
                  tabIndex={0}
                  aria-label={t('stitch.itemLabel', { name: it.name, n: i + 1 })}
                  aria-pressed={sel}
                  onFocus={() => useStitch.getState().select(it.id)}
                >
                  <img
                    src={it.url}
                    alt=""
                    draggable={false}
                    className="pointer-events-none size-full object-fill"
                    style={{ borderRadius: options.radius * z }}
                  />
                  <span
                    className={cn(
                      'pointer-events-none absolute inset-0 rounded-[2px] ring-2 transition-[box-shadow,opacity] duration-(--dur-fast)',
                      sel ? 'ring-[var(--accent)] opacity-100' : 'opacity-0 ring-[color-mix(in_srgb,var(--accent)_60%,transparent)] group-hover:opacity-100',
                      matched === it.id && 'ring-success',
                    )}
                  />
                  <AnimatePresence>
                    {sel && (
                      <motion.span
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={spring.bouncy}
                        onPointerDown={(e) => start(e, it, 'resize')}
                        onPointerMove={move}
                        onPointerUp={end}
                        onPointerCancel={end}
                        className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-full border-2 border-white bg-[var(--accent)] shadow-e2"
                        aria-hidden
                      />
                    )}
                  </AnimatePresence>
                  {sel && (
                    <motion.span
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="pointer-events-none absolute -top-6 left-0 whitespace-nowrap rounded-full bg-[var(--accent-strong)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-white shadow-e2"
                    >
                      {Math.round(it.w)} × {Math.round(it.h)}
                    </motion.span>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
          <AnimatePresence>
            {guides.map((g) => (
              <motion.span
                key={`${g.axis}-${Math.round(g.pos)}`}
                className="pointer-events-none absolute z-30 bg-[#f43f5e] shadow-[0_0_6px_rgba(244,63,94,.8)]"
                initial={{ opacity: 0, scaleX: g.axis === 'h' ? 0.3 : 1, scaleY: g.axis === 'v' ? 0.3 : 1 }}
                animate={{ opacity: 1, scaleX: 1, scaleY: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                style={
                  g.axis === 'v'
                    ? { left: toBoard(g.pos) - 0.5, top: toBoardY(g.from) - 12, width: 1, height: (g.to - g.from) * z + 24 }
                    : { top: toBoardY(g.pos) - 0.5, left: toBoard(g.from) - 12, height: 1, width: (g.to - g.from) * z + 24 }
                }
              />
            ))}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}
