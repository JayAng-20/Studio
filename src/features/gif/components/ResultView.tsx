import { motion } from 'motion/react'
import { Download, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { AnimatedNumber, Button, CopyButton, SuccessCheck } from '@/components/ui'
import { formatBytes, formatTime } from '@/lib/format'
import { saveLargeBlob } from '@/lib/download'
import { spring, staggerDelay } from '@/design/motion'
import { useGT } from '../useGT'
import type { GifResult } from '../store'

/** 剪貼簿能否寫入 GIF（能力偵測；目前多數瀏覽器只接受 PNG） */
function canCopyGif(): boolean {
  const CI = (globalThis as unknown as { ClipboardItem?: { supports?: (t: string) => boolean } })
    .ClipboardItem
  if (!CI || !navigator.clipboard?.write) return false
  return typeof CI.supports === 'function' ? CI.supports('image/gif') : false
}

/** 完成：GIF 預覽（由膠卷位置以彈簧放大而來）、大小／尺寸／時長；下載、複製、再調整 */
export function ResultView({
  result,
  onAdjust,
  onStartOver,
}: {
  result: GifResult
  onAdjust: () => void
  onStartOver: () => void
}) {
  const t = useGT()
  const copyable = result.format === 'gif' && canCopyGif()
  const copyReason = result.format !== 'gif' ? t('errors.copyUnsupportedFormat') : t('errors.copyUnsupported')
  const ratio = result.width / result.height
  const merged = result.frames < result.planned ? result.planned - result.frames : 0

  const stats: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: t('result.size'),
      value: <AnimatedNumber value={result.blob.size} format={(v) => formatBytes(v)} />,
    },
    { label: t('result.dimensions'), value: `${result.width} × ${result.height}` },
    { label: t('result.duration'), value: formatTime(result.durationMs / 1000, { tenths: true }) },
    {
      label: t('result.frames'),
      value: merged ? t('result.framesMerged', { written: result.frames, merged }) : String(result.frames),
    },
  ]

  return (
    <section className="card p-4 sm:p-6" aria-labelledby="gif-result-title">
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex justify-center">
          <motion.div
            layoutId="gif-hero"
            transition={spring.smooth}
            className="gif-checker relative overflow-hidden rounded-xl shadow-e3 ring-1 ring-border"
            style={{
              width: `min(100%, calc(min(60vh, 560px) * ${ratio}))`,
              aspectRatio: `${result.width} / ${result.height}`,
            }}
          >
            <img src={result.url} alt={t('result.alt')} className="absolute inset-0 size-full object-contain" />
          </motion.div>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex items-center gap-3">
            <SuccessCheck size={40} />
            <div className="min-w-0">
              <h2 id="gif-result-title" className="text-h2 font-semibold">
                {t('done')}
              </h2>
              <p className="truncate text-small text-text-3" title={result.name}>
                {result.name}
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring.smooth, delay: staggerDelay(i, 0.15) }}
                className="flex min-w-0 flex-col gap-0.5 rounded-md bg-surface-2 px-3 py-2.5"
              >
                <dt className="text-caption text-text-3">{s.label}</dt>
                <dd className="text-body font-semibold tabular-nums text-text">{s.value}</dd>
              </motion.div>
            ))}
          </dl>
          <p className="-mt-2 text-caption text-text-3">
            {result.estimated ? `${t('result.estimated', { value: formatBytes(result.estimated) })} · ` : ''}
            {t('result.elapsed', { value: (result.elapsedMs / 1000).toFixed(1) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="lg"
              leading={<Download size={18} aria-hidden />}
              onClick={() => saveLargeBlob(result.blob, result.name)}
              className="max-sm:flex-1"
            >
              {t('actions.download')}
            </Button>
            <CopyButton
                  size="lg"
                  label={t('actions.copy')}
                  disabled={!copyable}
                  aria-disabled={!copyable || undefined}
                  onCopy={async () => {
                    try {
                      await navigator.clipboard.write([new ClipboardItem({ 'image/gif': result.blob })])
                      return true
                    } catch (e) {
                      console.error(e)
                      return false
                    }
                  }}
                />
          </div>
          {!copyable && <p className="-mt-3 text-caption text-text-3">{copyReason}</p>}
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button variant="secondary" leading={<SlidersHorizontal size={16} aria-hidden />} onClick={onAdjust}>
              {t('actions.adjust')}
            </Button>
            <Button variant="ghost" leading={<RotateCcw size={16} aria-hidden />} onClick={onStartOver}>
              {t('actions.startOver')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
