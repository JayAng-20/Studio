/**
 * 鏡頭泡泡編輯：在預覽框上拖曳位置、拖曳把手縮放、方向鍵微調。
 * 位置以 0 到 1 的比例存，與實際錄影畫面一致。只用 transform 定位。
 */
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { spring } from '@/design/motion'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { BUBBLE_MAX, BUBBLE_MIN, clampBubble, type BubblePrefs } from './core'
import { StreamVideo } from './media'

export function BubbleEditor({
  stream,
  bubble,
  onChange,
  onCommit,
  loading,
  className,
  ghost,
}: {
  /** 只顯示可拖曳的外框（錄影中，泡泡已經合成在預覽畫面裡） */
  ghost?: boolean
  stream: MediaStream | null
  bubble: BubblePrefs
  /** 拖曳中持續呼叫（例如更新錄影中的合成） */
  onChange?: (b: BubblePrefs) => void
  /** 放開時呼叫（存偏好設定） */
  onCommit: (b: BubblePrefs) => void
  loading?: boolean
  className?: string
}) {
  const t = useT()
  const frame = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [draft, setDraft] = useState<BubblePrefs | null>(null)
  const [dragging, setDragging] = useState<'move' | 'resize' | null>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  useEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect
      setBox({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const aspect = box.h ? box.w / box.h : 16 / 9
  const b = clampBubble(draft ?? bubble, aspect)
  const d = b.size * Math.min(box.w, box.h)
  const left = b.x * box.w - d / 2
  const top = b.y * box.h - d / 2

  const update = (next: BubblePrefs) => {
    const c = clampBubble(next, aspect)
    setDraft(c)
    onChange?.(c)
    return c
  }
  const commit = (next: BubblePrefs) => {
    setDraft(null)
    onCommit(clampBubble(next, aspect))
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>, mode: 'move' | 'resize') => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const rect = frame.current?.getBoundingClientRect()
    if (!rect) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const cx = rect.left + b.x * rect.width
    const cy = rect.top + b.y * rect.height
    drag.current = { dx: e.clientX - cx, dy: e.clientY - cy }
    setDragging(mode)
    setDraft(b)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !drag.current) return
    const rect = frame.current?.getBoundingClientRect()
    if (!rect) return
    const cur = draft ?? b
    if (dragging === 'move') {
      update({
        ...cur,
        x: (e.clientX - drag.current.dx - rect.left) / rect.width,
        y: (e.clientY - drag.current.dy - rect.top) / rect.height,
      })
    } else {
      const cx = rect.left + cur.x * rect.width
      const cy = rect.top + cur.y * rect.height
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy)
      const size = (dist * 2) / Math.SQRT2 / Math.min(rect.width, rect.height)
      update({ ...cur, size: Math.min(BUBBLE_MAX, Math.max(BUBBLE_MIN, size)) })
    }
  }
  const onPointerUp = () => {
    if (!dragging) return
    setDragging(null)
    drag.current = null
    commit(draft ?? b)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01
    let next: BubblePrefs | null = null
    if (e.key === 'ArrowLeft') next = { ...b, x: b.x - step }
    else if (e.key === 'ArrowRight') next = { ...b, x: b.x + step }
    else if (e.key === 'ArrowUp') next = { ...b, y: b.y - step }
    else if (e.key === 'ArrowDown') next = { ...b, y: b.y + step }
    else if (e.key === '+' || e.key === '=') next = { ...b, size: b.size + 0.02 }
    else if (e.key === '-' || e.key === '_') next = { ...b, size: b.size - 0.02 }
    if (!next) return
    e.preventDefault()
    e.stopPropagation()
    const c = update(next)
    commit(c)
  }

  return (
    <div ref={frame} className={cn('pointer-events-none absolute inset-0', className)}>
      {box.w > 0 && (
        <motion.div
          role="group"
          aria-label={t('recorder.stage.bubbleLabel')}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="pointer-events-auto absolute left-0 top-0 touch-none select-none outline-none"
          style={{ width: d, height: d, x: left, y: top }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: dragging === 'move' ? 1.04 : 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={spring.bouncy}
        >
          <div
            onPointerDown={(e) => onPointerDown(e, 'move')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={cn(
              'relative size-full overflow-hidden rounded-full',
              ghost
                ? 'ring-2 ring-transparent transition-[box-shadow] duration-(--dur-fast) hover:ring-white/70'
                : 'bg-[#1b1f27] shadow-e3 ring-[3px] ring-white/90',
              dragging && ghost && 'ring-white/80',
              dragging === 'move' ? 'cursor-grabbing' : 'cursor-grab',
              'in-focus-visible:ring-accent',
            )}
          >
            {ghost ? null : stream ? (
              <StreamVideo
                stream={stream}
                mirror={b.mirror}
                className="size-full object-cover"
              />
            ) : (
              <div className={cn('size-full', loading && 'skeleton shimmer')} />
            )}
          </div>
          {/* 縮放把手：在圓周右下 45° 的位置 */}
          <div
            aria-hidden
            onPointerDown={(e) => onPointerDown(e, 'resize')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="absolute grid size-7 cursor-nwse-resize place-items-center"
            style={{ left: d / 2 + (d / 2) * Math.SQRT1_2 - 14, top: d / 2 + (d / 2) * Math.SQRT1_2 - 14 }}
          >
            <span className="size-3.5 rounded-full border-2 border-white bg-accent shadow-e2" />
          </div>
        </motion.div>
      )}
    </div>
  )
}
