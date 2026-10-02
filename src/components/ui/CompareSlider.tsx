import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { MoveHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'
import { clamp } from '@/lib/format'
import { useT } from '@/i18n'

interface CompareSliderProps {
  before: ReactNode
  after: ReactNode
  className?: string
  beforeLabel?: string
  afterLabel?: string
  /** 0 到 100 */
  initial?: number
}

/**
 * 前後對比：分隔線可拖曳或用方向鍵移動；兩側圖片有極輕微的視差。
 * before／after 應為同尺寸的內容（例如兩張 <img>，object-contain 填滿）。
 */
export function CompareSlider({
  before,
  after,
  className,
  beforeLabel,
  afterLabel,
  initial = 50,
}: CompareSliderProps) {
  const t = useT()
  const [pos, setPos] = useState(initial)
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const update = useCallback((clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos(clamp(((clientX - r.left) / r.width) * 100, 0, 100))
  }, [])
  const down = (e: PointerEvent) => {
    dragging.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    update(e.clientX)
  }
  const move = (e: PointerEvent) => dragging.current && update(e.clientX)
  const up = () => {
    dragging.current = false
  }
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2
    if (e.key === 'ArrowLeft') setPos((p) => clamp(p - step, 0, 100))
    else if (e.key === 'ArrowRight') setPos((p) => clamp(p + step, 0, 100))
    else if (e.key === 'Home') setPos(0)
    else if (e.key === 'End') setPos(100)
    else return
    e.preventDefault()
  }
  const parallax = (pos - 50) * 0.04
  return (
    <div
      ref={ref}
      className={cn(
        'relative isolate touch-none select-none overflow-hidden rounded-lg bg-[repeating-conic-gradient(var(--surface-2)_0_25%,var(--surface)_0_50%)] bg-[length:20px_20px]',
        className,
      )}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div className="absolute inset-0" style={{ transform: `translateX(${-parallax}px)` }}>
        {after}
      </div>
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)`, transform: `translateX(${parallax}px)` }}
      >
        {before}
      </div>
      {beforeLabel && (
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-caption font-medium text-white backdrop-blur">
          {beforeLabel}
        </span>
      )}
      {afterLabel && (
        <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-caption font-medium text-white backdrop-blur">
          {afterLabel}
        </span>
      )}
      <div
        role="slider"
        tabIndex={0}
        aria-label={t('a11y.compareSlider')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        onKeyDown={key}
        className="absolute inset-y-0 z-10 w-10 -translate-x-1/2 cursor-ew-resize outline-none focus-visible:[&>span:last-child]:ring-2 focus-visible:[&>span:last-child]:ring-accent"
        style={{ left: `${pos}%` }}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.15),0_0_12px_rgba(0,0,0,.25)]"
        />
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-slate-700 shadow-e3"
        >
          <MoveHorizontal size={16} />
        </span>
      </div>
    </div>
  )
}
