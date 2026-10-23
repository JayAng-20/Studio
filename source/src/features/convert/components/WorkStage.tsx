/** 工作畫面：載入提示、批次摘要、工具列、檔案卡清單（可再拖入、貼上、加入資料夾） */
import { AnimatePresence, motion } from 'motion/react'
import { FolderPlus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  AddFilesButton,
  Button,
  ConfirmDialog,
  DropTarget,
  Tooltip,
  useFileIntake,
  usePasteFiles,
} from '@/components/ui'
import { duration, sec, spring, staggerDelay } from '@/design/motion'
import { formatBytes } from '@/lib/format'
import { useT } from '@/i18n'
import { useConvert } from '../store'
import { optionsKey } from '../options'
import { ItemCard } from './ItemCard'
import { LoaderBanner } from './LoaderBanner'
import { SummaryBar } from './SummaryBar'

export const ACCEPT = 'image/*,.heic,.heif,.avif,.svg,.jfif,.webp,.bmp,.gif,.png,.jpg,.jpeg,.ico'

const folderSupported = () =>
  typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input')

/** 選擇資料夾（支援時顯示）：只取圖片檔 */
export function AddFolderButton({
  onFiles,
  compact,
}: {
  onFiles: (f: File[]) => void
  compact?: boolean
}) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const { intake } = useFileIntake({ accept: ACCEPT, onFiles })
  if (!folderSupported()) return null
  const dirAttrs = { webkitdirectory: '', directory: '' } as Record<string, string>
  const btn = (
    <Button
      variant="secondary"
      size="md"
      icon={compact}
      aria-label={compact ? t('convert.work.addFolder') : undefined}
      leading={compact ? undefined : <FolderPlus size={16} aria-hidden />}
      onClick={() => input.current?.click()}
    >
      {compact ? <FolderPlus size={16} aria-hidden /> : t('convert.work.addFolder')}
    </Button>
  )
  return (
    <>
      {compact ? <Tooltip content={t('convert.work.addFolder')}>{btn}</Tooltip> : btn}
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        {...dirAttrs}
        onChange={(e) => {
          // 資料夾裡的非圖片檔直接略過，不逐一提示
          const all = Array.from(e.target.files || [])
          const images = all.filter(
            (f) =>
              /^image\//.test(f.type) ||
              /\.(heic|heif|avif|svg|jfif|webp|bmp|gif|png|jpe?g|ico)$/i.test(f.name),
          )
          intake(images)
          e.target.value = ''
        }}
      />
    </>
  )
}

export function WorkStage({
  onFiles,
  onCompare,
  onRetry,
  onRetryFailed,
}: {
  onFiles: (files: File[]) => void
  onCompare: (id: string) => void
  onRetry: (id: string) => void
  onRetryFailed: () => void
}) {
  const t = useT()
  const items = useConvert((s) => s.items)
  const running = useConvert((s) => s.running)
  const options = useConvert((s) => s.options)
  const clear = useConvert((s) => s.clear)
  const [confirmClear, setConfirmClear] = useState(false)
  const key = optionsKey(options)
  const total = items.reduce((a, x) => a + x.size, 0)
  const showSummary = running || items.some((x) => x.status === 'done')
  const { intake } = useFileIntake({ accept: ACCEPT, onFiles })
  usePasteFiles(intake)

  return (
    <DropTarget onFiles={onFiles} accept={ACCEPT}>
      <div className="@container flex flex-col gap-4">
        <LoaderBanner />
        <AnimatePresence initial={false}>
          {showSummary && (
            <motion.div
              key="summary"
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: sec(duration.fast) } }}
              transition={spring.smooth}
            >
              <SummaryBar onRetryFailed={onRetryFailed} />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          layout="position"
          transition={spring.smooth}
          className="flex flex-wrap items-center gap-2"
        >
          <p className="mr-auto text-small text-text-2" aria-live="polite">
            <span className="font-semibold text-text">
              {t('common.fileCount', { count: items.length })}
            </span>
            <span className="text-text-3"> · {formatBytes(total)}</span>
          </p>
          <AddFilesButton onFiles={onFiles} accept={ACCEPT} label={t('convert.work.add')} />
          <AddFolderButton onFiles={onFiles} compact />
          <Tooltip content={t('common.clearAll')}>
            <Button
              variant="ghost"
              icon
              aria-label={t('common.clearAll')}
              disabled={!items.length}
              onClick={() => (items.length > 1 ? setConfirmClear(true) : clear())}
              className="hover:text-danger-ink"
            >
              <Trash2 size={16} aria-hidden />
            </Button>
          </Tooltip>
        </motion.div>

        <ul aria-label={t('a11y.fileList')} className="grid gap-3 @[640px]:grid-cols-2">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((it, i) => (
              <motion.li
                key={it.id}
                layout
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, transition: { duration: sec(duration.fast) } }}
                transition={{
                  ...spring.smooth,
                  delay: it.status === 'idle' && !it.thumb ? staggerDelay(i % 12) : 0,
                }}
                className="min-w-0"
              >
                <ItemCard item={it} freshKey={key} onCompare={onCompare} onRetry={onRetry} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('convert.work.clearTitle')}
        description={t('convert.work.clearDesc', { count: items.length })}
        confirmLabel={t('common.clearAll')}
        danger
        onConfirm={clear}
      />
    </DropTarget>
  )
}
