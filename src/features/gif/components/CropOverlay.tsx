import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { clamp } from '@/lib/format'
import { useGT } from '../useGT'
import { useGifStore } from '../store'
import { cropRatioValue, type CropRect } from '../settings'
import type { Geometry } from '../render'

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'
const MIN = 0.05

/**
 * 依拖曳的把手算出新的裁切範圍（正規化座標）。
 * ratio 為像素寬高比；k 為正規化座標下的寬高比。
 */
export function resizeCrop(
  start: CropRect,
  handle: Handle,
  dx: number,
  dy: number,
  k: number | null,
): CropRect {
  if (handle === 'move') {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    }
  }
  const left = handle === 'nw' || handle === 'sw'
  const top = handle === 'nw' || handle === 'ne'
  // 固定對角
  const ax = left ? start.x + start.w : start.x
  const ay = top ? start.y + start.h : start.y
  let w = clamp(left ? start.w - dx : start.w + dx, MIN, left ? ax : 1 - ax)
  let h = clamp(top ? start.h - dy : start.h + dy, MIN, top ? ay : 1 - ay)
  if (k !== null) {
    // 以變化較大的一邊為主，另一邊依比例
    if (Math.abs(dx) >= Math.abs(dy)) h = w / k
    else w = h * k
    const maxW = left ? ax : 1 - ax
    const maxH = top ? ay : 1 - ay
    if (w > maxW) {
      w = maxW
      h = w / k
    }
    if (h > maxH) {
      h = maxH
      w = h * k
    }
  }
  return { x: left ? ax - w : ax, y: top ? ay - h : ay, w, h }
}

/** 裁切框：外部變暗、三分線、四角把手；可拖曳移動、方向鍵微調 */
export function CropOverlay({ geom }: { geom: Geometry }) {
  const t = useGT()
  const crop = useGifStore((s) => s.crop)
  const ratio = useGifStore((s) => s.cropRatio)
  const setCrop = useGifStore((s) => s.setCrop)
  const drag = useRef<{ h: Handle; px: number; py: number; start: CropRect; w: number; hgt: number } | null>(
    null,
  )
  const r = cropRatioValue(ratio, geom.baseW, geom.baseH)
  const k = r === null ? null : (r * geom.baseH) / geom.baseW

  const down = (e: PointerEvent<HTMLElement>, h: Handle) => {
    e.stopPropagation()
    const box = (e.currentTarget.closest('[data-crop-root]') as HTMLElement | null)?.getBoundingClientRect()
    if (!box) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { h, px: e.clientX, py: e.clientY, start: crop, w: box.width, hgt: box.height }
  }
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    setCrop(resizeCrop(d.start, d.h, (e.clientX - d.px) / d.w, (e.clientY - d.py) / d.hgt, k))
  }
  const up = () => {
    drag.current = null
  }
  const key = (e: KeyboardEvent, h: Handle) => {
    const step = e.shiftKey ? 0.05 : 0.01
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const d = map[e.key]
    if (!d) return
    e.preventDefault()
    setCrop(resizeCrop(crop, h, d[0], d[1], k))
  }
  const pct = (v: number) => `${v * 100}%`
  const corners: Array<{ h: Handle; x: number; y: number; cursor: string }> = [
    { h: 'nw', x: crop.x, y: crop.y, cursor: 'nwse-resize' },
    { h: 'ne', x: crop.x + crop.w, y: crop.y, cursor: 'nesw-resize' },
    { h: 'sw', x: crop.x, y: crop.y + crop.h, cursor: 'nesw-resize' },
    { h: 'se', x: crop.x + crop.w, y: crop.y + crop.h, cursor: 'nwse-resize' },
  ]
  const shade = 'absolute bg-black/55'
  return (
    <div data-crop-root className="absolute inset-0 touch-none select-none">
      {/* 外部變暗 */}
      <div className={shade} style={{ left: 0, top: 0, right: 0, height: pct(crop.y) }} />
      <div className={shade} style={{ left: 0, bottom: 0, right: 0, height: pct(1 - crop.y - crop.h) }} />
      <div className={shade} style={{ left: 0, top: pct(crop.y), width: pct(crop.x), height: pct(crop.h) }} />
      <div
        className={shade}
        style={{ right: 0, top: pct(crop.y), width: pct(1 - crop.x - crop.w), height: pct(crop.h) }}
      />
      <div
        role="button"
        tabIndex={0}
        aria-label={t('crop.area')}
        className="absolute cursor-move outline-none ring-2 ring-white focus-visible:ring-accent"
        style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
        onPointerDown={(e) => down(e, 'move')}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => key(e, 'move')}
      >
        <span className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/45" />
        <span className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/45" />
        <span className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/45" />
        <span className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/45" />
      </div>
      {corners.map((c) => (
        <span
          key={c.h}
          role="button"
          tabIndex={0}
          aria-label={`${t('crop.handle')}（${c.h.toUpperCase()}）`}
          className="group absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center outline-none"
          style={{ left: pct(c.x), top: pct(c.y), cursor: c.cursor }}
          onPointerDown={(e) => down(e, c.h)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={(e) => key(e, c.h)}
        >
          <span className="size-4 rounded-full border-2 border-white bg-accent shadow-e2 transition-transform duration-(--dur-fast) group-hover:scale-125 group-focus-visible:ring-2 group-focus-visible:ring-white" />
        </span>
      ))}
    </div>
  )
}
