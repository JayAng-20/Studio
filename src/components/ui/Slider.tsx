import { Slider as RSlider } from 'radix-ui'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { spring } from '@/design/motion'

interface SliderProps {
  value: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  format?: (v: number) => string
  disabled?: boolean
  className?: string
  /** 超過此值以警示色顯示（例如音量 > 100%） */
  warnAbove?: number
}

/** 滑桿：拖曳時把手放大、數值氣泡浮現 */
export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  label,
  format = String,
  disabled,
  className,
  warnAbove,
}: SliderProps) {
  const [active, setActive] = useState(false)
  const warn = warnAbove !== undefined && value > warnAbove
  return (
    <RSlider.Root
      className={cn(
        'relative flex h-6 w-full touch-none select-none items-center',
        disabled && 'opacity-45',
        className,
      )}
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={([v]) => onChange(v)}
      onValueCommit={([v]) => onCommit?.(v)}
      onPointerDown={() => setActive(true)}
      onPointerUp={() => setActive(false)}
      onPointerCancel={() => setActive(false)}
      onBlur={() => setActive(false)}
    >
      <RSlider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)]">
        <RSlider.Range
          className="absolute h-full rounded-full"
          style={{
            background: warn
              ? 'linear-gradient(90deg, var(--accent), var(--warning))'
              : 'linear-gradient(90deg, var(--accent-2), var(--accent))',
          }}
        />
      </RSlider.Track>
      <RSlider.Thumb
        aria-label={label}
        aria-valuetext={format(value)}
        className="group relative block size-5 rounded-full border border-border-strong bg-white shadow-e2 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        onKeyDown={() => setActive(false)}
      >
        <motion.span
          aria-hidden
          className="absolute inset-[5px] rounded-full"
          style={{ background: warn ? 'var(--warning)' : 'var(--accent)' }}
          animate={{ scale: active ? 1.25 : 1 }}
          transition={spring.snappy}
        />
        <AnimatePresence>
          {active && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-text px-2 py-0.5 text-caption text-bg shadow-e2"
              initial={{ opacity: 0, y: 6, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.9 }}
              transition={spring.snappy}
            >
              {format(value)}
            </motion.span>
          )}
        </AnimatePresence>
      </RSlider.Thumb>
    </RSlider.Root>
  )
}

/** 帶標題與數值的滑桿列 */
export function SliderField(props: SliderProps & { hint?: string }) {
  const { label, value, format = String, hint, warnAbove } = props
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-small font-medium text-text-2">{label}</span>
        <span
          className={cn(
            'text-small tabular-nums',
            warnAbove !== undefined && value > warnAbove ? 'text-warning-ink' : 'text-text',
          )}
        >
          {format(value)}
        </span>
      </div>
      <Slider {...props} />
      {hint && <p className="text-caption text-text-3">{hint}</p>}
    </div>
  )
}
