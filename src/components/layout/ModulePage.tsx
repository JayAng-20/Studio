import { motion } from 'motion/react'
import { createPortal } from 'react-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { moduleById, type ModuleId } from '@/config/modules'
import { IconTile } from '@/components/ui'
import { useRecents } from '@/stores/recents'
import { spring } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'

/**
 * 模組頁共用骨架：頁首（圖示方塊＋名稱＋一行說明）→ 工作區。
 * 圖示方塊與標題與首頁卡片共用 layoutId，做 shared element 轉場。
 */
export function ModulePage({
  module,
  children,
  status,
  className,
  wide,
}: {
  module: ModuleId
  children: ReactNode
  status?: ReactNode
  className?: string
  wide?: boolean
}) {
  const t = useT()
  const m = moduleById[module]
  const visit = useRecents((s) => s.visit)
  useEffect(() => {
    visit(module)
  }, [module, visit])
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 pb-28 pt-6 sm:px-6 sm:pb-16 lg:px-8 lg:pt-8',
        wide ? 'max-w-[1440px]' : 'max-w-[var(--content-max)]',
        className,
      )}
    >
      <header className="mb-6 flex flex-wrap items-center gap-4 lg:mb-8">
        <IconTile module={module} size="lg" layoutId={`tile-${module}`} />
        {/* 標題至少保留 16rem；空間不夠時狀態（步驟指示）換到下一行，不擠壓標題 */}
        <div className="min-w-0 flex-1 basis-[16rem]">
          <motion.h1
            layoutId={`title-${module}`}
            transition={spring.smooth}
            className="w-fit text-h1 font-semibold tracking-[-0.01em]"
          >
            {t(m.nameKey)}
          </motion.h1>
          <p className="mt-0.5 text-body text-text-2">{t(m.descKey)}</p>
        </div>
        {status && <div className="flex max-w-full shrink-0 items-center gap-2">{status}</div>}
      </header>
      {children}
    </div>
  )
}

/** 工作區：左側主區（彈性寬）＋右側面板（320 px、sticky）；< 1024 時面板移到下方 */
export function Workspace({
  main,
  panel,
  className,
}: {
  main: ReactNode
  panel?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid items-start gap-5 lg:gap-6',
        panel && 'lg:grid-cols-[minmax(0,1fr)_var(--panel-w)]',
        className,
      )}
    >
      <div className="min-w-0">{main}</div>
      {panel && (
        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--topbar-h)+16px)]">
          {panel}
        </aside>
      )}
    </div>
  )
}

/** 把模組專屬動作放到頂欄右側 */
export function TopBarActions({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(() => document.getElementById('topbar-actions'))
  useEffect(() => {
    if (el) return
    const id = requestAnimationFrame(() => setEl(document.getElementById('topbar-actions')))
    return () => cancelAnimationFrame(id)
  }, [el])
  return el ? createPortal(children, el) : null
}

/** 工作區狀態切換容器：同一個容器的 layout 動畫，而不是硬切換畫面 */
export function StageContainer({
  stage,
  children,
  className,
}: {
  stage: string
  children: ReactNode
  className?: string
}) {
  return (
    <motion.div
      layout
      transition={spring.smooth}
      className={cn('relative', className)}
      data-stage={stage}
    >
      <motion.div
        key={stage}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.smooth}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
