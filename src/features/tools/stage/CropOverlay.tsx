/**
 * 裁切框：拖曳移動、八個把手縮放、方向鍵微調。
 * 招牌動畫：靠近框架邊界、中線或常用比例時，以彈簧「吸」過去；拖曳時淡入三分法格線。
 */
import { AnimatePresence, animate, motion, useMotionValue, type MotionValue } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { duration, sec, spring } from '@/design/motion'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import {
  cropRect,
  frameOf,
  isFullRect,
  moveRect,
  resizeRect,
  snapMove,
  snapResize,
  stateRatio,
  type Handle,
  type SnapResult,
} from '../lib/geometry'
import type { EditState, Rect } from '../lib/types'
import type { Doc } from '../store'

/** 磁吸門檻（螢幕像素） */
const SNAP_PX = 8
/** 進出吸附時用彈簧過渡的時間窗 */
const SETTLE_MS = duration.base

const HANDLES: Array<{ h: Handle; left: string; top: string; cursor: string }> = [
  { h: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { h: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { h: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { h: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { h: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { h: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { h: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { h: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
]

interface Drag {
  kind: 'move' | 'resize'
  handle: Handle
  start: Rect
  x: number
  y: number
  snapped: boolean
  settleUntil: number
  rect: Rect
  pointerId: number
}

export function CropOverlay({
  doc,
  state,
  k,
  onCommit,
}: {
  doc: Doc
  state: EditState
  /** 顯示像素／框架像素 */
  k: number
  onCommit: (rect: Rect | null, label: 'crop' | 'nudge') => void
}) {
  const t = useT()
  const motionPref = useSettings((s) => s.motion)
  const frame = frameOf(state.geometry, doc.srcW, doc.srcH)
  const crop = cropRect(state.geometry, doc.srcW, doc.srcH)
  const ratio = stateRatio(state, frame.w, frame.h)

  const mx = useMotionValue(crop.x * k)
  const my = useMotionValue(crop.y * k)
  const mw = useMotionValue(crop.w * k)
  const mh = useMotionValue(crop.h * k)
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)
  const [snap, setSnap] = useState<Pick<SnapResult, 'guideX' | 'guideY' | 'ratioLabel'>>({
    guideX: null,
    guideY: null,
    ratioLabel: null,
  })
  const [live, setLive] = useState<Rect>(crop)

  const springy = motionPref === 'full'
  const setAll = (r: Rect, how: 'jump' | 'snappy' | 'smooth') => {
    const pairs: Array<[MotionValue<number>, number]> = [
      [mx, r.x * k],
      [my, r.y * k],
      [mw, r.w * k],
      [mh, r.h * k],
    ]
    for (const [mv, v] of pairs) {
      if (how === 'jump' || !springy) mv.jump(v)
      else animate(mv, v, how === 'snappy' ? spring.snappy : spring.smooth)
    }
  }

  // 外部變更（切換比例、復原、旋轉）時以彈簧移到新位置
  const cx = crop.x
  const cy = crop.y
  const cw = crop.w
  const ch = crop.h
  const lastK = useRef(k)
  useEffect(() => {
    if (drag.current) return
    const resized = lastK.current !== k
    lastK.current = k
    setAll({ x: cx, y: cy, w: cw, h: ch }, resized ? 'jump' : 'smooth')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cx, cy, cw, ch, k])

  const begin = (e: PointerEvent, kind: Drag['kind'], handle: Handle) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = {
      kind,
      handle,
      start: crop,
      x: e.clientX,
      y: e.clientY,
      snapped: false,
      settleUntil: 0,
      rect: crop,
      pointerId: e.pointerId,
    }
    setLive(crop)
    setDragging(true)
  }

  const move = (e: PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    const dx = (e.clientX - d.x) / k
    const dy = (e.clientY - d.y) / k
    const thr = SNAP_PX / k
    const raw =
      d.kind === 'move'
        ? moveRect(d.start, dx, dy, frame.w, frame.h)
        : resizeRect(d.start, d.handle, dx, dy, { ratio, fw: frame.w, fh: frame.h })
    const s =
      d.kind === 'move'
        ? snapMove(raw, frame.w, frame.h, thr)
        : snapResize(raw, d.handle, frame.w, frame.h, thr, ratio)
    const snapped =
      s.guideX !== null || s.guideY !== null || s.ratioLabel !== null || !sameRect(s.rect, raw)
    const now = performance.now()
    // 剛吸上或剛離開：短時間內用彈簧過渡，其餘時間緊跟游標
    if (snapped !== d.snapped) d.settleUntil = now + SETTLE_MS
    d.snapped = snapped
    d.rect = s.rect
    setAll(s.rect, now < d.settleUntil ? 'snappy' : 'jump')
    setLive(s.rect)
    setSnap((p) =>
      p.guideX === s.guideX && p.guideY === s.guideY && p.ratioLabel === s.ratioLabel
        ? p
        : { guideX: s.guideX, guideY: s.guideY, ratioLabel: s.ratioLabel },
    )
  }

  const end = (e: PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    setDragging(false)
    setSnap({ guideX: null, guideY: null, ratioLabel: null })
    setAll(d.rect, 'snappy')
    if (!sameRect(d.rect, d.start)) onCommit(normalize(d.rect, frame.w, frame.h), 'crop')
  }

  const onKey = (e: KeyboardEvent) => {
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const dir = dirs[e.key]
    if (!dir) return
    e.preventDefault()
    const step = (e.shiftKey ? 10 : 1) * Math.max(1, 1 / k)
    let r: Rect
    if (e.altKey) {
      const handle: Handle = dir[0] ? 'e' : 's'
      r = resizeRect(crop, handle, dir[0] * step, dir[1] * step, {
        ratio,
        fw: frame.w,
        fh: frame.h,
      })
    } else r = moveRect(crop, dir[0] * step, dir[1] * step, frame.w, frame.h)
    onCommit(normalize(r, frame.w, frame.h), 'nudge')
  }

  const fmt = (v: number) => Math.round(v)
  const shown = dragging ? live : crop
  const dims = `${fmt(shown.w)} × ${fmt(shown.h)}`

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ touchAction: 'none' }}>
      {/* 吸附輔助線 */}
      <AnimatePresence>
        {snap.guideX !== null && (
          <motion.div
            key={`gx-${snap.guideX}`}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-20 w-px bg-accent"
            style={{ left: snap.guideX * k }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.9 }}
            exit={{ opacity: 0 }}
            transition={{ duration: sec(duration.instant) }}
          />
        )}
        {snap.guideY !== null && (
          <motion.div
            key={`gy-${snap.guideY}`}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-20 h-px bg-accent"
            style={{ top: snap.guideY * k }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.9 }}
            exit={{ opacity: 0 }}
            transition={{ duration: sec(duration.instant) }}
          />
        )}
      </AnimatePresence>

      <motion.div
        role="group"
        tabIndex={0}
        aria-label={t('tools.crop.boxDims', { label: t('tools.crop.boxLabel'), dims })}
        onKeyDown={onKey}
        onPointerDown={(e) => begin(e, 'move', 'n')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute left-0 top-0 z-10 cursor-move outline-none focus-visible:[&>.tl-crop-border]:ring-2 focus-visible:[&>.tl-crop-border]:ring-accent"
        style={{
          x: mx,
          y: my,
          width: mw,
          height: mh,
          boxShadow: `0 0 0 100vmax rgba(10,12,16,${dragging ? 0.42 : 0.58})`,
          transition: `box-shadow ${duration.fast}ms`,
        }}
      >
        <div
          aria-hidden
          className="tl-crop-border pointer-events-none absolute inset-0 border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.25)]"
        />
        {/* 三分法格線：拖曳時淡入 */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={false}
          animate={{ opacity: dragging ? 1 : 0 }}
          transition={{ duration: sec(duration.fast) }}
        >
          {[1, 2].map((i) => (
            <span
              key={`v${i}`}
              className="absolute inset-y-0 w-px bg-white/60 shadow-[0_0_1px_rgba(0,0,0,.4)]"
              style={{ left: `${(i * 100) / 3}%` }}
            />
          ))}
          {[1, 2].map((i) => (
            <span
              key={`h${i}`}
              className="absolute inset-x-0 h-px bg-white/60 shadow-[0_0_1px_rgba(0,0,0,.4)]"
              style={{ top: `${(i * 100) / 3}%` }}
            />
          ))}
        </motion.div>

        {HANDLES.map(({ h, left, top, cursor }) => (
          <div
            key={h}
            aria-hidden
            className="tl-handle z-10"
            style={{ left, top, cursor }}
            onPointerDown={(e) => begin(e, 'resize', h)}
          >
            <HandleGlyph h={h} />
          </div>
        ))}

        {/* 比例吸附提示與尺寸 */}
        <AnimatePresence>
          {snap.ratioLabel && (
            <motion.span
              key={snap.ratioLabel}
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 z-20 -ml-6 -mt-3.5 grid h-7 w-12 place-items-center rounded-full bg-accent-strong text-caption font-semibold text-on-accent shadow-e2"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={spring.bouncy}
            >
              {snap.ratioLabel}
            </motion.span>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {dragging && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[rgba(10,12,16,.72)] px-2.5 py-0.5 text-caption tabular-nums text-white"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: sec(duration.fast) }}
            >
              {dims}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function HandleGlyph({ h }: { h: Handle }) {
  const corner = h.length === 2
  const base = 'absolute bg-white shadow-[0_0_0_1px_rgba(0,0,0,.28)] rounded-full'
  if (!corner) {
    const vertical = h === 'e' || h === 'w'
    return (
      <span
        className={base}
        style={
          vertical
            ? { left: '50%', top: '50%', width: 4, height: 22, marginLeft: -2, marginTop: -11 }
            : { left: '50%', top: '50%', width: 22, height: 4, marginLeft: -11, marginTop: -2 }
        }
      />
    )
  }
  // 角落：L 形，開口朝向框內
  const sx = h.includes('w') ? 1 : -1
  const sy = h.includes('n') ? 1 : -1
  return (
    <span
      className="absolute left-1/2 top-1/2"
      style={{ transform: `scale(${sx}, ${sy})`, width: 0, height: 0 }}
    >
      <span className={base} style={{ left: -2, top: -2, width: 18, height: 4 }} />
      <span className={base} style={{ left: -2, top: -2, width: 4, height: 18 }} />
    </span>
  )
}

const sameRect = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < 0.01 &&
  Math.abs(a.y - b.y) < 0.01 &&
  Math.abs(a.w - b.w) < 0.01 &&
  Math.abs(a.h - b.h) < 0.01

/** 對齊到整數像素；整張時存 null */
function normalize(r: Rect, fw: number, fh: number): Rect | null {
  const x = Math.round(r.x)
  const y = Math.round(r.y)
  const out = {
    x,
    y,
    w: Math.min(fw - x, Math.max(1, Math.round(r.w))),
    h: Math.min(fh - y, Math.max(1, Math.round(r.h))),
  }
  return isFullRect(out, fw, fh) ? null : out
}
