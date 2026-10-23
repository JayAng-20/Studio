import { motion } from 'motion/react'
import { duration, easing, sec } from '@/design/motion'
import { cn } from '@/lib/cn'

/** 完成：勾勾描繪（約 400 ms）＋一圈擴散光環，只播一次 */
export function SuccessCheck({
  size = 40,
  className,
  halo = true,
}: {
  size?: number
  className?: string
  halo?: boolean
}) {
  return (
    <span
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
    >
      {halo && (
        <motion.span
          className="done-halo"
          initial={{ scale: 0.6, opacity: 0.8 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: sec(duration.slower), ease: easing.decelerate }}
        />
      )}
      <motion.span
        className="grid size-full place-items-center rounded-full bg-success text-white shadow-[0_6px_16px_-6px_var(--success)]"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 20 }}
      >
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" aria-hidden>
          <motion.path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: sec(duration.accent), ease: easing.emphasized, delay: 0.08 }}
          />
        </svg>
      </motion.span>
    </span>
  )
}
