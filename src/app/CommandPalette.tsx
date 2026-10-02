import { Command } from 'cmdk'
import { Dialog as RDialog } from 'radix-ui'
import { AnimatePresence, motion } from 'motion/react'
import { Eraser, Home, Keyboard, Languages, ListChecks, Moon, Search, Settings } from 'lucide-react'
import { useNavigate } from 'react-router'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { modules } from '@/config/modules'
import { IconTile, Kbd, toast } from '@/components/ui'
import { useUi } from '@/stores/ui'
import { useSettings } from '@/stores/settings'
import { useRecents } from '@/stores/recents'
import { useTasks } from '@/stores/tasks'
import { duration, sec, spring, scale } from '@/design/motion'
import { toggleTheme } from './theme'
import { useT } from '@/i18n'

/** 指令面板：⌘K／Ctrl+K 或 / 開啟；模糊搜尋模組與動作 */
export function CommandPalette() {
  const t = useT()
  const open = useUi((s) => s.commandOpen)
  const setUi = useUi((s) => s.set)
  const nav = useNavigate()
  const close = () => setUi({ commandOpen: false })
  const run = (fn: () => void) => () => {
    close()
    // 等對話框關閉後再執行，避免焦點與動畫衝突
    requestAnimationFrame(fn)
  }
  const lang = useSettings((s) => s.lang)
  const [selected, setSelected] = useState('')

  return (
    <RDialog.Root open={open} onOpenChange={(o) => setUi({ commandOpen: o })}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[70] bg-[rgba(10,12,16,.3)] backdrop-blur-[4px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: sec(duration.fast) }}
              />
            </RDialog.Overlay>
            <RDialog.Content asChild forceMount>
              <motion.div
                className="floating fixed left-1/2 top-[12vh] z-[71] w-[calc(100%-32px)] max-w-[600px] -translate-x-1/2 overflow-hidden"
                initial={{ opacity: 0, scale: scale.dialogFrom, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{
                  opacity: 0,
                  scale: scale.dialogFrom,
                  transition: { duration: sec(duration.instant) },
                }}
                transition={spring.snappy}
                style={{ x: '-50%' }}
              >
                <RDialog.Title className="sr-only">{t('command.title')}</RDialog.Title>
                <RDialog.Description className="sr-only">
                  {t('command.placeholder')}
                </RDialog.Description>
                <SelectedCtx.Provider value={selected}>
                  <Command
                    label={t('command.title')}
                    loop
                    className="cmdk"
                    value={selected}
                    onValueChange={setSelected}
                  >
                    <div className="flex items-center gap-3 border-b border-border px-4">
                      <Search size={18} className="shrink-0 text-text-3" aria-hidden />
                      <Command.Input
                        autoFocus
                        placeholder={t('command.placeholder')}
                        className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-text-3"
                      />
                      <Kbd>Esc</Kbd>
                    </div>
                    <Command.List className="max-h-[min(420px,60dvh)] overflow-y-auto p-2">
                      <Command.Empty className="py-10 text-center text-body text-text-3">
                        {t('command.empty')}
                      </Command.Empty>
                      <Command.Group heading={t('command.groupModules')}>
                        {modules.map((m) => (
                          <Item
                            key={m.id}
                            value={`${m.id} ${t(m.nameKey)} ${t(m.descKey)}`}
                            onSelect={run(() => nav(m.path))}
                            icon={<IconTile module={m.id} size="sm" />}
                          >
                            <span className="font-medium">{t(m.nameKey)}</span>
                            <span className="ml-2 hidden truncate text-small text-text-3 sm:inline">
                              {t(m.descKey)}
                            </span>
                          </Item>
                        ))}
                      </Command.Group>
                      <Command.Group heading={t('command.groupActions')}>
                        <Item
                          value="theme dark light 主題"
                          onSelect={run(() => toggleTheme())}
                          icon={<Moon size={18} />}
                        >
                          {t('command.toggleTheme')}
                        </Item>
                        <Item
                          value="language 語言 english 中文"
                          onSelect={run(() =>
                            useSettings.getState().set({ lang: lang === 'en' ? 'zh-TW' : 'en' }),
                          )}
                          icon={<Languages size={18} />}
                        >
                          {t('command.toggleLang')}
                        </Item>
                        <Item
                          value="clear recents 清除 最近"
                          onSelect={run(() => {
                            useRecents.getState().clear()
                            toast.success(t('settings.clearRecentsDone'))
                          })}
                          icon={<Eraser size={18} />}
                        >
                          {t('command.clearData')}
                        </Item>
                        <Item
                          value="tasks 任務"
                          onSelect={run(() => useTasks.getState().setPanelOpen(true))}
                          icon={<ListChecks size={18} />}
                        >
                          {t('command.openTasks')}
                        </Item>
                        <Item
                          value="shortcuts 快捷鍵 keyboard"
                          onSelect={run(() => setUi({ shortcutsOpen: true }))}
                          icon={<Keyboard size={18} />}
                          shortcut="?"
                        >
                          {t('command.openShortcuts')}
                        </Item>
                      </Command.Group>
                      <Command.Group heading={t('command.groupNav')}>
                        <Item
                          value="home 首頁"
                          onSelect={run(() => nav('/'))}
                          icon={<Home size={18} />}
                        >
                          {t('command.goHome')}
                        </Item>
                        <Item
                          value="settings 設定"
                          onSelect={run(() => nav('/settings'))}
                          icon={<Settings size={18} />}
                        >
                          {t('command.openSettings')}
                        </Item>
                      </Command.Group>
                    </Command.List>
                  </Command>
                </SelectedCtx.Provider>
              </motion.div>
            </RDialog.Content>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  )
}

const SelectedCtx = createContext('')

function Item({
  value,
  onSelect,
  icon,
  children,
  shortcut,
}: {
  value: string
  onSelect: () => void
  icon: ReactNode
  children: ReactNode
  shortcut?: string
}) {
  const selected = useContext(SelectedCtx)
  const isSel = selected.trim().toLowerCase() === value.trim().toLowerCase()
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="cmdk-item relative flex h-11 cursor-default select-none items-center gap-3 rounded-md px-3 text-body outline-none"
    >
      {isSel && (
        <motion.span
          layoutId="cmdk-pill"
          className="absolute inset-0 rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] shadow-[inset_2px_0_0_var(--accent)]"
          transition={spring.snappy}
        />
      )}
      <span className="relative grid size-7 shrink-0 place-items-center text-text-2">{icon}</span>
      <span className="relative flex min-w-0 flex-1 items-center truncate">{children}</span>
      {shortcut && <Kbd className="relative">{shortcut}</Kbd>}
    </Command.Item>
  )
}
