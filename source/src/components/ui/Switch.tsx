import { Switch as RSwitch } from 'radix-ui'
import { motion } from 'motion/react'
import { useId } from 'react'
import { cn } from '@/lib/cn'
import { spring } from '@/design/motion'

interface SwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
  className?: string
  /** 只有開關本體（外部自行提供標籤時，需給 aria-label） */
  ariaLabel?: string
}

/** 開關：彈簧移動 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
  ariaLabel,
}: SwitchProps) {
  const id = useId()
  const sw = (
    <RSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={description ? `${id}-d` : undefined}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-(--dur-fast)',
        checked ? 'bg-accent' : 'bg-[color-mix(in_srgb,var(--text)_18%,transparent)]',
        disabled && 'opacity-45',
      )}
    >
      <RSwitch.Thumb asChild>
        <motion.span
          className="block size-5 rounded-full bg-white shadow-e2"
          animate={{ x: checked ? 16 : 0 }}
          transition={spring.snappy}
        />
      </RSwitch.Thumb>
    </RSwitch.Root>
  )
  if (!label) return sw
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="block text-body font-medium text-text">
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="text-small text-text-3">
            {description}
          </p>
        )}
      </div>
      {sw}
    </div>
  )
}
