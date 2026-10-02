import { LayoutGroup, motion } from 'motion/react'
import { NavLink, useLocation } from 'react-router'
import { Home, LayoutGrid } from 'lucide-react'
import { modules, moduleById, moduleFromPath, MODULE_IDS } from '@/config/modules'
import { IconTile, Sheet } from '@/components/ui'
import { recentModules, useRecents } from '@/stores/recents'
import { useUi } from '@/stores/ui'
import { spring } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'

/** 手機底部玻璃 tab bar：首頁＋最近常用 3 個模組＋全部 */
export function MobileTabBar() {
  const t = useT()
  const { pathname } = useLocation()
  const entries = useRecents((s) => s.entries)
  const open = useUi((s) => s.allModulesOpen)
  const setUi = useUi((s) => s.set)
  const current = moduleFromPath(pathname)?.id
  const recent = recentModules(entries, 3)
  const picks = [...recent, ...MODULE_IDS.filter((id) => !recent.includes(id))].slice(0, 3)
  const items = [
    {
      key: 'home',
      to: '/',
      label: t('nav.home'),
      icon: <Home size={22} aria-hidden />,
      active: pathname === '/',
    },
    ...picks.map((id) => ({
      key: id,
      to: moduleById[id].path,
      label: t(moduleById[id].nameKey),
      icon: <IconTile module={id} size="sm" />,
      active: current === id,
    })),
  ]
  return (
    <>
      <nav
        aria-label={t('a11y.mobileNav')}
        className="glass fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] sm:hidden"
        style={{ borderRadius: 0 }}
      >
        <LayoutGroup id="tabbar">
          <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1.5 pb-1">
            {items.map((it) => (
              <li key={it.key} className="flex-1">
                <NavLink
                  to={it.to}
                  aria-current={it.active ? 'page' : undefined}
                  className={cn(
                    'relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[11px] leading-4',
                    it.active ? 'font-semibold text-text' : 'text-text-3',
                  )}
                >
                  {it.active && (
                    <motion.span
                      layoutId="tab-pill"
                      className="absolute inset-x-1 inset-y-0.5 rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
                      transition={spring.snappy}
                    />
                  )}
                  <span className="relative grid h-7 place-items-center">{it.icon}</span>
                  <span className="relative max-w-full truncate">{it.label}</span>
                </NavLink>
              </li>
            ))}
            <li className="flex-1">
              <button
                type="button"
                onClick={() => setUi({ allModulesOpen: true })}
                className="relative flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[11px] leading-4 text-text-3"
              >
                <span className="grid h-7 place-items-center">
                  <LayoutGrid size={22} aria-hidden />
                </span>
                <span>{t('nav.all')}</span>
              </button>
            </li>
          </ul>
        </LayoutGroup>
      </nav>
      <Sheet
        open={open}
        onOpenChange={(o) => setUi({ allModulesOpen: o })}
        title={t('nav.allTools')}
      >
        <ul className="grid grid-cols-3 gap-3 pb-4 pt-1">
          {modules.map((m) => (
            <li key={m.id}>
              <NavLink
                to={m.path}
                onClick={() => setUi({ allModulesOpen: false })}
                className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg p-2 text-center text-small font-medium text-text transition-colors active:bg-surface-2"
              >
                <IconTile module={m.id} size="lg" />
                <span className="leading-tight">{t(m.nameKey)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  )
}
