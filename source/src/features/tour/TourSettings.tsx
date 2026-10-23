/**
 * 設定頁的「新手導覽」：開啟後列出每個功能的編號（只在這裡出現），
 * 點選編號就跳到該功能，並開始動畫導覽。
 */
import { AnimatePresence, motion } from 'motion/react'
import { Play } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { CSSProperties } from 'react'
import { Switch } from '@/components/ui'
import { moduleById } from '@/config/modules'
import { spring, staggerDelay } from '@/design/motion'
import { useSettings } from '@/stores/settings'
import { useLang, useT, type TKey } from '@/i18n'
import { toolName } from '@/features/pdf/tools'
import { TOURS, TOUR_GROUPS, tourNumber, type TourDef } from './content'
import { useTour } from './store'

export function TourSettings() {
  const t = useT()
  const lang = useLang()
  const on = useSettings((s) => s.tourMode)
  const set = useSettings((s) => s.set)
  const start = useTour((s) => s.start)
  const nav = useNavigate()

  const nameOf = (d: TourDef) =>
    d.text[lang].name ?? (d.tool ? t(toolName(d.tool)) : d.module ? t(moduleById[d.module].nameKey) : '')
  const colors = (d: TourDef): CSSProperties => {
    const m = d.module ? moduleById[d.module] : null
    return { '--c1': m?.m1 ?? '#5AA2FF', '--c2': m?.m2 ?? '#2F6BEA' } as CSSProperties
  }
  const open = (d: TourDef) => {
    nav(d.path)
    // 等新頁面掛上再開始，開場卡片不依賴目標元素
    setTimeout(() => start(d), 120)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-small text-text-2">{t('settings.tourDesc')}</p>
      <Switch label={t('settings.tourToggle')} checked={on} onChange={(v) => set({ tourMode: v })} />
      <AnimatePresence initial={false}>
        {on && (
          <motion.div
            key="list"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring.smooth}
            className="overflow-hidden"
          >
            <div className="flex items-baseline justify-between pt-1">
              <h3 className="text-small font-semibold">{t('settings.tourListTitle')}</h3>
              <span className="text-caption text-text-3">{t('settings.tourCount', { count: TOURS.length })}</span>
            </div>
            <div className="mt-3 flex flex-col gap-5">
              {TOUR_GROUPS.map((g) => {
                const list = TOURS.filter((d) => d.group === g)
                if (!list.length) return null
                return (
                  <section key={g}>
                    <h4 className="mb-2 text-caption font-semibold uppercase tracking-[.08em] text-text-3">
                      {t(g === 'start' ? 'settings.tourGroupStart' : (`nav.groups.${g}` as TKey))}
                    </h4>
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {list.map((d) => {
                        const num = tourNumber(d.id)
                        const name = nameOf(d)
                        return (
                          <motion.li
                            key={d.id}
                            initial={{ opacity: 0, y: 10, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ ...spring.smooth, delay: staggerDelay(Math.min(num - 1, 14)) }}
                          >
                            <motion.button
                              type="button"
                              onClick={() => open(d)}
                              aria-label={t('settings.tourStart', { name })}
                              whileHover={{ y: -2 }}
                              whileTap={{ scale: 0.98 }}
                              transition={spring.snappy}
                              style={colors(d)}
                              className="group flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-2.5 text-left shadow-e1 transition-[border-color,box-shadow] duration-(--dur-fast) hover:border-[color-mix(in_srgb,var(--c2)_45%,transparent)] hover:shadow-e2"
                            >
                              <span className="relative grid h-11 w-12 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-gradient-to-br from-[var(--c1)] to-[var(--c2)] text-[17px] font-bold tabular-nums text-white shadow-e1">
                                {String(num).padStart(2, '0')}
                                <span className="absolute inset-0 grid place-items-center bg-black/25 opacity-0 transition-opacity duration-(--dur-fast) group-hover:opacity-100">
                                  <Play size={16} fill="currentColor" aria-hidden />
                                </span>
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-body font-medium text-text">{name}</span>
                                <span className="block truncate text-caption text-text-3">{d.text[lang].intro}</span>
                              </span>
                            </motion.button>
                          </motion.li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
