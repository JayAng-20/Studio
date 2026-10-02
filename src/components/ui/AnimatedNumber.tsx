import { useEffect, useRef } from 'react'
import { useSpring, useMotionValueEvent } from 'motion/react'
import { spring } from '@/design/motion'
import { useSettings } from '@/stores/settings'

/** 數字以彈簧滾動計數；format 決定顯示方式 */
export function AnimatedNumber({
  value,
  format = (v) => String(Math.round(v)),
  className,
}: {
  value: number
  format?: (v: number) => string
  className?: string
}) {
  const motionPref = useSettings((s) => s.motion)
  const sv = useSpring(value, spring.gentle)
  const ref = useRef<HTMLSpanElement>(null)
  const fmt = useRef(format)
  useEffect(() => {
    fmt.current = format
  })
  useEffect(() => {
    if (motionPref === 'full') sv.set(value)
    else sv.jump(value)
  }, [value, sv, motionPref])
  useMotionValueEvent(sv, 'change', (v) => {
    if (ref.current) ref.current.textContent = fmt.current(v)
  })
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {format(value)}
    </span>
  )
}
