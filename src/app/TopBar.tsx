import { Languages, Menu as MenuIcon, Moon, Search, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Link, useLocation } from 'react-router'
import { moduleFromPath } from '@/config/modules'
import { app } from '@/config/app'
import { Logo } from '@/design/Logo'
import { Button, Menu, Tooltip } from '@/components/ui'
import { resolveTheme, useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { modKey } from '@/lib/capabilities'
import { useIsMobile, useMedia } from '@/lib/useMedia'
import { duration, sec } from '@/design/motion'
import { toggleTheme } from './theme'
import { useT } from '@/i18n'

/** 模組放置專屬動作的位置（以 portal 渲染） */
export const TOPBAR_ACTIONS_ID = 'topbar-actions'

/** 頂欄：sticky、玻璃、56 px */
export function TopBar() {
  const t = useT()
  const { pathname } = useLocation()
  const mod = moduleFromPath(pathname)
  const theme = useSettings((s) => s.theme)
  const lang = useSettings((s) => s.lang)
  const set = useSettings((s) => s.set)
  const setUi = useUi((s) => s.set)
  const isMobile = useIsMobile()
  const isTablet = useMedia('(min-width: 640px) and (max-width: 1023px)')
  const dark = resolveTheme(theme) === 'dark'

  const title = mod
    ? t(mod.nameKey)
    : pathname === '/settings'
      ? t('nav.settings')
      : pathname === '/'
        ? ''
        : ''

  return (
    <header
      className="glass sticky top-0 z-30 flex h-[var(--topbar-h)] shrink-0 items-center gap-2 border-x-0 border-t-0 px-4 sm:px-6"
      style={{ borderRadius: 0 }}
    >
      {isTablet && (
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={t('nav.openMenu')}
          onClick={() => setUi({ navOverlayOpen: true })}
        >
          <MenuIcon size={18} aria-hidden />
        </Button>
      )}
      {isMobile && (
        <Link to="/" aria-label={app.name} className="mr-1 shrink-0 rounded-md">
          <Logo size={28} />
        </Link>
      )}
      <nav aria-label="breadcrumb" className="min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.ol
            key={pathname}
            className="flex min-w-0 items-center gap-1.5 text-body"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: sec(duration.fast) }}
          >
            {title ? (
              <>
                <li className="hidden sm:block">
                  <Link to="/" className="rounded-sm text-text-3 transition-colors hover:text-text">
                    {t('nav.breadcrumbHome')}
                  </Link>
                </li>
                <li aria-hidden className="hidden text-text-3 sm:block">
                  /
                </li>
                <li aria-current="page" className="truncate font-semibold text-text">
                  {title}
                </li>
              </>
            ) : (
              <li className="truncate font-semibold text-text sm:hidden">{app.shortName}</li>
            )}
          </motion.ol>
        </AnimatePresence>
      </nav>
      <div id={TOPBAR_ACTIONS_ID} className="flex items-center gap-1" />
      <div className="flex items-center gap-0.5">
        <Tooltip content={t('nav.search')} shortcut={`${modKey()}K`}>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={t('nav.search')}
            onClick={() => setUi({ commandOpen: true })}
          >
            <Search size={18} aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip content={dark ? t('theme.toLight') : t('theme.toDark')}>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={dark ? t('theme.toLight') : t('theme.toDark')}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={dark ? 'moon' : 'sun'}
                initial={{ rotate: -90, scale: 0.5, opacity: 0 }}
                animate={{ rotate: 0, scale: 1, opacity: 1 }}
                exit={{ rotate: 90, scale: 0.5, opacity: 0 }}
                transition={{ duration: sec(duration.fast) }}
                className="grid place-items-center"
              >
                {dark ? <Moon size={18} aria-hidden /> : <Sun size={18} aria-hidden />}
              </motion.span>
            </AnimatePresence>
          </Button>
        </Tooltip>
        <Menu
          label={t('lang.toggle')}
          trigger={
            <Button variant="ghost" size="sm" icon aria-label={t('lang.toggle')}>
              <Languages size={18} aria-hidden />
            </Button>
          }
          items={[
            {
              key: 'zh',
              label: `${lang === 'zh-TW' ? '✓ ' : ''}${t('lang.zh')}`,
              onSelect: () => set({ lang: 'zh-TW' }),
            },
            {
              key: 'en',
              label: `${lang === 'en' ? '✓ ' : ''}${t('lang.en')}`,
              onSelect: () => set({ lang: 'en' }),
            },
          ]}
        />
      </div>
    </header>
  )
}
