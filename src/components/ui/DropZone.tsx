import { motion } from 'motion/react'
import { Upload } from 'lucide-react'
import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { filesFromDataTransfer } from '@/lib/files'
import { modKey } from '@/lib/capabilities'
import { spring, scale } from '@/design/motion'
import { useT } from '@/i18n'
import { Button } from './Button'
import { ConfirmDialog } from './Dialog'
import { dropOrigin, useFileIntake, usePasteFiles } from './useFileIntake'

interface DropZoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  /** 支援的格式說明，例如 "JPG、PNG、HEIC" */
  formats?: string
  title?: ReactNode
  illustration?: ReactNode
  className?: string
  /** 是否在整頁攔截貼上 */
  paste?: boolean
  compact?: boolean
  children?: ReactNode
  browseLabel?: string
  folder?: boolean
}

/**
 * 拖放區：靜態時虛線框緩慢流動；拖入時放大 1.01、模組色光暈、圖示彈跳、文字改成「放開以加入」。
 */
export function DropZone({
  onFiles,
  accept,
  multiple = true,
  formats,
  title,
  illustration,
  className,
  paste = true,
  compact,
  children,
  browseLabel,
  folder,
}: DropZoneProps) {
  const t = useT()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const { intake, pendingLarge, confirmLarge, cancelLarge, largeSize } = useFileIntake({
    accept,
    multiple,
    onFiles,
  })
  usePasteFiles(intake, paste)

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setOver(false)
    dropOrigin.x = e.clientX
    dropOrigin.y = e.clientY
    dropOrigin.t = performance.now()
    intake(await filesFromDataTransfer(e.dataTransfer))
  }

  return (
    <>
      <motion.div
        onDragEnter={(e) => {
          e.preventDefault()
          depth.current++
          setOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1)
          if (!depth.current) setOver(false)
        }}
        onDrop={onDrop}
        animate={{ scale: over ? scale.dropHover : 1 }}
        transition={spring.smooth}
        className={cn(
          'group relative isolate flex flex-col items-center justify-center rounded-2xl text-center',
          compact ? 'min-h-[160px] px-6 py-8' : 'min-h-[300px] px-6 py-12 sm:min-h-[360px]',
          className,
        )}
        style={{
          background: over
            ? 'color-mix(in srgb, var(--accent) 7%, var(--surface))'
            : 'color-mix(in srgb, var(--surface) 70%, transparent)',
          boxShadow: over
            ? '0 0 0 4px color-mix(in srgb, var(--accent) 16%, transparent), 0 20px 60px -20px color-mix(in srgb, var(--accent) 55%, transparent)'
            : 'var(--e1)',
          transition:
            'background var(--dur-base) var(--ease-standard), box-shadow var(--dur-base) var(--ease-standard)',
        }}
      >
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-px h-[calc(100%-2px)] w-[calc(100%-2px)] overflow-visible"
        >
          <rect
            width="100%"
            height="100%"
            rx="27"
            fill="none"
            stroke={over ? 'var(--accent)' : 'var(--border-strong)'}
            strokeWidth={over ? 2 : 1.5}
            className="dropzone-ants"
            style={{ transition: 'stroke var(--dur-base)' }}
          />
        </svg>
        <motion.div
          animate={over ? { y: [0, -10, 0], scale: [1, 1.08, 1] } : { y: 0, scale: 1 }}
          transition={over ? { duration: 0.6, repeat: Infinity, ease: 'easeInOut' } : spring.smooth}
          className="mb-4"
        >
          {illustration ?? (
            <span className="grid size-14 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
              <Upload size={26} aria-hidden />
            </span>
          )}
        </motion.div>
        <p className="text-h3 font-semibold text-text" aria-live="polite">
          {over ? t('drop.titleActive') : (title ?? t('drop.title'))}
        </p>
        <p className="mt-1 text-small text-text-3">{t('drop.or')}</p>
        <Button
          variant="primary"
          className="mt-3"
          onClick={() => input.current?.click()}
          aria-describedby={`${id}-hint`}
        >
          {browseLabel ?? t('drop.browse')}
        </Button>
        <div
          id={`${id}-hint`}
          className="mt-4 flex flex-col items-center gap-0.5 text-caption text-text-3"
        >
          {formats && <span>{t('drop.accept', { formats })}</span>}
          {paste && <span>{t('drop.paste', { shortcut: `${modKey()}+V` })}</span>}
          {folder && <span>{t('drop.folder')}</span>}
        </div>
        {children}
        <input
          ref={input}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            intake(Array.from(e.target.files || []))
            e.target.value = ''
          }}
        />
      </motion.div>
      <ConfirmDialog
        open={!!pendingLarge}
        onOpenChange={(o) => !o && cancelLarge()}
        title={t('errors.fileTooLarge', { size: largeSize })}
        description={t('errors.fileTooLargeDesc')}
        confirmLabel={t('errors.continueAnyway')}
        onConfirm={confirmLarge}
      />
    </>
  )
}

/** 小型「加入檔案」按鈕（工作畫面中再加檔案用） */
export function AddFilesButton({
  onFiles,
  accept,
  multiple = true,
  label,
  variant = 'secondary',
  size = 'md',
}: {
  onFiles: (f: File[]) => void
  accept?: string
  multiple?: boolean
  label?: string
  variant?: 'secondary' | 'ghost' | 'primary'
  size?: 'sm' | 'md'
}) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const { intake, pendingLarge, confirmLarge, cancelLarge, largeSize } = useFileIntake({
    accept,
    multiple,
    onFiles,
  })
  return (
    <>
      <Button
        variant={variant}
        size={size}
        leading={<Upload size={16} aria-hidden />}
        onClick={() => input.current?.click()}
      >
        {label ?? t('common.addMore')}
      </Button>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          intake(Array.from(e.target.files || []))
          e.target.value = ''
        }}
      />
      <ConfirmDialog
        open={!!pendingLarge}
        onOpenChange={(o) => !o && cancelLarge()}
        title={t('errors.fileTooLarge', { size: largeSize })}
        description={t('errors.fileTooLargeDesc')}
        confirmLabel={t('errors.continueAnyway')}
        onConfirm={confirmLarge}
      />
    </>
  )
}

/** 工作畫面已載入時，整個區塊仍可拖入檔案：拖入時顯示覆蓋提示 */
export function DropTarget({
  onFiles,
  accept,
  multiple = true,
  children,
  className,
}: {
  onFiles: (f: File[]) => void
  accept?: string
  multiple?: boolean
  children: ReactNode
  className?: string
}) {
  const t = useT()
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const { intake, pendingLarge, confirmLarge, cancelLarge, largeSize } = useFileIntake({
    accept,
    multiple,
    onFiles,
  })
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types || []).includes('Files')
  return (
    <div
      className={cn('relative', className)}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setOver(false)
      }}
      onDrop={async (e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current = 0
        setOver(false)
        dropOrigin.x = e.clientX
        dropOrigin.y = e.clientY
        dropOrigin.t = performance.now()
        intake(await filesFromDataTransfer(e.dataTransfer))
      }}
    >
      {children}
      {over && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-[color-mix(in_srgb,var(--accent)_10%,color-mix(in_srgb,var(--surface)_80%,transparent))] backdrop-blur-[2px]"
        >
          <span className="flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-body font-semibold shadow-e3">
            <Upload size={18} className="text-accent-ink" aria-hidden />
            {t('drop.titleActive')}
          </span>
        </motion.div>
      )}
      <ConfirmDialog
        open={!!pendingLarge}
        onOpenChange={(o) => !o && cancelLarge()}
        title={t('errors.fileTooLarge', { size: largeSize })}
        description={t('errors.fileTooLargeDesc')}
        confirmLabel={t('errors.continueAnyway')}
        onConfirm={confirmLarge}
      />
    </div>
  )
}
