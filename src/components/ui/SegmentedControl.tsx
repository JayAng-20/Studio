import { motion, LayoutGroup } from 'motion/react'
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { spring } from '@/design/motion'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  title?: string
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: SegmentOption<T>[]
  label: string
  size?: 'sm' | 'md'
  className?: string
  full?: boolean
}

/** 分段選擇：選取指示以 layout 彈簧滑動；方向鍵切換（radiogroup） */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
  full,
}: SegmentedProps<T>) {
  const id = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!dir) return
    e.preventDefault()
    for (let k = 1; k <= options.length; k++) {
      const j = (i + dir * k + options.length) % options.length
      if (!options[j].disabled) {
        onChange(options[j].value)
        refs.current[j]?.focus()
        break
      }
    }
  }
  return (
    <LayoutGroup id={id}>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn(
          'relative inline-flex rounded-md bg-[color-mix(in_srgb,var(--text)_6%,transparent)] p-0.5',
          full && 'flex w-full',
          className,
        )}
      >
        {options.map((o, i) => {
          const selected = o.value === value
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={o.disabled}
              title={o.title}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'relative z-0 inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[calc(var(--radius-md)-2px)] font-medium transition-colors duration-(--dur-fast)',
                size === 'sm' ? 'h-7 px-2.5 text-caption' : 'h-8 px-3 text-small',
                selected ? 'text-text' : 'text-text-2 hover:text-text',
                o.disabled && 'opacity-40',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="seg-pill"
                  className="absolute inset-0 -z-10 rounded-[inherit] bg-surface shadow-e1 dark:bg-surface-3"
                  transition={spring.snappy}
                />
              )}
              {o.label}
            </button>
          )
        })}
      </div>
    </LayoutGroup>
  )
}
