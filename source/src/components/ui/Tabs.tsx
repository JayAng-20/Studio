import { Tabs as RTabs } from 'radix-ui'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { duration, easing, offset, sec, spring } from '@/design/motion'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

interface TabsProps<T extends string> {
  value: T
  onChange: (v: T) => void
  items: TabItem<T>[]
  label: string
  className?: string
  listClassName?: string
  children?: ReactNode
  /** 內容切換時交叉淡化並位移 */
  animated?: boolean
  fullWidth?: boolean
  /** 只用分頁列時，外部面板的 id（供 aria-controls） */
  panelId?: string
}

/** 分頁：滑動底線；內容交叉淡化並位移 8 px */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
  listClassName,
  children,
  animated = true,
  fullWidth,
  panelId,
}: TabsProps<T>) {
  const id = useId()
  return (
    <RTabs.Root value={value} onValueChange={(v) => onChange(v as T)} className={className}>
      <LayoutGroup id={id}>
        <RTabs.List
          aria-label={label}
          className={cn('relative flex gap-1 border-b border-border', listClassName)}
        >
          {items.map((it) => (
            <RTabs.Trigger
              key={it.value}
              value={it.value}
              disabled={it.disabled}
              // 只用分頁列（內容由外部渲染）時，不指向不存在的面板
              aria-controls={children ? undefined : (panelId ?? undefined)}
              className={cn(
                'relative -mb-px inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-body font-medium transition-colors duration-(--dur-fast)',
                'text-text-2 hover:text-text data-[state=active]:text-text disabled:opacity-40',
                fullWidth && 'flex-1',
              )}
            >
              {it.label}
              {it.value === value && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent"
                  transition={spring.snappy}
                />
              )}
            </RTabs.Trigger>
          ))}
        </RTabs.List>
      </LayoutGroup>
      {children &&
        (animated ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={value}
              initial={{ opacity: 0, x: offset.panel }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -offset.panel }}
              transition={{ duration: sec(duration.fast), ease: easing.standard }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        ) : (
          children
        ))}
    </RTabs.Root>
  )
}

/** 搭配 Tabs 使用：只渲染目前的面板內容 */
export function TabPanel({
  value,
  children,
  className,
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  return (
    <RTabs.Content value={value} className={cn('outline-none', className)} forceMount={undefined}>
      {children}
    </RTabs.Content>
  )
}
