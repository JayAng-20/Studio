import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { duration as dur, sec, spring } from '@/design/motion'
import { formatBytes, formatTime } from '@/lib/format'
import { useT } from '@/i18n'
import { usePlayer, useCurrent, type PlayItem } from '../store'
import { formatSpeed } from '../logic/speed'

/** 檔案資訊的欄位（面板與畫面浮層共用） */
export function useInfoRows(item: PlayItem | null) {
  const t = useT()
  if (!item) return []
  const res = item.width && item.height ? `${item.width} × ${item.height}` : t('player.info.unknown')
  const fps = item.kind === 'video' && item.frameDur ? t('player.info.fps', { value: (1 / item.frameDur).toFixed(item.frameDur > 0.03 ? 0 : 2).replace(/\.00$/, '') }) : null
  const rows: Array<[string, string, boolean?]> = [
    [t('player.info.name'), item.name, false],
    [t('player.info.size'), item.size !== undefined ? formatBytes(item.size) : t('player.info.unknown'), true],
    [t('player.info.duration'), item.duration ? formatTime(item.duration) : t('player.info.unknown'), true],
    [t('player.info.resolution'), item.kind === 'video' ? res : t('player.info.unknown'), true],
    [
      t('player.info.type'),
      `${item.kind === 'video' ? t('player.info.video') : t('player.info.audio')}${item.type ? `（${item.type}）` : ''}`,
    ],
    [t('player.info.source'), item.source === 'file' ? t('player.info.sourceFile') : t('player.info.sourceUrl')],
  ]
  if (fps) rows.push([t('player.info.frameRate'), fps, true])
  if (item.meta?.title) rows.push([t('player.info.titleTag'), item.meta.title])
  if (item.meta?.artist) rows.push([t('player.info.artist'), item.meta.artist])
  if (item.meta?.album) rows.push([t('player.info.album'), item.meta.album])
  return rows
}

/** 按 I 開啟的畫面浮層：檔案資訊＋即時狀態 */
export function InfoOverlay() {
  const t = useT()
  const open = usePlayer((s) => s.infoOverlay)
  const item = useCurrent()
  const rate = usePlayer((s) => s.rate)
  const time = usePlayer((s) => s.time)
  const rows = useInfoRows(item)
  return (
    <AnimatePresence>
      {open && item && (
        <motion.div
          className="stage-glass absolute left-2 top-2 z-[24] max-h-[calc(100%-var(--controls-h)-8px)] w-[min(320px,calc(100%-16px))] overflow-y-auto rounded-lg p-3 text-small @md:left-3 @md:top-3"
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, transition: { duration: sec(dur.fast) } }}
          transition={spring.snappy}
          role="region"
          aria-label={t('player.info.title')}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-small font-semibold">{t('player.info.title')}</h3>
            <button type="button" className="stage-btn h-7! min-w-7! p-0" aria-label={t('common.close')} onClick={() => usePlayer.getState().set({ infoOverlay: false })}>
              <X size={15} aria-hidden />
            </button>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            {rows.map(([k, v, numeric]) => (
              <div key={k} className="contents">
                <dt className="text-[var(--stage-fg-2)]">{k}</dt>
                <dd className={numeric ? 'break-all tabular-nums' : 'break-all'}>{v}</dd>
              </div>
            ))}
            <dt className="text-[var(--stage-fg-2)]">{t('player.controls.speed')}</dt>
            <dd className="tabular-nums">
              {formatSpeed(rate)} · {formatTime(time, { tenths: true })}
            </dd>
          </dl>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
