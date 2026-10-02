import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, Download, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from '@/components/ui'
import { downloadBlob, copyBlob } from '@/lib/download'
import { formatTime } from '@/lib/format'
import { asFile, useFileBus } from '@/stores/fileBus'
import { duration as dur, sec, spring, timing } from '@/design/motion'
import { useT } from '@/i18n'
import { usePlayer } from '../store'
import { clearSnapshot } from '../actions'

/**
 * 截圖結果：畫面閃一下，縮圖從整個畫面縮進右上角的卡片；
 * 可下載 PNG、複製、傳送到圖片工具。放在播放畫面內，全螢幕時也看得到。
 */
export function SnapshotCard() {
  const t = useT()
  const nav = useNavigate()
  const snap = usePlayer((s) => s.snapshot)
  const [copied, setCopied] = useState(false)
  const [hover, setHover] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(copyTimer.current), [])
  // 沒有互動時 8 秒後自動收起
  useEffect(() => {
    if (!snap || hover) return
    const id = setTimeout(() => clearSnapshot(), 8000)
    return () => clearTimeout(id)
  }, [snap, hover])

  const send = async () => {
    if (!snap) return
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
    useFileBus.getState().send('tools', 'player', [asFile(snap.blob, snap.name)])
    toast.success(t('common.sentTo', { target: t('modules.tools.name') }))
    nav('/tools')
  }

  return (
    <>
      <AnimatePresence>
        {snap && (
          <motion.div
            key={`flash-${snap.n}`}
            aria-hidden
            className="snap-flash pointer-events-none absolute inset-0 z-[26]"
            initial={{ opacity: 0.55 }}
            animate={{ opacity: 0 }}
            transition={{ duration: sec(dur.slow) }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {snap && (
          <motion.div
            key={snap.n}
            role="status"
            aria-live="polite"
            className="stage-glass absolute right-2 top-2 z-[27] w-[min(260px,62cqw)] origin-top-right rounded-lg p-2 @md:right-3 @md:top-3"
            initial={{ opacity: 0, scale: 2.4, x: '-20%', y: '20%' }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: sec(dur.fast) } }}
            transition={spring.smooth}
            onPointerEnter={() => setHover(true)}
            onPointerLeave={() => setHover(false)}
            onFocusCapture={() => setHover(true)}
            onBlurCapture={() => setHover(false)}
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
              <span className="truncate text-caption font-semibold tabular-nums">{t('player.snapshot.taken', { time: formatTime(snap.time) })}</span>
              <button type="button" className="stage-btn h-7! min-w-7! p-0" aria-label={t('player.snapshot.close')} onClick={clearSnapshot}>
                <X size={15} aria-hidden />
              </button>
            </div>
            <img src={snap.url} alt={snap.name} className="block aspect-video w-full rounded-sm bg-[var(--stage-bg)] object-contain" />
            <div className="mt-1.5 grid grid-cols-3 gap-1">
              <button type="button" className="stage-btn h-auto! flex-col gap-0.5 py-1.5 text-[11px] font-medium" onClick={() => downloadBlob(snap.blob, snap.name)}>
                <Download size={16} aria-hidden />
                {t('common.download')}
              </button>
              <button
                type="button"
                className="stage-btn h-auto! flex-col gap-0.5 py-1.5 text-[11px] font-medium"
                onClick={async () => {
                  const ok = await copyBlob(snap.blob)
                  if (!ok) {
                    toast.error(t('player.errors.copyFailed'))
                    return
                  }
                  setCopied(true)
                  clearTimeout(copyTimer.current)
                  copyTimer.current = setTimeout(() => setCopied(false), timing.copiedReset)
                }}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={copied ? 'ok' : 'copy'}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={spring.bouncy}
                  >
                    {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                  </motion.span>
                </AnimatePresence>
                {copied ? t('common.copied') : t('player.snapshot.copy')}
              </button>
              <button type="button" className="stage-btn h-auto! flex-col gap-0.5 py-1.5 text-[11px] font-medium" onClick={() => void send()}>
                <Send size={16} aria-hidden />
                <span className="leading-tight">{t('modules.tools.name')}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
