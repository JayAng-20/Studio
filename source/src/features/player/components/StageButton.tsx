import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  shortcut?: string
  children: ReactNode
  pressed?: boolean
  /** 不顯示 Tooltip（例如選單觸發鈕） */
  noTip?: boolean
}

/** 播放畫面上的圖示按鈕（深色玻璃上的白色圖示） */
export const StageButton = forwardRef<HTMLButtonElement, Props>(function StageButton(
  { label, shortcut, children, pressed, className, noTip, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={cn('stage-btn px-2', className)}
      {...rest}
    >
      {children}
    </button>
  )
  if (noTip) return btn
  return (
    <Tooltip content={label} shortcut={shortcut}>
      {btn}
    </Tooltip>
  )
})
