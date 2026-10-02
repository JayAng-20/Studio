import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Slot } from 'radix-ui'
import { WindmillSpinner } from '@/design/Logo'
import { duration, sec, spring } from '@/design/motion'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** 純圖示按鈕（正方形）；必須同時提供 aria-label */
  icon?: boolean
  leading?: ReactNode
  trailing?: ReactNode
  asChild?: boolean
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-small gap-1.5 rounded-sm',
  md: 'h-10 px-4 text-body gap-2 rounded-md',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-lg font-semibold',
}
const iconSizes: Record<ButtonSize, string> = {
  sm: 'size-8 rounded-sm',
  md: 'size-10 rounded-md',
  lg: 'size-12 rounded-lg',
}

const variants: Record<ButtonVariant, string> = {
  primary:
    'btn-primary text-on-accent bg-accent-strong shadow-[0_1px_0_rgba(255,255,255,.18)_inset,0_6px_16px_-6px_color-mix(in_srgb,var(--accent)_70%,transparent)]',
  secondary: 'bg-surface text-text border border-border-strong shadow-e1 hover:bg-surface-2',
  outline: 'bg-transparent text-text border border-border-strong hover:bg-surface-2',
  ghost:
    'bg-transparent text-text-2 hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-text',
  danger: 'bg-danger text-white shadow-[0_1px_0_rgba(255,255,255,.18)_inset] hover:brightness-110',
}

/**
 * 按鈕：按下 scale .97（snappy）；primary hover 時斜向光澤掃過；
 * 載入中時文字淡出、風車彈入，寬度不變。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading,
    icon,
    leading,
    trailing,
    className,
    children,
    disabled,
    asChild,
    type,
    ...rest
  },
  ref,
) {
  const classes = cn(
    'relative inline-flex items-center justify-center whitespace-nowrap font-medium select-none overflow-hidden',
    'transition-[background-color,color,box-shadow,filter,opacity] duration-(--dur-fast) ease-standard',
    'disabled:opacity-45 disabled:shadow-none aria-disabled:opacity-45',
    icon ? iconSizes[size] : sizes[size],
    variants[variant],
    className,
  )
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...rest}>
        {children}
      </Slot.Root>
    )
  }
  return (
    <motion.button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      transition={spring.snappy}
      {...(rest as object)}
    >
      {variant === 'primary' && <span aria-hidden className="btn-sheen" />}
      <span
        className={cn(
          'inline-flex items-center justify-center gap-[inherit] transition-opacity duration-(--dur-fast)',
          loading && 'opacity-0',
        )}
      >
        {leading}
        {children}
        {trailing}
      </span>
      <AnimatePresence>
        {loading && (
          <motion.span
            className="absolute inset-0 grid place-items-center"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ ...spring.bouncy, opacity: { duration: sec(duration.fast) } }}
          >
            <WindmillSpinner size={size === 'lg' ? 22 : 18} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  )
})
