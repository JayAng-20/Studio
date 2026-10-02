import { DropdownMenu } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface MenuItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

/** 下拉選單（傳送到…、更多動作） */
export function Menu({
  trigger,
  items,
  label,
  align = 'end',
}: {
  trigger: ReactNode
  items: MenuItem[]
  label?: string
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
          className="menu-content floating z-[80] min-w-[200px] p-1"
        >
          {items.map((it) => (
            <DropdownMenu.Item
              key={it.key}
              disabled={it.disabled}
              onSelect={it.onSelect}
              className={cn(
                'flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-body outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]',
                it.danger && 'text-danger-ink',
              )}
            >
              {it.icon}
              {it.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
