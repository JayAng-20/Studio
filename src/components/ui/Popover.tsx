import { Popover as RPopover } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface PopoverProps {
  trigger: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
  open?: boolean
  onOpenChange?: (o: boolean) => void
  label?: string
}

/** 彈出層：進出場縮放＋淡入 */
export function Popover({
  trigger,
  children,
  side = 'bottom',
  align = 'center',
  className,
  open,
  onOpenChange,
  label,
}: PopoverProps) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          aria-label={label}
          className={cn('popover-content floating z-[80] p-3 outline-none', className)}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  )
}

export const PopoverClose = RPopover.Close
