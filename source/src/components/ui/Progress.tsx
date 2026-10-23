import { motion, useSpring, useTransform } from 'motion/react'
import { useEffect } from 'react'
import { cn } from '@/lib/cn'
import { spring } from '@/design/motion'
import { useT } from '@/i18n'

interface ProgressProps {
  /** 0 到 1；null 表示不確定 */
  value: number | null
  className?: string
  label?: string
  tone?: 'accent' | 'success' | 'danger'
  size?: 'sm' | 'md'
}

const toneVar = { accent: 'var(--accent)', success: 'var(--success)', danger: 'var(--danger)' }

/** 進度條：確定進度平滑插值，不確定進度 shimmer */
export function ProgressBar({
  value,
  className,
  label,
  tone = 'accent',
  size = 'md',
}: ProgressProps) {
  const t = useT()
  const sv = useSpring(value ?? 0, spring.smooth)
  useEffect(() => {
    if (value !== null) sv.set(value)
  }, [value, sv])
  const scaleX = useTransform(sv, (v) => Math.max(0, Math.min(1, v)))
  const pct = value === null ? undefined : Math.round(value * 100)
  return (
    <div
      role="progressbar"
      aria-label={label ?? t('a11y.progress')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_8%,transparent)]',
        size === 'sm' ? 'h-1' : 'h-1.5',
        className,
      )}
    >
      {value === null ? (
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="motion-decor absolute inset-y-0 w-1/3 rounded-full"
            style={{
              background: `linear-gradient(90deg, transparent, ${toneVar[tone]}, transparent)`,
              animation: 'shimmer 1.2s var(--ease-standard) infinite',
              width: '100%',
            }}
          />
        </div>
      ) : (
        <motion.div
          className="absolute inset-0 origin-left rounded-full"
          style={{
            scaleX,
            background: `linear-gradient(90deg, var(--accent-2), ${toneVar[tone]})`,
          }}
        />
      )}
    </div>
  )
}

/** 環形進度 */
export function ProgressRing({
  value,
  size = 28,
  stroke = 3,
  className,
  label,
  tone = 'accent',
}: Omit<ProgressProps, 'size'> & { size?: number; stroke?: number }) {
  const t = useT()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const sv = useSpring(value ?? 0.25, spring.smooth)
  useEffect(() => {
    if (value !== null) sv.set(value)
  }, [value, sv])
  const offset = useTransform(sv, (v) => c * (1 - Math.max(0, Math.min(1, v))))
  return (
    <span
      role="progressbar"
      aria-label={label ?? t('a11y.progress')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      className={cn('inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={
          value === null
            ? { animation: 'spin 1s linear infinite' }
            : { transform: 'rotate(-90deg)' }
        }
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="color-mix(in srgb, var(--text) 10%, transparent)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={toneVar[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          style={{ strokeDashoffset: value === null ? c * 0.7 : offset }}
        />
      </svg>
    </span>
  )
}
