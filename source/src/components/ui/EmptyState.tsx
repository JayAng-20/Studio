import type { ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { useT } from '@/i18n'

/** 空狀態 */
export function EmptyState({
  illustration,
  title,
  description,
  action,
  className,
}: {
  illustration?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}
    >
      {illustration && <div className="mb-5">{illustration}</div>}
      <h3 className="text-h3 font-semibold text-text">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-body text-text-2">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

/** 錯誤狀態：說明發生什麼事、可以怎麼辦 */
export function ErrorState({
  title,
  description,
  onRetry,
  className,
  retryLabel,
}: {
  title?: ReactNode
  description?: ReactNode
  onRetry?: () => void
  className?: string
  retryLabel?: string
}) {
  const t = useT()
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}
    >
      <span className="mb-4 grid size-12 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger-ink">
        <AlertTriangle size={24} aria-hidden />
      </span>
      <h3 className="text-h3 font-semibold">{title ?? t('errors.generic')}</h3>
      <p className="mt-1.5 max-w-sm text-body text-text-2">
        {description ?? t('errors.genericDesc')}
      </p>
      {onRetry && (
        <Button
          className="mt-5"
          variant="secondary"
          leading={<RotateCcw size={16} aria-hidden />}
          onClick={onRetry}
        >
          {retryLabel ?? t('common.retry')}
        </Button>
      )}
    </div>
  )
}
