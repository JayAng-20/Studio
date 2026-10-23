import { motion, LayoutGroup } from 'motion/react'
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { spring } from '@/design/motion'

/** 多欄格狀的單選（radiogroup）：選取底色以 layout 彈簧滑動；方向鍵切換 */
export function ChipGrid<T extends string | number>({
  value,
  onChange,
  options,
  label,
  columns = 4,
  disabled,
}: {
  value: T | null
  onChange: (v: T) => void
  options: Array<{ value: T; label: ReactNode }>
  label: string
  columns?: number
  disabled?: boolean
}) {
  const id = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const onKey = (e: KeyboardEvent, i: number) => {
    const delta: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    }
    const d = delta[e.key]
    if (!d) return
    e.preventDefault()
    const j = (i + d + options.length) % options.length
    onChange(options[j].value)
    refs.current[j]?.focus()
  }
  return (
    <LayoutGroup id={id}>
      <div
        role="radiogroup"
        aria-label={label}
        aria-disabled={disabled || undefined}
        className={cn(
          'grid gap-1 rounded-md bg-[color-mix(in_srgb,var(--text)_6%,transparent)] p-0.5',
          disabled && 'opacity-45',
        )}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {options.map((o, i) => {
          const selected = o.value === value
          return (
            <button
              key={String(o.value)}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={
                selected || (i === current && !options.some((x) => x.value === value)) ? 0 : -1
              }
              disabled={disabled}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'relative z-0 inline-flex h-8 items-center justify-center whitespace-nowrap rounded-[calc(var(--radius-md)-2px)] px-1 text-small font-medium tabular-nums transition-colors duration-(--dur-fast)',
                selected ? 'text-text' : 'text-text-2 hover:text-text',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="chip-pill"
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
