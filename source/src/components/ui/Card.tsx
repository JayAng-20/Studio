import { forwardRef, useCallback, useRef, type HTMLAttributes, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 游標聚光＋上浮 */
  interactive?: boolean
  /** 3D 傾斜（最多 6°），只在可 hover 的裝置啟用 */
  tilt?: boolean
  padded?: boolean
}

/** 卡片：hover 上浮 2 px、陰影升一級，radial-gradient 聚光跟隨游標（--mx／--my） */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive, tilt, padded = true, className, onPointerMove, onPointerLeave, children, ...rest },
  ref,
) {
  const local = useRef<HTMLDivElement | null>(null)
  const frame = useRef(0)
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      local.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )
  const move = (e: PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(e)
    if (!interactive || e.pointerType !== 'mouse') return
    const el = local.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty('--mx', `${x}px`)
      el.style.setProperty('--my', `${y}px`)
      if (tilt) {
        const rx = (y / r.height - 0.5) * -6
        const ry = (x / r.width - 0.5) * 6
        el.style.setProperty('--rx', `${rx.toFixed(2)}deg`)
        el.style.setProperty('--ry', `${ry.toFixed(2)}deg`)
      }
    })
  }
  const leave = (e: PointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(e)
    const el = local.current
    if (!el) return
    cancelAnimationFrame(frame.current)
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }
  return (
    <div
      ref={setRef}
      className={cn(
        'card',
        interactive && 'card-interactive',
        tilt && 'card-tilt',
        padded && 'p-5',
        className,
      )}
      onPointerMove={move}
      onPointerLeave={leave}
      {...rest}
    >
      {interactive && <span aria-hidden className="card-spotlight" />}
      {children}
    </div>
  )
})
