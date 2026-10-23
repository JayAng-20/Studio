import { Slider as RSlider } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'

interface RangeSliderProps {
  value: [number, number]
  onChange: (v: [number, number]) => void
  onCommit?: (v: [number, number]) => void
  min?: number
  max: number
  step?: number
  minGap?: number
  format?: (v: number) => string
  className?: string
  /** 疊在軌道底下的內容（例如縮圖膠卷） */
  children?: ReactNode
  /** 軌道高度 */
  trackHeight?: number
  labels?: [string, string]
}

/** 雙把手範圍選取（時間區間）；鍵盤方向鍵以 step 微調 */
export function RangeSlider({
  value,
  onChange,
  onCommit,
  min = 0,
  max,
  step = 0.1,
  minGap = 0,
  format = (v) => v.toFixed(1),
  className,
  children,
  trackHeight = 8,
  labels,
}: RangeSliderProps) {
  const t = useT()
  const names = labels ?? [t('a11y.rangeStart'), t('a11y.rangeEnd')]
  const span = Math.max(max - min, 1e-6)
  const left = ((value[0] - min) / span) * 100
  const right = ((value[1] - min) / span) * 100
  return (
    <RSlider.Root
      className={cn('relative flex w-full touch-none select-none items-center', className)}
      style={{ height: Math.max(trackHeight, 24) }}
      value={value}
      min={min}
      max={max}
      step={step}
      minStepsBetweenThumbs={Math.round(minGap / step)}
      onValueChange={(v) => onChange([v[0], v[1]])}
      onValueCommit={(v) => onCommit?.([v[0], v[1]])}
    >
      <RSlider.Track
        className="relative grow overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
        style={{ height: trackHeight }}
      >
        {children}
        {/* 區間外變暗 */}
        <span
          className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--bg)_65%,transparent)]"
          style={{ width: `${left}%` }}
        />
        <span
          className="absolute inset-y-0 right-0 bg-[color-mix(in_srgb,var(--bg)_65%,transparent)]"
          style={{ width: `${100 - right}%` }}
        />
        <RSlider.Range
          className={cn('absolute inset-y-0', children ? 'border-y-2 border-accent' : 'bg-accent')}
        />
      </RSlider.Track>
      {[0, 1].map((i) => (
        <RSlider.Thumb
          key={i}
          aria-label={names[i]}
          aria-valuetext={format(value[i])}
          className="block outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          style={{
            width: 14,
            height: Math.max(trackHeight + 8, 24),
            borderRadius: 6,
            background: 'var(--accent)',
            boxShadow: 'var(--e2), inset 0 1px 0 rgba(255,255,255,.3)',
          }}
        >
          <span
            aria-hidden
            className="mx-auto mt-[35%] block h-[30%] w-[2px] rounded bg-white/80"
          />
        </RSlider.Thumb>
      ))}
    </RSlider.Root>
  )
}
