import { Layers } from 'lucide-react'
import { Button } from '@/components/ui'

/** 「套用到全部」：批次套用並在任務中心處理 */
export function ApplyAllButton({
  onClick,
  label,
  hint,
}: {
  onClick: () => void
  label: string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="secondary"
        leading={<Layers size={16} aria-hidden />}
        onClick={onClick}
        className="w-full"
      >
        {label}
      </Button>
      {hint && <p className="text-caption text-text-3">{hint}</p>}
    </div>
  )
}
