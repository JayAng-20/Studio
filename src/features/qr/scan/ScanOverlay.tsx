import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type CSSProperties } from 'react'
import { duration, easing, sec, spring } from '@/design/motion'
import { cn } from '@/lib/cn'
import type { Point } from '../lib/decode'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 追蹤元素尺寸（ResizeObserver）；回傳 callback ref，元素晚一點才掛載也能追蹤 */
export function useSize<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<T | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, size]
}

/** 來源影像座標 → 容器座標（object-fit: cover 或 contain） */
export function mapCorners(
  corners: Point[],
  src: { w: number; h: number },
  box: { w: number; h: number },
  fit: 'cover' | 'contain',
): Rect | null {
  if (!corners.length || !src.w || !src.h || !box.w || !box.h) return null
  const k = fit === 'cover' ? Math.max(box.w / src.w, box.h / src.h) : Math.min(box.w / src.w, box.h / src.h)
  const ox = (box.w - src.w * k) / 2
  const oy = (box.h - src.h * k) / 2
  const xs = corners.map((p) => p.x * k + ox)
  const ys = corners.map((p) => p.y * k + oy)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export type OverlayState = 'scanning' | 'success' | 'idle'

const ARM = 28
const STROKE = 4

/** 一個 L 形角：TL 方向，其他角以 scale 翻轉 */
function BracketShape({ flipX, flipY, color }: { flipX: boolean; flipY: boolean; color: string }) {
  return (
    <svg
      width={ARM}
      height={ARM}
      viewBox={`0 0 ${ARM} ${ARM}`}
      aria-hidden
      className="absolute inset-0 overflow-visible"
      style={{ transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` }}
    >
      <path
        d={`M${STROKE / 2} ${ARM - 2}V${10}Q${STROKE / 2} ${STROKE / 2} ${10} ${STROKE / 2}H${ARM - 2}`}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 掃描框：四角括號緩慢呼吸、掃描線上下掃動；
 * 辨識成功時括號以彈簧收緊貼到 QR 上並閃一下綠色。
 */
export function ScanOverlay({
  box,
  target,
  state,
  vignette,
}: {
  box: { w: number; h: number }
  target: Rect | null
  state: OverlayState
  vignette?: boolean
}) {
  if (!box.w || !box.h) return null
  const side = Math.min(box.w, box.h) * 0.64
  const frame: Rect = { x: (box.w - side) / 2, y: (box.h - side) / 2, w: side, h: side }
  const pad = 8
  const r: Rect = target
    ? {
        x: target.x - pad,
        y: target.y - pad,
        w: Math.max(target.w + pad * 2, ARM * 2),
        h: Math.max(target.h + pad * 2, ARM * 2),
      }
    : frame
  const success = state === 'success' && !!target
  const corners = [
    { key: 'tl', x: r.x, y: r.y, fx: false, fy: false, bx: 1, by: 1 },
    { key: 'tr', x: r.x + r.w - ARM, y: r.y, fx: true, fy: false, bx: -1, by: 1 },
    { key: 'bl', x: r.x, y: r.y + r.h - ARM, fx: false, fy: true, bx: 1, by: -1 },
    { key: 'br', x: r.x + r.w - ARM, y: r.y + r.h - ARM, fx: true, fy: true, bx: -1, by: -1 },
  ]
  const vars = {
    '--qr-breathe': `${duration.hero * 3}ms`,
    '--qr-scan': `${duration.hero * 2}ms`,
  } as CSSProperties

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" style={vars}>
      {vignette && (
        <motion.div
          className="qr-vignette absolute rounded-xl"
          initial={false}
          animate={{ x: frame.x, y: frame.y, opacity: success ? 0.4 : 1 }}
          transition={{ duration: sec(duration.base), ease: easing.standard }}
          style={{ left: 0, top: 0, width: frame.w, height: frame.h }}
        />
      )}
      {state === 'scanning' && (
        <div
          className="absolute overflow-hidden"
          style={{ left: frame.x + 10, top: frame.y + 8, width: frame.w - 20, height: frame.h - 16 }}
        >
          <div
            className="qr-scanline motion-decor absolute inset-x-0 top-0 h-0.5 rounded-full"
            style={
              {
                '--travel': `${frame.h - 18}px`,
                background:
                  'linear-gradient(90deg, transparent, color-mix(in srgb, var(--m-1) 45%, white) 20%, white 50%, color-mix(in srgb, var(--m-1) 45%, white) 80%, transparent)',
                boxShadow: '0 0 14px 2px color-mix(in srgb, var(--m-1) 55%, white)',
              } as CSSProperties
            }
          />
        </div>
      )}
      <AnimatePresence>
        {success && target && (
          <motion.div
            key={`${Math.round(target.x)}-${Math.round(target.y)}`}
            className="absolute rounded-md bg-success"
            style={{ left: target.x, top: target.y, width: target.w, height: target.h }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: [0, 0.45, 0], scale: [0.92, 1.04, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: sec(duration.slower), ease: easing.decelerate }}
          />
        )}
      </AnimatePresence>
      {corners.map((c) => (
        <motion.div
          key={c.key}
          className="absolute left-0 top-0"
          style={{ width: ARM, height: ARM }}
          initial={false}
          animate={{ x: c.x, y: c.y }}
          transition={spring.snappy}
        >
          <div
            className={cn('relative size-full', state === 'scanning' && 'qr-bracket-breathe motion-decor')}
            style={{ '--bx': `${c.bx * 4}px`, '--by': `${c.by * 4}px` } as CSSProperties}
          >
            <div className="absolute inset-0 drop-shadow-[0_1px_2px_rgba(0,0,0,.45)]">
              <BracketShape flipX={c.fx} flipY={c.fy} color="white" />
            </div>
            <motion.div
              className="absolute inset-0"
              initial={false}
              animate={{ opacity: success ? 1 : 0, scale: success ? [1.25, 1] : 1 }}
              transition={{ duration: sec(duration.base), ease: easing.emphasized }}
            >
              <BracketShape flipX={c.fx} flipY={c.fy} color="var(--success)" />
            </motion.div>
          </div>
        </motion.div>
      ))}
    </div>
  )
}
