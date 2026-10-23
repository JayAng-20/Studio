import { Select as RSelect } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SelectOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  hint?: string
}

interface SelectProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: SelectOption<T>[]
  label: string
  /** 隱藏可見標籤（仍保留 aria-label） */
  hideLabel?: boolean
  className?: string
  size?: 'sm' | 'md'
  disabled?: boolean
}

/** 下拉選單 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  hideLabel,
  className,
  size = 'md',
  disabled,
}: SelectProps<T>) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      {!hideLabel && <span className="label">{label}</span>}
      <RSelect.Root value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
        <RSelect.Trigger
          aria-label={label}
          className={cn(
            'field inline-flex items-center justify-between gap-2 text-left',
            size === 'sm' && 'h-8! text-small',
            disabled && 'opacity-45',
          )}
        >
          <span className="truncate">
            <RSelect.Value />
          </span>
          <RSelect.Icon>
            <ChevronDown size={16} className="text-text-3" aria-hidden />
          </RSelect.Icon>
        </RSelect.Trigger>
        <RSelect.Portal>
          <RSelect.Content
            position="popper"
            sideOffset={6}
            className="floating z-[80] max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden p-1 data-[state=open]:animate-[pop-in_var(--dur-fast)_var(--ease-emphasized)]"
          >
            <RSelect.Viewport>
              {options.map((o) => (
                <RSelect.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  className="relative flex min-h-9 cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-8 pr-3 text-body outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
                >
                  <RSelect.ItemIndicator className="absolute left-2.5 inline-flex">
                    <Check size={14} className="text-accent-ink" aria-hidden />
                  </RSelect.ItemIndicator>
                  <div className="flex min-w-0 flex-col">
                    <RSelect.ItemText>{o.label}</RSelect.ItemText>
                    {o.hint && <span className="text-caption text-text-3">{o.hint}</span>}
                  </div>
                </RSelect.Item>
              ))}
            </RSelect.Viewport>
          </RSelect.Content>
        </RSelect.Portal>
      </RSelect.Root>
    </div>
  )
}
