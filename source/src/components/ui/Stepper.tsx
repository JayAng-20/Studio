import { Check } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { spring } from '@/design/motion'
import { useT } from '@/i18n'

/** 步驟指示：讓使用者知道自己在哪一步 */
export function Stepper({
  steps,
  current,
  className,
}: {
  steps: string[]
  current: number
  className?: string
}) {
  const t = useT()
  return (
    <ol
      aria-label={t('common.step', { current: current + 1, total: steps.length })}
      className={cn('flex items-center gap-2', className)}
    >
      {steps.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <li
            key={s}
            aria-current={active ? 'step' : undefined}
            className="flex min-w-0 items-center gap-2"
          >
            <span
              className={cn(
                'relative grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold transition-colors duration-(--dur-base)',
                done && 'bg-accent text-white',
                active && 'bg-accent-strong text-white',
                !done &&
                  !active &&
                  'bg-[color-mix(in_srgb,var(--text)_8%,transparent)] text-text-3',
              )}
            >
              {done ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={spring.bouncy}
                >
                  <Check size={13} strokeWidth={3} aria-hidden />
                </motion.span>
              ) : (
                i + 1
              )}
            </span>
            <span
              className={cn(
                'truncate text-small',
                active ? 'font-semibold text-text' : 'text-text-3',
                'max-sm:hidden',
                active && 'max-sm:inline',
              )}
            >
              {s}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn('h-px w-6 shrink-0 sm:w-10', done ? 'bg-accent' : 'bg-border-strong')}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
