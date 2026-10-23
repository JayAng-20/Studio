import { motion } from 'motion/react'
import { FolderOpen, SkipForward, TriangleAlert, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { spring } from '@/design/motion'
import { useT, type TKey } from '@/i18n'
import { usePlayer, type PlayItem } from '../store'
import { next, removeItem } from '../actions'
import { nextId } from '../logic/playlist'

/**
 * 無法播放時的說明卡：原因、瀏覽器回報、可以怎麼做——絕不只留黑畫面。
 * 「只有聲音沒有畫面」時可以關閉卡片繼續聽。
 */
export function Unsupported({ item, onChooseFile }: { item: PlayItem; onChooseFile: () => void }) {
  const t = useT()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const hasNext = usePlayer(
    (s) =>
      !!nextId({
        ids: s.items.map((i) => i.id),
        order: s.order,
        currentId: s.currentId,
        shuffle: s.shuffle,
        repeat: 'all',
      }) && s.items.length > 1,
  )
  const d = item.error
  if (!d || dismissed === item.id) return null
  const soft = !!item.noVideo
  const reasonKey = `player.unsupported.reasons.${d.reason}` as TKey
  return (
    <div className="absolute inset-0 z-[25] grid place-items-center overflow-y-auto bg-[color-mix(in_srgb,var(--stage-bg)_82%,transparent)] p-3 max-lg:relative max-lg:inset-auto max-lg:min-h-[240px] @md:p-6">
      <motion.div
        role="alert"
        className="stage-glass relative w-full max-w-lg rounded-xl p-4 text-left @md:p-5"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={spring.smooth}
      >
        {soft && (
          <button
            type="button"
            className="stage-btn absolute right-2 top-2"
            aria-label={t('common.close')}
            onClick={() => setDismissed(item.id)}
          >
            <X size={18} aria-hidden />
          </button>
        )}
        <div className="flex items-start gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--warning)_22%,transparent)]"
            style={{ color: 'color-mix(in srgb, var(--warning) 70%, white)' }}
          >
            <TriangleAlert size={20} aria-hidden />
          </span>
          <div className="min-w-0 pr-6">
            <h3 className="text-h3 font-semibold">
              {soft ? t('player.unsupported.noVideoTitle') : t('player.unsupported.title')}
            </h3>
            <p className="mt-0.5 truncate text-small text-[var(--stage-fg-2)]" title={item.name}>
              {item.name}
            </p>
          </div>
        </div>
        <p className="mt-3 text-body">{t(reasonKey, { format: d.format || '—' })}</p>
        <p className="mt-3 text-small font-semibold text-[var(--stage-fg-2)]">
          {t('player.unsupported.tipsTitle')}
        </p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-small">
          {d.tips.map((tip) => (
            <li key={tip}>{t(`player.unsupported.tips.${tip}` as TKey)}</li>
          ))}
        </ul>
        {d.probe.length > 0 && (
          <details className="mt-3 text-caption text-[var(--stage-fg-2)]">
            <summary className="cursor-pointer select-none">
              {t('player.unsupported.probe')}
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5 font-mono">
              {d.probe.map((p) => (
                <li key={p.mime} className="break-all">
                  {p.mime}：
                  {p.result ? t('player.unsupported.probeYes') : t('player.unsupported.probeNo')}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {hasNext && (
            <button
              type="button"
              className="stage-btn is-row bg-[var(--stage-hover)] px-3 text-small font-medium"
              onClick={() => next('user')}
            >
              <SkipForward size={16} aria-hidden />
              {t('player.unsupported.playNext')}
            </button>
          )}
          <button
            type="button"
            className="stage-btn is-row bg-[var(--stage-hover)] px-3 text-small font-medium"
            onClick={onChooseFile}
          >
            <FolderOpen size={16} aria-hidden />
            {t('player.unsupported.chooseOther')}
          </button>
          <button
            type="button"
            className="stage-btn is-row px-3 text-small font-medium"
            onClick={() => removeItem(item.id)}
          >
            <Trash2 size={16} aria-hidden />
            {t('player.unsupported.remove')}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
