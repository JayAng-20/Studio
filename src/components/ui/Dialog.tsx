import { Dialog as RDialog } from 'radix-ui'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { duration, sec, spring, scale } from '@/design/motion'
import { useT } from '@/i18n'

interface DialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg'
  /** 隱藏標題（仍提供給螢幕閱讀器） */
  hideTitle?: boolean
  hideClose?: boolean
}

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

/** 對話框：背景模糊淡入＋內容 scale .96 → 1 彈簧；焦點鎖定、Esc 關閉 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  size = 'md',
  hideTitle,
  hideClose,
}: DialogProps) {
  const t = useT()
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[70] bg-[rgba(10,12,16,.38)] backdrop-blur-[6px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: sec(duration.base) }}
              />
            </RDialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-[71] grid place-items-center p-4">
              <RDialog.Content
                asChild
                forceMount
                aria-describedby={description ? undefined : undefined}
              >
                <motion.div
                  className={cn(
                    'floating pointer-events-auto relative flex max-h-[min(88dvh,820px)] w-full flex-col overflow-hidden',
                    widths[size],
                    className,
                  )}
                  initial={{ opacity: 0, scale: scale.dialogFrom, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    scale: scale.dialogFrom,
                    y: 4,
                    transition: { duration: sec(duration.fast) },
                  }}
                  transition={spring.smooth}
                >
                  <div className={cn('flex items-start gap-3 px-6 pt-5', hideTitle && 'sr-only')}>
                    <div className="min-w-0 flex-1">
                      <RDialog.Title className="text-h2 font-semibold text-text">
                        {title}
                      </RDialog.Title>
                      {description && (
                        <RDialog.Description className="mt-1 text-body text-text-2">
                          {description}
                        </RDialog.Description>
                      )}
                    </div>
                  </div>
                  {!description && (
                    <RDialog.Description className="sr-only">
                      {typeof title === 'string' ? title : ''}
                    </RDialog.Description>
                  )}
                  {!hideClose && (
                    <RDialog.Close
                      aria-label={t('common.close')}
                      className="absolute right-3 top-3 grid size-9 place-items-center rounded-md text-text-3 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-text"
                    >
                      <X size={18} aria-hidden />
                    </RDialog.Close>
                  )}
                  {children && (
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
                  )}
                  {footer && (
                    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
                      {footer}
                    </div>
                  )}
                </motion.div>
              </RDialog.Content>
            </div>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  )
}

/** 確認對話框 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  danger,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: string
  confirmLabel: string
  onConfirm: () => void
  danger?: boolean
}) {
  const t = useT()
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <RDialog.Close asChild>
            <button
              type="button"
              className="h-10 rounded-md border border-border-strong bg-surface px-4 font-medium hover:bg-surface-2"
            >
              {t('common.cancel')}
            </button>
          </RDialog.Close>
          <button
            type="button"
            autoFocus
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
            className={cn(
              'h-10 rounded-md px-4 font-medium text-white',
              danger ? 'bg-danger' : 'bg-accent-strong',
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  )
}
