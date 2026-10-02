/** 解碼器／編碼器第一次載入時的進度提示（HEIC 解碼器約 3 MB、AVIF 編碼器約 3.5 MB） */
import { AnimatePresence, motion } from 'motion/react'
import { PackageOpen } from 'lucide-react'
import { ProgressBar } from '@/components/ui'
import { spring } from '@/design/motion'
import { formatBytes } from '@/lib/format'
import { useT, type TKey } from '@/i18n'
import { useConvert, type LoadState } from '../store'
import type { CodecId } from '../types'

/** 只顯示體積較大、等待感明顯的載入 */
const SHOWN: CodecId[] = ['avif', 'avif-dec', 'mozjpeg', 'webp', 'oxipng']

export function LoaderBanner() {
  const t = useT()
  const heic = useConvert((s) => s.heic)
  const codecs = useConvert((s) => s.codecs)
  const rows: Array<{ key: string; label: string; s: LoadState }> = []
  if (heic.state === 'loading') rows.push({ key: 'heic', label: t('convert.loader.heic'), s: heic })
  for (const c of SHOWN) {
    const s = codecs[c]
    if (s?.state === 'loading') rows.push({ key: c, label: t(`convert.loader.codec.${c}` as TKey), s })
  }
  return (
    <AnimatePresence initial={false}>
      {rows.map(({ key, label, s }) => {
        const p = s.total ? s.loaded / s.total : null
        return (
          <motion.div
            key={key}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={spring.smooth}
            role="status"
            aria-live="polite"
            className="card flex items-center gap-3 px-4 py-3"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
              <PackageOpen size={18} aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-small font-medium text-text">{label}</p>
                <span className="shrink-0 text-caption tabular-nums text-text-3">
                  {s.total ? `${formatBytes(s.loaded)}／${formatBytes(s.total)}` : formatBytes(s.loaded)}
                </span>
              </div>
              <ProgressBar value={p} size="sm" label={label} />
            </div>
          </motion.div>
        )
      })}
    </AnimatePresence>
  )
}
