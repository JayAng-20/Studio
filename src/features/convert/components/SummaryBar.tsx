/** 批次摘要：轉換中顯示整體進度與取消；完成後顯示總節省量與下載／傳送 */
import { motion } from 'motion/react'
import { Archive, Download, RotateCcw, Square } from 'lucide-react'
import { Badge, Button, ProgressBar, SendToMenu } from '@/components/ui'
import { spring } from '@/design/motion'
import { formatBytes, percentChange } from '@/lib/format'
import { asFile } from '@/stores/fileBus'
import { useTask } from '@/stores/tasks'
import { useT } from '@/i18n'
import { useConvert } from '../store'
import { doneItems, downloadResults } from '../actions'
import { CountUp, DoneCheck, SavingsBadge } from './bits'

export function SummaryBar({ onRetryFailed }: { onRetryFailed: () => void }) {
  const t = useT()
  const run = useTask('convert')
  const items = useConvert((s) => s.items)
  const running = useConvert((s) => s.running)
  const cancel = useConvert((s) => s.cancel)
  const markDelivered = useConvert((s) => s.markDelivered)
  const done = doneItems(items)
  const active = items.filter((x) => x.status === 'queued' || x.status === 'running')
  const failed = items.filter((x) => x.status === 'error' && x.thumbState !== 'error')
  const before = done.reduce((a, x) => a + x.size, 0)
  const after = done.reduce((a, x) => a + x.result.size, 0)
  const pct = percentChange(before, after)
  const overall = active.length
    ? (done.length + active.reduce((a, x) => a + x.progress, 0)) / (done.length + active.length)
    : 1
  const batchKey = done.map((x) => x.result.at).join('|')

  return (
    <motion.section
      layout
      transition={spring.smooth}
      aria-label={t('convert.summary.label')}
      className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
    >
      {running ? (
        <div className="flex min-w-0 flex-1 flex-col gap-2" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-body font-semibold text-text">
              {t('convert.summary.running', { done: done.length, total: done.length + active.length })}
            </p>
            <span className="text-small tabular-nums text-text-2">{Math.round(overall * 100)}%</span>
          </div>
          <ProgressBar value={overall} label={t('convert.summary.label')} />
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <DoneCheck id={`batch:${batchKey}`} size={36} />
          <div className="min-w-0">
            <p className="text-body font-semibold text-text" aria-live="polite">
              {t('convert.summary.done', { count: done.length })}
              {failed.length > 0 && (
                <span className="ml-2 font-normal text-danger-ink">{t('convert.summary.failed', { count: failed.length })}</span>
              )}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small tabular-nums text-text-2">
              <span>
                {formatBytes(before)} →{' '}
                <CountUp value={after} format={(v) => formatBytes(v)} onceKey={`sum:${batchKey}`} className="font-semibold text-text" />
              </span>
              {done.length > 0 && <SavingsBadge pct={pct} onceKey={`sumpct:${batchKey}`} />}
              {before - after > 0 && (
                <Badge tone="neutral" className="max-sm:hidden">
                  {t('convert.summary.savedBytes', { size: formatBytes(before - after) })}
                </Badge>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {running ? (
          <Button variant="secondary" leading={<Square size={14} aria-hidden />} onClick={cancel}>
            {t('common.cancel')}
          </Button>
        ) : (
          <>
            {failed.length > 0 && (
              <Button variant="ghost" leading={<RotateCcw size={16} aria-hidden />} onClick={onRetryFailed}>
                {t('convert.summary.retryFailed')}
              </Button>
            )}
            {done.length > 0 && (
              <SendToMenu
                from="convert"
                targets={['tools']}
                getFiles={() => {
                  markDelivered()
                  return done.map((x) => asFile(x.result.blob, x.result.name))
                }}
              />
            )}
            {done.length > 0 && (
              <Button
                variant="primary"
                leading={done.length > 1 ? <Archive size={16} aria-hidden /> : <Download size={16} aria-hidden />}
                onClick={() => void downloadResults(run, items)}
              >
                {done.length > 1 ? t('convert.summary.downloadZip') : t('common.download')}
              </Button>
            )}
          </>
        )}
      </div>
    </motion.section>
  )
}
