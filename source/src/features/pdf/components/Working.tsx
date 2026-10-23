import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, ProgressBar } from '@/components/ui'
import { useT } from '@/i18n'

/** 處理中卡片：視覺（例如疊紙動畫）＋進度條＋取消；aria-live 回報進度 */
export function Working({
  title,
  progress,
  onCancel,
  children,
  detail,
}: {
  title: string
  progress: number | null
  onCancel?: () => void
  children?: ReactNode
  detail?: ReactNode
}) {
  const t = useT()
  const pct = progress === null ? null : Math.round(progress * 100)
  return (
    <section className="card flex flex-col items-center gap-5 px-5 py-8 text-center sm:px-8">
      {children}
      <div className="w-full max-w-md">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-h3 font-semibold">{title}</h3>
          {pct !== null && <span className="text-small tabular-nums text-text-2">{pct}%</span>}
        </div>
        <ProgressBar value={progress} label={title} />
        {detail && <p className="mt-2 text-left text-small text-text-3">{detail}</p>}
        <p className="sr-only" aria-live="polite">
          {pct !== null ? t('pdf.working.progress', { title, percent: pct }) : title}
        </p>
      </div>
      {onCancel && (
        <Button variant="secondary" leading={<X size={16} aria-hidden />} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      )}
    </section>
  )
}
