import { AnimatePresence, motion } from 'motion/react'
import { Camera, History as HistoryIcon, ImageIcon, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Button, ConfirmDialog, toast } from '@/components/ui'
import { spring, staggerDelay } from '@/design/motion'
import { useLang, useT } from '@/i18n'
import { parseScan, scanSummary } from '../lib/parse'
import type { HistoryItem } from '../lib/storage'
import { KIND_ICONS } from './kindIcons'

/** 辨識歷史：只存在這台裝置，可逐筆刪除或全部清除 */
export function History({
  items,
  activeText,
  onShow,
  onRemove,
  onClear,
}: {
  items: HistoryItem[]
  activeText: string | null
  onShow: (item: HistoryItem) => void
  onRemove: (id: string) => void
  onClear: () => void
}) {
  const t = useT()
  const lang = useLang()
  const [confirm, setConfirm] = useState(false)
  const fmt = new Intl.DateTimeFormat(lang === 'en' ? 'en' : 'zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <section className="card flex flex-col gap-3 p-4" aria-labelledby="qr-history-title">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="qr-history-title" className="flex items-center gap-2 text-h3 font-semibold">
            <HistoryIcon size={18} className="text-text-3" aria-hidden />
            {t('qr.history.title')}
          </h2>
          <p className="text-caption text-text-3">{t('qr.history.note')}</p>
        </div>
        {items.length > 0 && (
          <Button size="sm" variant="ghost" leading={<Trash2 size={14} aria-hidden />} onClick={() => setConfirm(true)}>
            {t('qr.history.clear')}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-small text-text-3">{t('qr.history.empty')}</p>
      ) : (
        <ul className="-mx-1 flex max-h-[420px] flex-col overflow-y-auto">
          <AnimatePresence initial={false}>
            {items.map((h, i) => {
              const r = parseScan(h.text)
              const Icon = KIND_ICONS[r.kind]
              const summary = scanSummary(r) || h.text
              const active = h.text === activeText
              return (
                <motion.li
                  key={h.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0, transition: { ...spring.smooth, delay: staggerDelay(Math.min(i, 3)) } }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={spring.smooth}
                  className="group flex items-center gap-1 rounded-md"
                >
                  <button
                    type="button"
                    onClick={() => onShow(h)}
                    aria-current={active || undefined}
                    aria-label={t('qr.history.show', { summary })}
                    className={
                      'flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors duration-(--dur-fast) ' +
                      (active ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]' : 'hover:bg-surface-2')
                    }
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-text-2">
                      <Icon size={16} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-small font-medium text-text">{summary}</span>
                      <span className="flex items-center gap-1.5 text-caption text-text-3">
                        {h.source === 'camera' ? (
                          <Camera size={12} aria-label={t('qr.history.fromCamera')} />
                        ) : (
                          <ImageIcon size={12} aria-label={t('qr.history.fromImage')} />
                        )}
                        <span className="tabular-nums">{fmt.format(h.at)}</span>
                        <span aria-hidden>・</span>
                        <span>{t(`qr.result.kinds.${r.kind}`)}</span>
                      </span>
                    </span>
                  </button>
                  <Button
                    icon
                    size="sm"
                    variant="ghost"
                    aria-label={t('qr.history.remove')}
                    onClick={() => onRemove(h.id)}
                    className="max-sm:size-11 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  >
                    <X size={15} aria-hidden />
                  </Button>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('qr.history.clearTitle')}
        description={t('qr.history.clearDesc')}
        confirmLabel={t('qr.history.clear')}
        danger
        onConfirm={() => {
          onClear()
          toast.success(t('qr.history.cleared'))
        }}
      />
    </section>
  )
}
