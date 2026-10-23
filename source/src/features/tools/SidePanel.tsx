/**
 * 右側分頁面板。切換分頁時內容交叉淡化並位移 8 px。
 * 桌機：分頁列在面板頂端；< 1024 px：分頁列跟著畫布黏在上方（TabStrip），面板只放內容。
 */
import { AnimatePresence, motion } from 'motion/react'
import {
  Crop,
  EyeOff,
  Gauge,
  Info,
  Pipette,
  SlidersHorizontal,
  Stamp,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, type ComponentType } from 'react'
import { Tabs } from '@/components/ui'
import { duration, easing, offset, sec } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useIsDesktop } from '@/lib/useMedia'
import { useT } from '@/i18n'
import { useCurrent, useTools, type TabId } from './store'
import { useColorStore } from './ui'
import { AdjustPanel } from './panels/AdjustPanel'
import { ColorPanel } from './panels/ColorPanel'
import { CompressPanel } from './panels/CompressPanel'
import { CropPanel } from './panels/CropPanel'
import { InfoPanel } from './panels/InfoPanel'
import { RedactPanel } from './panels/RedactPanel'
import { WatermarkPanel } from './panels/WatermarkPanel'

const TABS: Array<{ value: TabId; icon: LucideIcon }> = [
  { value: 'crop', icon: Crop },
  { value: 'adjust', icon: SlidersHorizontal },
  { value: 'watermark', icon: Stamp },
  { value: 'redact', icon: EyeOff },
  { value: 'compress', icon: Gauge },
  { value: 'info', icon: Info },
  { value: 'color', icon: Pipette },
]

const PANELS: Record<TabId, ComponentType> = {
  crop: CropPanel,
  adjust: AdjustPanel,
  watermark: WatermarkPanel,
  redact: RedactPanel,
  compress: CompressPanel,
  info: InfoPanel,
  color: ColorPanel,
}

/** 分頁內容面板的 id（分頁列可能在面板內或畫布下方，都指向同一個面板） */
export const TAB_PANEL_ID = 'tools-tabpanel'

/** 分頁列（滑動底線） */
export function TabStrip({ className }: { className?: string }) {
  const t = useT()
  const tab = useTools((s) => s.tab)
  const setTab = useTools((s) => s.setTab)
  const { doc, state } = useCurrent()
  const gpsAlert = !!doc?.hasGps && state?.meta === 'keep'
  const ready = doc?.status === 'ready' && !!state
  return (
    <Tabs
      value={tab}
      onChange={setTab}
      label={t('tools.tabs.label')}
      fullWidth
      animated={false}
      panelId={TAB_PANEL_ID}
      listClassName={cn(
        'gap-0 bg-surface px-1 [&>button]:h-14 [&>button]:min-w-0 [&>button]:px-1',
        className,
      )}
      items={TABS.map(({ value, icon: Icon }) => ({
        value,
        disabled: !ready,
        label: (
          <span className="flex min-w-0 max-w-full flex-col items-center gap-1">
            <span className="relative">
              <Icon size={18} aria-hidden />
              {value === 'info' && gpsAlert && (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-0.5 size-2 rounded-full bg-warning shadow-[0_0_0_1.5px_var(--surface)]"
                />
              )}
            </span>
            <span className="max-w-full truncate text-caption leading-none">
              {t(`tools.tabs.${value}`)}
            </span>
          </span>
        ),
      }))}
    />
  )
}

export function SidePanel() {
  const t = useT()
  const desktop = useIsDesktop()
  const tab = useTools((s) => s.tab)
  const { doc, state } = useCurrent()
  const ready = doc?.status === 'ready' && !!state
  const Panel = PANELS[tab]

  // 離開取色分頁時結束取色模式
  useEffect(() => {
    if (tab !== 'color') useColorStore.getState().setPicking(false)
  }, [tab])

  // 面板以目前選取的分頁按鈕命名（分頁按鈕的 id 由 Radix 產生，渲染後才知道）
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const trigger = document.querySelector<HTMLElement>(
      `[role="tab"][aria-controls="${TAB_PANEL_ID}"][data-state="active"]`,
    )
    const panel = panelRef.current
    if (!panel) return
    if (trigger?.id) panel.setAttribute('aria-labelledby', trigger.id)
    else panel.removeAttribute('aria-labelledby')
  }, [tab, desktop, ready])

  return (
    <aside
      aria-label={t('tools.tabs.label')}
      className="card min-w-0 lg:sticky lg:top-[calc(var(--topbar-h)+16px)] lg:h-(--tl-h) lg:overflow-y-auto"
    >
      {desktop && <TabStrip className="sticky top-0 z-10 rounded-t-lg pt-1" />}
      <div ref={panelRef} id={TAB_PANEL_ID} role="tabpanel">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            className="px-4 pb-4 pt-2"
            initial={{ opacity: 0, x: offset.panel }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -offset.panel }}
            transition={{ duration: sec(duration.fast), ease: easing.standard }}
          >
            {ready ? <Panel /> : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </aside>
  )
}
