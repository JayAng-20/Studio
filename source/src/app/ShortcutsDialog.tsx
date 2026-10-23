import { Dialog, Kbd } from '@/components/ui'
import { useUi, type ShortcutDef } from '@/stores/ui'
import { modKey } from '@/lib/capabilities'
import { useT } from '@/i18n'

/** 按 ? 開啟：列出全域與目前模組的快捷鍵 */
export function ShortcutsDialog() {
  const t = useT()
  const open = useUi((s) => s.shortcutsOpen)
  const moduleShortcuts = useUi((s) => s.moduleShortcuts)
  const set = useUi((s) => s.set)
  const global: ShortcutDef[] = [
    { keys: [modKey(), 'K'], label: t('shortcuts.commandPalette') },
    { keys: ['/'], label: t('shortcuts.commandPalette') },
    { keys: ['?'], label: t('shortcuts.help') },
    { keys: [modKey(), 'B'], label: t('shortcuts.toggleSidebar') },
    { keys: [modKey(), 'V'], label: t('shortcuts.paste') },
  ]
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => set({ shortcutsOpen: o })}
      title={t('shortcuts.title')}
      size="lg"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Section title={t('shortcuts.global')} list={global} />
        <Section title={t('shortcuts.module')} list={moduleShortcuts} empty={t('shortcuts.none')} />
      </div>
    </Dialog>
  )
}

function Section({ title, list, empty }: { title: string; list: ShortcutDef[]; empty?: string }) {
  return (
    <section>
      <h3 className="mb-2 text-small font-semibold text-text-2">{title}</h3>
      {list.length ? (
        <dl className="flex flex-col">
          {list.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
            >
              <dt className="text-body text-text">{s.label}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {s.keys.map((k, j) => (
                  <Kbd key={j}>{k}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-small text-text-3">{empty}</p>
      )}
    </section>
  )
}
