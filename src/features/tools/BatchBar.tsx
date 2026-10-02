/**
 * 工作區內的批次狀態：處理中（進度條＋取消）→ 完成（勾勾＋總大小＋下載 ZIP）。
 * 同一個膠囊以 layout 彈簧變形，6 秒後自動收起。
 */
import { AnimatePresence, motion } from 'motion/react'
import { Archive, X } from 'lucide-react'
import { useEffect } from 'react'
import { Button, ProgressBar, SuccessCheck } from '@/components/ui'
import { spring } from '@/design/motion'
import { useT } from '@/i18n'
import { downloadAllZip } from './actions'
import { resetBatch, useBatch } from './batch'

const DONE_HIDE_MS = 6000

export function BatchBar() {
  const t = useT()
  const b = useBatch()
  useEffect(() => {
    if (b.status !== 'done') return
    const id = setTimeout(resetBatch, DONE_HIDE_MS)
    return () => clearTimeout(id)
  }, [b.status])

  return (
    <div
      className="pointer-events-none absolute inset-x-3 bottom-3 z-30 flex justify-center"
      aria-live="polite"
    >
      <AnimatePresence>
        {b.status !== 'idle' && (
          <motion.div
            layout
            key="batch"
            className="floating pointer-events-auto flex min-h-12 w-full max-w-md items-center gap-3 rounded-full py-1.5 pl-3 pr-1.5"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={spring.smooth}
          >
            {b.status === 'running' ? (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-small font-medium text-text">{b.label}</p>
                  <ProgressBar value={b.progress} size="sm" className="mt-1" label={b.label} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    b.controller?.abort()
                    resetBatch()
                  }}
                >
                  {t('tools.batch.cancel')}
                </Button>
              </>
            ) : (
              <>
                <SuccessCheck size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-small font-semibold text-text">{b.label}</p>
                  {b.summary && (
                    <p className="truncate text-caption tabular-nums text-text-3">{b.summary}</p>
                  )}
                </div>
                {b.offerZip && (
                  <Button
                    variant="primary"
                    size="sm"
                    leading={<Archive size={14} aria-hidden />}
                    onClick={() => {
                      resetBatch()
                      void downloadAllZip()
                    }}
                  >
                    {t('tools.batch.downloadZip')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('common.close')}
                  onClick={resetBatch}
                >
                  <X size={16} aria-hidden />
                </Button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
