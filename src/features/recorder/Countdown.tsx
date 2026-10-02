/** 3‑2‑1 倒數：大數字彈簧縮放＋環形倒數，可取消（Esc） */
import { AnimatePresence, motion } from 'motion/react'
import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import { Button, Kbd } from '@/components/ui'
import { duration, easing, sec, spring } from '@/design/motion'
import { useT } from '@/i18n'
import { COUNTDOWN_SECONDS } from './core'
import { cancelCountdown, startNow, useRecorder } from './engine'

const R = 92
const C = 2 * Math.PI * R

export function CountdownOverlay() {
  const t = useT()
  const stage = useRecorder((s) => s.stage)
  const n = useRecorder((s) => s.countdown)
  const open = stage === 'countdown'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelCountdown()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="countdown"
          role="dialog"
          aria-modal="true"
          aria-label={t('recorder.countdown.label', { n })}
          className="fixed inset-0 z-[75] grid place-items-center bg-[rgba(10,12,16,.42)] backdrop-blur-[10px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: sec(duration.fast) } }}
          transition={{ duration: sec(duration.base), ease: easing.standard }}
        >
          <div className="flex flex-col items-center gap-8">
            <div className="relative grid size-[220px] place-items-center">
              {/* 環形倒數：3 秒內線性收起 */}
              <svg
                width={220}
                height={220}
                viewBox="0 0 220 220"
                className="absolute inset-0 -rotate-90"
                aria-hidden
              >
                <circle
                  cx={110}
                  cy={110}
                  r={R}
                  fill="none"
                  stroke="rgba(255,255,255,.16)"
                  strokeWidth={8}
                />
                <motion.circle
                  cx={110}
                  cy={110}
                  r={R}
                  fill="none"
                  stroke="var(--accent-2)"
                  strokeWidth={8}
                  strokeLinecap="round"
                  strokeDasharray={C}
                  initial={{ strokeDashoffset: 0 }}
                  animate={{ strokeDashoffset: C }}
                  transition={{ duration: COUNTDOWN_SECONDS, ease: 'linear' }}
                />
              </svg>
              <span
                aria-hidden
                className="absolute inset-[34px] rounded-full bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] blur-xl"
              />
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={n}
                  className="relative text-[112px] font-bold leading-none tracking-[-0.04em] text-white tabular-nums drop-shadow-[0_8px_24px_rgba(0,0,0,.35)]"
                  initial={{ opacity: 0, scale: 1.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5, transition: { duration: sec(duration.fast) } }}
                  transition={spring.bouncy}
                >
                  {n}
                </motion.span>
              </AnimatePresence>
            </div>
            <p className="sr-only" aria-live="assertive">
              {t('recorder.a11y.countdown', { n })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={cancelCountdown}
                className="border-white/20! bg-white/10! text-white! hover:bg-white/20!"
              >
                {t('recorder.countdown.cancel')}
              </Button>
              <Button variant="primary" onClick={startNow} autoFocus>
                {t('recorder.countdown.startNow')}
              </Button>
            </div>
            <p className="-mt-4 flex items-center gap-1.5 text-caption text-white/70 pointer-coarse:hidden">
              <Kbd>Esc</Kbd>
              {t('recorder.countdown.hint')}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
