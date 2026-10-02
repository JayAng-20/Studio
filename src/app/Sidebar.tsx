import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { NavLink, useLocation } from 'react-router'
import { Home, ListChecks, PanelLeftClose, PanelLeftOpen, Search, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { groups, modules, moduleFromPath, preloadModule } from '@/config/modules'
import { app } from '@/config/app'
import { Logo } from '@/design/Logo'
import { IconTile, Tooltip, Kbd } from '@/components/ui'
import { duration, easing, sec, spring, timing } from '@/design/motion'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useActiveTaskCount, useTasks } from '@/stores/tasks'
import { modKey } from '@/lib/capabilities'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'

const W_OPEN = 248
const W_RAIL = 72

/**
 * 左側欄（玻璃）。桌機可收合成 72 px 圖示欄；平板預設圖示欄，點開變覆蓋式側欄。
 * overlay=true 時以覆蓋模式呈現。
 */
export function Sidebar({ mode }: { mode: 'desktop' | 'tablet' }) {
  const collapsedPref = useSettings((s) => s.sidebarCollapsed)
  const setSettings = useSettings((s) => s.set)
  const overlayOpen = useUi((s) => s.navOverlayOpen)
  const setUi = useUi((s) => s.set)
  const t = useT()

  const rail = mode === 'tablet' ? true : collapsedPref
  const toggle = () => {
    if (mode === 'tablet') setUi({ navOverlayOpen: !overlayOpen })
    else setSettings({ sidebarCollapsed: !collapsedPref })
  }

  return (
    <>
      <motion.aside
        aria-label={t('a11y.mainNav')}
        className="glass relative z-40 hidden h-dvh shrink-0 flex-col overflow-hidden border-y-0 border-l-0 sm:flex"
        initial={false}
        animate={{ width: rail ? W_RAIL : W_OPEN }}
        transition={{ duration: sec(duration.base), ease: easing.emphasized }}
        style={{ borderRadius: 0 }}
      >
        <SidebarContent
          collapsed={rail}
          onToggle={toggle}
          toggleLabel={rail ? t('nav.expand') : t('nav.collapse')}
        />
      </motion.aside>
      <AnimatePresence>
        {mode === 'tablet' && overlayOpen && (
          <>
            <motion.div
              key="scrim"
              className="fixed inset-0 z-[55] bg-[rgba(10,12,16,.3)] backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setUi({ navOverlayOpen: false })}
            />
            <motion.aside
              key="overlay"
              aria-label={t('a11y.mainNav')}
              className="glass fixed inset-y-0 left-0 z-[56] flex w-[248px] flex-col shadow-e4"
              style={{
                background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
                borderRadius: 0,
              }}
              initial={{ x: -W_OPEN }}
              animate={{ x: 0 }}
              exit={{ x: -W_OPEN }}
              transition={spring.smooth}
            >
              <SidebarContent
                collapsed={false}
                onToggle={toggle}
                toggleLabel={t('nav.closeMenu')}
                onNavigate={() => setUi({ navOverlayOpen: false })}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

/** 側欄文字：收合時比寬度提早 80 ms 淡出，展開時延後 80 ms 淡入 */
function FadeLabel({
  hidden,
  children,
  className,
}: {
  hidden: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <motion.span
      className={cn('min-w-0 whitespace-nowrap', className)}
      initial={false}
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={
        hidden
          ? { duration: sec(duration.base - timing.sidebarTextLead) }
          : { duration: sec(duration.fast), delay: sec(timing.sidebarTextLead) }
      }
      aria-hidden={hidden || undefined}
    >
      {children}
    </motion.span>
  )
}

function SidebarContent({
  collapsed,
  onToggle,
  toggleLabel,
  onNavigate,
}: {
  collapsed: boolean
  onToggle: () => void
  toggleLabel: string
  onNavigate?: () => void
}) {
  const t = useT()
  const { pathname } = useLocation()
  const current =
    moduleFromPath(pathname)?.id ??
    (pathname === '/' ? 'home' : pathname === '/settings' ? 'settings' : '')
  const setUi = useUi((s) => s.set)
  const active = useActiveTaskCount()
  const setPanelOpen = useTasks((s) => s.setPanelOpen)

  return (
    <LayoutGroup id="sidebar">
      <div className="flex h-[var(--topbar-h)] shrink-0 items-center overflow-hidden pl-[21px]">
        <NavLink
          to="/"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2.5 rounded-md"
          aria-label={app.name}
        >
          <Logo size={30} hoverSpin />
          <FadeLabel hidden={collapsed} className="text-[15px] font-semibold tracking-[-0.01em]">
            {app.shortName}
          </FadeLabel>
        </NavLink>
      </div>

      <div className="px-[10px] pb-2">
        <Tooltip
          content={t('nav.search')}
          side="right"
          disabled={!collapsed}
          shortcut={`${modKey()}K`}
        >
          <button
            type="button"
            onClick={() => {
              onNavigate?.()
              setUi({ commandOpen: true })
            }}
            aria-label={t('nav.search')}
            className="flex h-9 w-full items-center gap-2 overflow-hidden rounded-md border border-border bg-[color-mix(in_srgb,var(--surface)_60%,transparent)] pl-[17px] pr-2 text-small text-text-3 transition-colors hover:border-border-strong hover:text-text-2"
          >
            <Search size={16} aria-hidden className="shrink-0" />
            <FadeLabel
              hidden={collapsed}
              className="flex flex-1 items-center justify-between gap-2"
            >
              <span>{t('nav.search')}</span>
              <Kbd>{modKey()}K</Kbd>
            </FadeLabel>
          </button>
        </Tooltip>
      </div>

      <nav className="hide-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-[10px] pb-3 pt-1">
        <NavItem
          to="/"
          label={t('nav.home')}
          collapsed={collapsed}
          active={current === 'home'}
          onNavigate={onNavigate}
          icon={<HomeTile />}
        />
        {groups.map((g) => (
          <div key={g.id} className="mt-3 flex flex-col gap-0.5">
            <div className="relative h-6">
              <FadeLabel
                hidden={collapsed}
                className="absolute left-3 top-0 text-caption leading-6 font-medium text-text-3"
              >
                {t(g.labelKey)}
              </FadeLabel>
              <motion.span
                aria-hidden
                className="absolute left-[14px] top-1/2 h-px w-6 bg-border-strong"
                initial={false}
                animate={{ opacity: collapsed ? 1 : 0 }}
              />
            </div>
            {modules
              .filter((m) => m.group === g.id)
              .map((m) => (
                <NavItem
                  key={m.id}
                  to={m.path}
                  label={t(m.nameKey)}
                  collapsed={collapsed}
                  active={current === m.id}
                  onNavigate={onNavigate}
                  onHover={() => preloadModule(m.id)}
                  icon={<IconTile module={m.id} size="sm" />}
                />
              ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border px-[10px] py-3">
        <SideButton
          collapsed={collapsed}
          label={t('nav.tasks')}
          icon={<ListChecks size={18} aria-hidden />}
          badge={active || undefined}
          onClick={() => {
            onNavigate?.()
            setPanelOpen(true)
          }}
        />
        <NavItem
          to="/settings"
          label={t('nav.settings')}
          collapsed={collapsed}
          active={current === 'settings'}
          onNavigate={onNavigate}
          icon={
            <span className="grid size-7 place-items-center text-text-2">
              <Settings size={18} aria-hidden />
            </span>
          }
        />
        <SideButton
          collapsed={collapsed}
          label={toggleLabel}
          icon={
            collapsed ? (
              <PanelLeftOpen size={18} aria-hidden />
            ) : (
              <PanelLeftClose size={18} aria-hidden />
            )
          }
          onClick={onToggle}
          shortcut={`${modKey()}B`}
        />
      </div>
    </LayoutGroup>
  )
}

function HomeTile() {
  return (
    <span className="grid size-7 place-items-center rounded-[6.3px] text-text-2">
      <Home size={18} aria-hidden />
    </span>
  )
}

function NavItem({
  to,
  label,
  icon,
  collapsed,
  active,
  onNavigate,
  onHover,
}: {
  to: string
  label: string
  icon: ReactNode
  collapsed: boolean
  active: boolean
  onNavigate?: () => void
  onHover?: () => void
}) {
  return (
    <Tooltip content={label} side="right" disabled={!collapsed}>
      <NavLink
        to={to}
        onClick={onNavigate}
        onPointerEnter={onHover}
        onFocus={onHover}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex h-10 shrink-0 items-center gap-2.5 overflow-hidden rounded-md px-3 text-body transition-colors duration-(--dur-fast)',
          active
            ? 'font-semibold text-text'
            : 'text-text-2 hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] hover:text-text',
        )}
      >
        {active && (
          <motion.span
            layoutId="nav-pill"
            className="absolute inset-0 rounded-md bg-surface shadow-e1 ring-1 ring-border dark:bg-surface-3"
            transition={spring.snappy}
          />
        )}
        <span className="relative shrink-0">{icon}</span>
        <FadeLabel hidden={collapsed} className="relative truncate">
          {label}
        </FadeLabel>
      </NavLink>
    </Tooltip>
  )
}

function SideButton({
  label,
  icon,
  collapsed,
  onClick,
  badge,
  shortcut,
}: {
  label: string
  icon: ReactNode
  collapsed: boolean
  onClick: () => void
  badge?: number
  shortcut?: string
}) {
  return (
    <Tooltip content={label} side="right" disabled={!collapsed} shortcut={shortcut}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="relative flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-body text-text-2 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] hover:text-text"
      >
        <span className="grid size-7 shrink-0 place-items-center">{icon}</span>
        <FadeLabel hidden={collapsed} className="flex-1 truncate text-left">
          {label}
        </FadeLabel>
        {badge !== undefined && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={spring.bouncy}
            className={cn(
              'grid h-5 min-w-5 place-items-center rounded-full bg-accent-strong px-1.5 text-[11px] font-semibold text-white tabular-nums',
              collapsed && 'absolute left-[34px] top-1',
            )}
          >
            {badge}
          </motion.span>
        )}
      </button>
    </Tooltip>
  )
}
