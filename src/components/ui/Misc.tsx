import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** 鍵盤按鍵 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('kbd inline-block', className)}>{children}</kbd>
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
const tones: Record<BadgeTone, string> = {
  neutral: 'bg-[color-mix(in_srgb,var(--text)_7%,transparent)] text-text-2',
  accent: 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent-ink',
  success: 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-success-ink',
  warning: 'bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] text-warning-ink',
  danger: 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-danger-ink',
}

/** 小標籤 */
export function Badge({
  tone = 'neutral',
  children,
  className,
  icon,
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
  icon?: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-caption font-medium',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/** 骨架：用模組色淡化 */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('skeleton shimmer', className)} {...rest} />
}

/** 工具列 */
export function Toolbar({
  children,
  className,
  label,
}: {
  children: ReactNode
  className?: string
  label: string
}) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      {children}
    </div>
  )
}

/** 區塊標題 */
export function SectionTitle({
  children,
  className,
  action,
}: {
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-2', className)}>
      <h3 className="text-h3 font-semibold text-text">{children}</h3>
      {action}
    </div>
  )
}

/** 面板（右側設定區） */
export function Panel({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  title?: ReactNode
}) {
  return (
    <section className={cn('card flex flex-col gap-4 p-4', className)}>
      {title && <h3 className="text-h3 font-semibold">{title}</h3>}
      {children}
    </section>
  )
}

/** 欄位群組 */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-caption text-text-3">{hint}</p>}
    </div>
  )
}

/** 提示條 */
export function Callout({
  tone = 'accent',
  icon,
  title,
  children,
  className,
  action,
}: {
  tone?: BadgeTone
  icon?: ReactNode
  title?: ReactNode
  children?: ReactNode
  className?: string
  action?: ReactNode
}) {
  const border: Record<BadgeTone, string> = {
    neutral: 'border-border',
    accent: 'border-[color-mix(in_srgb,var(--accent)_30%,transparent)]',
    success: 'border-[color-mix(in_srgb,var(--success)_30%,transparent)]',
    warning: 'border-[color-mix(in_srgb,var(--warning)_35%,transparent)]',
    danger: 'border-[color-mix(in_srgb,var(--danger)_30%,transparent)]',
  }
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'note'}
      className={cn(
        'flex items-start gap-3 rounded-md border px-3.5 py-3 text-small',
        tones[tone].replace(/text-\S+/, ''),
        border[tone],
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            'mt-0.5 shrink-0',
            tones[tone].split(' ').find((c) => c.startsWith('text-')),
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1 text-text">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-text-2">{children}</div>}
      </div>
      {action}
    </div>
  )
}
