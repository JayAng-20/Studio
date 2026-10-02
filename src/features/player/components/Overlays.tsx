import { AnimatePresence, motion } from 'motion/react'
import { FastForward } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Spinner } from '@/components/ui'
import { duration, easing, sec, spring } from '@/design/motion'
import { useT } from '@/i18n'
import { usePlayer } from '../store'
import { formatDelta } from '../logic/timecode'
import { MorphPlayIcon } from './MorphPlayIcon'

/** 中央大圖示：播放／暫停時彈出並淡出（path 變形） */
export function CenterFlash() {
  const flash = usePlayer((s) => s.flash)
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center" aria-hidden>
      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash.n}
            className="stage-glass grid size-[72px] place-items-center rounded-full"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1, 1.04, 1.18] }}
            transition={{
              duration: sec(duration.slower),
              ease: 'easeOut',
              times: [0, 0.25, 0.6, 1],
            }}
            onAnimationComplete={() => {
              if (usePlayer.getState().flash?.n === flash.n)
                usePlayer.getState().set({ flash: null })
            }}
          >
            <FlashIcon playing={flash.kind === 'play'} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 先顯示舊狀態，再變形成新狀態，讓使用者看到變形 */
function FlashIcon({ playing }: { playing: boolean }) {
  const [shown, setShown] = useState(!playing)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(playing))
    return () => cancelAnimationFrame(id)
  }, [playing])
  return <MorphPlayIcon playing={shown} size={34} />
}

/** 左右兩側的跳轉水波與「−10」「+10」提示 */
export function SeekRipple() {
  const t = useT()
  const ripple = usePlayer((s) => s.ripple)
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      <AnimatePresence>
        {ripple && (
          <motion.div
            key={`${ripple.side}-${ripple.n}`}
            className="absolute inset-y-0 flex w-[42%] items-center justify-center"
            style={ripple.side === 'left' ? { left: 0 } : { right: 0 }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: sec(duration.slow) } }}
          >
            <motion.span
              className="ripple-side absolute aspect-square w-[150%]"
              style={ripple.side === 'left' ? { right: '10%' } : { left: '10%' }}
              initial={{ scale: 0.4, opacity: 0.9 }}
              animate={{ scale: 1, opacity: 0.5 }}
              transition={{ duration: sec(duration.slower), ease: easing.emphasized }}
            />
            <motion.span
              className="relative flex flex-col items-center text-[22px] font-semibold tabular-nums text-[var(--stage-fg)] drop-shadow"
              initial={{ scale: 0.8, opacity: 0, x: ripple.side === 'left' ? 8 : -8 }}
              animate={{ scale: 1, opacity: 1, x: 0 }}
              transition={spring.bouncy}
            >
              <Chevrons side={ripple.side} />
              {t('player.osd.seconds', { value: formatDelta(ripple.amount) })}
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>
      <RippleAutoClear />
    </div>
  )
}

function RippleAutoClear() {
  const n = usePlayer((s) => s.ripple?.n)
  useEffect(() => {
    if (n === undefined) return
    const id = setTimeout(() => {
      if (usePlayer.getState().ripple?.n === n) usePlayer.getState().set({ ripple: null })
    }, duration.slower + duration.base)
    return () => clearTimeout(id)
  }, [n])
  return null
}

function Chevrons({ side }: { side: 'left' | 'right' }) {
  return (
    <span className="mb-0.5 flex" style={{ transform: side === 'left' ? 'scaleX(-1)' : undefined }}>
      {[0, 1, 2].map((i) => (
        <motion.svg
          key={i}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
          initial={{ opacity: 0.25 }}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: sec(duration.slower), delay: i * 0.08 }}
        >
          <path d="M8 5l9 7-9 7z" />
        </motion.svg>
      ))}
    </span>
  )
}

/** 上方中央的短暫提示（音量、速度、A–B…） */
export function Osd() {
  const osd = usePlayer((s) => s.osd)
  useEffect(() => {
    if (!osd) return
    const id = setTimeout(() => {
      if (usePlayer.getState().osd?.n === osd.n) usePlayer.getState().set({ osd: null })
    }, duration.hero + duration.slow)
    return () => clearTimeout(id)
  }, [osd])
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">
      <AnimatePresence mode="popLayout">
        {osd && (
          <motion.div
            key={osd.n}
            role="status"
            aria-live="polite"
            className="stage-glass rounded-full px-4 py-1.5 text-small font-semibold tabular-nums"
            style={
              osd.warn ? { color: 'color-mix(in srgb, var(--warning) 70%, white)' } : undefined
            }
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, transition: { duration: sec(duration.fast) } }}
            transition={spring.snappy}
          >
            {osd.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 長按 2 倍速的提示膠囊 */
export function Hold2xBadge() {
  const t = useT()
  const on = usePlayer((s) => s.holding2x)
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center">
      <AnimatePresence>
        {on && (
          <motion.div
            className="stage-glass flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-small font-semibold"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={spring.snappy}
            role="status"
          >
            <FastForward size={14} aria-hidden />
            {t('player.osd.hold2x')}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 緩衝中：風車 */
export function WaitingSpinner() {
  const waiting = usePlayer((s) => s.waiting && !s.paused)
  return (
    <AnimatePresence>
      {waiting && (
        <motion.div
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: sec(duration.base) } }}
          exit={{ opacity: 0 }}
        >
          <span className="stage-glass grid size-14 place-items-center rounded-full">
            <Spinner size={28} />
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
