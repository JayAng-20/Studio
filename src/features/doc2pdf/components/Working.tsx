import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { Button, ProgressBar } from '@/components/ui'
import { spring } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'

const LINES = [0.62, 1, 0.94, 0.98, 0.7, 0, 1, 0.9, 0.96, 0.55, 0, 0.82, 1, 0.66]

/** 招牌動畫：紙張上的文字一行一行排上去（依進度），目前這一行持續打字 */
export function TypesetPaper({ progress, layoutId }: { progress: number; layoutId?: string }) {
  const filled = Math.floor(progress * LINES.length)
  return (
    <motion.div
      layoutId={layoutId}
      initial={{ y: 12, opacity: 0, rotate: -3 }}
      animate={{ y: 0, opacity: 1, rotate: -2 }}
      transition={spring.gentle}
      className="d2p-paper relative h-[164px] w-[124px] overflow-hidden rounded-[3px] border border-black/10 px-3 py-3.5 shadow-e3"
      aria-hidden
    >
      <span className="mb-2 block h-[7px] w-[64%] rounded-[2px] bg-[color-mix(in_srgb,var(--accent)_80%,#000)]" />
      <span className="mb-2 block h-px w-full bg-black/10" />
      <span className="flex flex-col gap-[5px]">
        {LINES.map((w, i) =>
          w === 0 ? (
            <span key={i} className="block h-[3px]" />
          ) : (
            <span key={i} className="relative block h-[3px] rounded-full bg-black/[0.05]" style={{ width: `${w * 100}%` }}>
              <motion.span
                className={cn('absolute inset-0 origin-left rounded-full bg-black/35', i === filled && 'd2p-typing')}
                initial={false}
                animate={i === filled ? undefined : { scaleX: i < filled ? 1 : 0 }}
                transition={spring.smooth}
              />
            </span>
          ),
        )}
      </span>
    </motion.div>
  )
}

export function WorkingCard({
  title,
  detail,
  progress,
  onCancel,
}: {
  title: string
  detail?: string
  progress: number
  onCancel: () => void
}) {
  const t = useT()
  const pct = Math.round(progress * 100)
  return (
    <section className="card flex flex-col items-center gap-7 px-5 py-10 text-center sm:px-8 sm:py-12">
      <TypesetPaper progress={progress} layoutId="d2p-paper" />
      <div className="w-full max-w-md">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-h3 font-semibold">{title}</h3>
          <span className="text-small tabular-nums text-text-2">{pct}%</span>
        </div>
        <ProgressBar value={progress} label={title} />
        <p className="mt-2 min-h-5 truncate text-left text-small tabular-nums text-text-3">{detail}</p>
        <p className="sr-only" aria-live="polite">
          {t('doc2pdf.working.progress', { title, percent: Math.round(pct / 10) * 10 })}
        </p>
      </div>
      <Button variant="secondary" leading={<X size={16} aria-hidden />} onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </section>
  )
}
