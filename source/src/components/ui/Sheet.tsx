import { Drawer } from 'vaul'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface SheetProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
  hideTitle?: boolean
}

/** 手機底部抽屜：從底部滑入，可下拉關閉 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  hideTitle,
}: SheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[70] bg-[rgba(10,12,16,.38)] backdrop-blur-[4px]" />
        <Drawer.Content
          className={cn(
            'glass fixed inset-x-0 bottom-0 z-[71] mt-24 flex max-h-[88dvh] flex-col rounded-t-2xl pb-[max(16px,env(safe-area-inset-bottom))] outline-none',
            className,
          )}
          style={{ background: 'color-mix(in srgb, var(--surface) 92%, transparent)' }}
        >
          <div
            aria-hidden
            className="mx-auto mt-2.5 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--text)_20%,transparent)]"
          />
          <div className={cn('px-5 pt-2 pb-2', hideTitle && 'sr-only')}>
            <Drawer.Title className="text-h3 font-semibold">{title}</Drawer.Title>
            {description ? (
              <Drawer.Description className="text-small text-text-2">
                {description}
              </Drawer.Description>
            ) : (
              <Drawer.Description className="sr-only">
                {typeof title === 'string' ? title : ''}
              </Drawer.Description>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
