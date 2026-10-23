import { Minus, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/cn'
import { clamp } from '@/lib/format'
import { useT } from '@/i18n'

interface NumberFieldProps {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  hideLabel?: boolean
  suffix?: string
  className?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}

/** 數字欄位（含步進按鈕）；輸入時暫存文字，失焦或 Enter 才寫回 */
export function NumberField({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  label,
  hideLabel,
  suffix,
  className,
  disabled,
  size = 'md',
}: NumberFieldProps) {
  const t = useT()
  const id = useId()
  const [text, setText] = useState(String(value))
  const [invalid, setInvalid] = useState(false)
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setText(String(value))
  }
  const commit = (raw: string) => {
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n)) {
      setInvalid(true)
      setText(String(value))
      setTimeout(() => setInvalid(false), 400)
      return
    }
    const v = clamp(n, min, max)
    setText(String(v))
    if (v !== value) onChange(v)
  }
  const bump = (d: number) => {
    const precision = (String(step).split('.')[1] || '').length
    onChange(Number(clamp(value + d * step, min, max).toFixed(precision)))
  }
  const h = size === 'sm' ? 'h-8' : 'h-10'
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      {!hideLabel && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      <div
        className={cn(
          'field flex items-center gap-0 p-0! overflow-hidden focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)]',
          h,
          invalid && 'shake',
          disabled && 'opacity-45',
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('common.decrement')}
          disabled={disabled || value <= min}
          onClick={() => bump(-1)}
          className={cn(
            'grid place-items-center text-text-3 hover:text-text disabled:opacity-30',
            size === 'sm' ? 'w-7' : 'w-9',
            h,
          )}
        >
          <Minus size={14} aria-hidden />
        </button>
        <input
          id={id}
          aria-label={hideLabel ? label : undefined}
          aria-invalid={invalid || undefined}
          inputMode="decimal"
          type="text"
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              bump(1)
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              bump(-1)
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-center tabular-nums outline-none"
        />
        {suffix && <span className="pr-1 text-small text-text-3">{suffix}</span>}
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('common.increment')}
          disabled={disabled || value >= max}
          onClick={() => bump(1)}
          className={cn(
            'grid place-items-center text-text-3 hover:text-text disabled:opacity-30',
            size === 'sm' ? 'w-7' : 'w-9',
            h,
          )}
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>
    </div>
  )
}
