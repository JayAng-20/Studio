import { AnimatePresence, motion } from 'motion/react'
import { Check } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Sheet } from '@/components/ui'
import { duration, sec, spring } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useIsMobile } from '@/lib/useMedia'
import { usePlayer } from '../store'
import { StageButton } from './StageButton'

export interface StageMenuItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  hint?: string
  checked?: boolean
  disabled?: boolean
  onSelect: () => void
  /** 選取後不關閉選單 */
  keepOpen?: boolean
}

/**
 * 播放畫面內的選單（不 portal 到 body，全螢幕時才看得到）。
 * 開啟時控制列不會自動隱藏；Esc、點外面關閉；方向鍵移動焦點。
 */
export function StageMenu({
  label,
  trigger,
  items,
  radio,
  className,
  triggerClassName,
  title,
  numeric,
}: {
  label: string
  trigger: ReactNode
  items: StageMenuItem[]
  radio?: boolean
  className?: string
  triggerClassName?: string
  title?: ReactNode
  /** 選項是數值（速度）：使用等寬數字 */
  numeric?: boolean
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const isMobile = useIsMobile()
  const fullscreen = usePlayer((s) => s.fullscreen)
  // 手機（非全螢幕）改用底部抽屜：選項多時比擠在矮小的畫面裡好按
  const asSheet = isMobile && !fullscreen
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    usePlayer.getState().set({ menuOpen: open })
    if (!open || asSheet) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    const focusId = requestAnimationFrame(() => {
      const items = menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role^="menuitem"]:not(:disabled)',
      )
      const checked = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ;(checked ?? items?.[0])?.focus()
    })
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      cancelAnimationFrame(focusId)
    }
  }, [open, asSheet])

  useEffect(() => () => usePlayer.getState().set({ menuOpen: false }), [])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      btn.current?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    e.stopPropagation()
    const list = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [],
    )
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    const nextI =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? list.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
    list[nextI]?.focus()
  }

  return (
    <div ref={wrap} className={cn('relative', className)}>
      <StageButton
        ref={btn}
        label={label}
        noTip={open}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={triggerClassName}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          }
        }}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </StageButton>
      {asSheet && (
        <Sheet open={open} onOpenChange={setOpen} title={label}>
          <div role="menu" aria-label={label} className="flex flex-col gap-0.5 pb-3">
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                role={
                  radio
                    ? 'menuitemradio'
                    : it.checked !== undefined
                      ? 'menuitemcheckbox'
                      : 'menuitem'
                }
                aria-checked={radio || it.checked !== undefined ? !!it.checked : undefined}
                disabled={it.disabled}
                onClick={() => {
                  it.onSelect()
                  if (!it.keepOpen) setOpen(false)
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-body text-text transition-colors hover:bg-surface-2 disabled:opacity-40"
              >
                <span className="grid w-5 shrink-0 place-items-center text-text-2">
                  {it.checked ? (
                    <Check size={16} aria-hidden className="text-accent-ink" />
                  ) : (
                    it.icon
                  )}
                </span>
                <span className={cn('min-w-0 flex-1 truncate', numeric && 'tabular-nums')}>
                  {it.label}
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      <AnimatePresence>
        {open && !asSheet && (
          <motion.div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label}
            onKeyDown={onKey}
            className="stage-glass absolute bottom-full right-0 z-40 mb-10 max-h-[min(calc(100cqh-var(--controls-h)-24px),420px)] min-w-[200px] overflow-y-auto rounded-lg p-1"
            style={{ transformOrigin: 'bottom right' }}
            initial={{ opacity: 0, scale: 0.94, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4, transition: { duration: sec(duration.fast) } }}
            transition={spring.snappy}
          >
            {title && (
              <div className="px-2.5 pb-1 pt-1.5 text-caption font-semibold text-[var(--stage-fg-2)]">
                {title}
              </div>
            )}
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                role={
                  radio
                    ? 'menuitemradio'
                    : it.checked !== undefined
                      ? 'menuitemcheckbox'
                      : 'menuitem'
                }
                aria-checked={radio || it.checked !== undefined ? !!it.checked : undefined}
                disabled={it.disabled}
                onClick={() => {
                  it.onSelect()
                  if (!it.keepOpen) {
                    setOpen(false)
                    btn.current?.focus()
                  }
                }}
                className="flex min-h-9 w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-body text-[var(--stage-fg)] outline-none transition-colors hover:bg-[var(--stage-hover)] focus-visible:bg-[var(--stage-hover)] disabled:opacity-40 pointer-coarse:min-h-11"
              >
                <span className="grid w-4 shrink-0 place-items-center">
                  {it.checked ? (
                    <Check
                      size={15}
                      aria-hidden
                      className="text-[color-mix(in_srgb,var(--accent)_55%,white)]"
                    />
                  ) : (
                    it.icon
                  )}
                </span>
                <span className={cn('min-w-0 flex-1 truncate', numeric && 'tabular-nums')}>
                  {it.label}
                </span>
                {it.hint && (
                  <kbd className="rounded-xs border border-[var(--stage-glass-border)] px-1.5 text-[11px] text-[var(--stage-fg-2)]">
                    {it.hint}
                  </kbd>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
