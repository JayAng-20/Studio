import { Tooltip as RTooltip } from 'radix-ui'
import type { ReactNode } from 'react'
import { timing } from '@/design/motion'
import { cn } from '@/lib/cn'

/** 全站共用 Provider：首次延遲 400 ms，連續移動到下一個時立即顯示 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={timing.tooltipDelay} skipDelayDuration={500}>
      {children}
    </RTooltip.Provider>
  )
}

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  disabled?: boolean
  shortcut?: string
  className?: string
}

export function Tooltip({
  content,
  children,
  side = 'top',
  disabled,
  shortcut,
  className,
}: TooltipProps) {
  if (disabled) return <>{children}</>
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={8}
          collisionPadding={8}
          className={cn(
            'tooltip-content z-[90] flex max-w-xs items-center gap-2 rounded-sm bg-[color-mix(in_srgb,var(--text)_92%,transparent)] px-2.5 py-1.5 text-caption text-bg shadow-e3',
            className,
          )}
        >
          {content}
          {shortcut && (
            <span className="rounded-xs bg-white/15 px-1.5 text-[11px] font-medium">
              {shortcut}
            </span>
          )}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}
