import { motion } from 'motion/react'
import { Download, FileArchive, FileText, RotateCcw } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, FileName, SuccessCheck, Tooltip, toast } from '@/components/ui'
import { duration, sec, spring, staggerDelay } from '@/design/motion'
import { createZip } from '@/lib/zip'
import { saveLargeBlob } from '@/lib/download'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { destroyDoc, openPdf, renderToCanvas } from '../lib/pdfjs'
import { canvasToBlob, releaseCanvas } from '@/lib/image'

export interface ResultFile {
  blob: Blob
  name: string
}

/** 結果預覽：PDF 渲染第一頁；圖片直接顯示 */
function usePreview(file: ResultFile | undefined, skip: boolean) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file || skip) return
    let alive = true
    let made: string | null = null
    const run = async () => {
      if (file.blob.type.startsWith('image/')) {
        made = URL.createObjectURL(file.blob)
      } else {
        const { doc } = await openPdf(new Uint8Array(await file.blob.arrayBuffer()))
        try {
          const page = await doc.getPage(1)
          const vp = page.getViewport({ scale: 1 })
          const canvas = await renderToCanvas(page, 280 / vp.width)
          try {
            made = URL.createObjectURL(await canvasToBlob(canvas, 'image/jpeg', 0.85))
          } finally {
            releaseCanvas(canvas)
            page.cleanup()
          }
        } finally {
          void destroyDoc(doc)
        }
      }
      if (alive) setUrl(made)
      else if (made) URL.revokeObjectURL(made)
    }
    run().catch((e) => console.error(e))
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [file, skip])
  return url
}

/**
 * 結果卡：紙張從上方飛入、完成勾勾；單檔直接下載，多檔可打包 ZIP 或逐一下載。
 */
export function ResultCard({
  files,
  title,
  summary,
  zipName,
  onReset,
  resetLabel,
  actions,
  children,
  paperLayoutId,
  previewUrl,
}: {
  files: ResultFile[]
  title?: string
  summary?: ReactNode
  zipName?: string
  onReset?: () => void
  resetLabel?: string
  actions?: ReactNode
  children?: ReactNode
  /** 與處理中畫面的紙張共用 layoutId（合併的疊牌飛入結果卡） */
  paperLayoutId?: string
  /** 自備的預覽圖（例如長圖的縮小版，避免解碼整張巨圖） */
  previewUrl?: string
}) {
  const t = useT()
  const computed = usePreview(files[0], !!previewUrl)
  const preview = previewUrl ?? computed
  const [zipping, setZipping] = useState(false)
  const total = files.reduce((n, f) => n + f.blob.size, 0)
  const download = async (f: ResultFile) => {
    const ok = await saveLargeBlob(f.blob, f.name)
    if (ok) toast.success(t('pdf.result.downloaded'), { description: f.name })
  }
  const downloadZip = async () => {
    setZipping(true)
    try {
      const zip = await createZip(files.map((f) => ({ name: f.name, data: f.blob })))
      await saveLargeBlob(zip, zipName ?? 'pdf.zip')
    } catch (e) {
      console.error(e)
      toast.error(t('pdf.errors.zipFailed'), { description: t('pdf.errors.zipFailedDesc') })
    } finally {
      setZipping(false)
    }
  }
  const multi = files.length > 1
  return (
    <section
      className="card relative mx-auto w-full max-w-4xl overflow-hidden p-5 sm:p-6"
      aria-live="polite"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-60"
        style={{
          background:
            'radial-gradient(60% 100% at 20% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent)',
        }}
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="relative mx-auto shrink-0 sm:mx-0" style={{ perspective: 800 }}>
          {multi && (
            <>
              <span
                aria-hidden
                className="absolute inset-0 translate-x-2.5 translate-y-1.5 rotate-[6deg] rounded-sm border border-border bg-surface shadow-e1"
              />
              <span
                aria-hidden
                className="absolute inset-0 translate-x-1 translate-y-0.5 rotate-[3deg] rounded-sm border border-border bg-surface shadow-e1"
              />
            </>
          )}
          <motion.div
            layoutId={paperLayoutId}
            initial={paperLayoutId ? false : { y: -90, rotate: -16, scale: 0.6, opacity: 0 }}
            animate={{ y: 0, rotate: -2, scale: 1, opacity: 1 }}
            transition={{ ...spring.bouncy, opacity: { duration: sec(duration.fast) } }}
            className="relative grid h-[148px] w-[112px] place-items-center overflow-hidden rounded-sm border border-border bg-white shadow-e3"
          >
            {preview ? (
              <img src={preview} alt="" className="size-full object-contain object-top" />
            ) : (
              <FileText size={32} className="text-text-3" aria-hidden />
            )}
          </motion.div>
          <span className="absolute -bottom-3 -right-3">
            <SuccessCheck size={36} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-h2 font-semibold">{title ?? t('pdf.result.title')}</h3>
          <p className="mt-1 text-body text-text-2">
            {summary ??
              (multi
                ? t('pdf.result.summaryMulti', { count: files.length, size: formatBytes(total) })
                : t('pdf.result.summaryOne', { size: formatBytes(total) }))}
          </p>
          {children && <div className="mt-3">{children}</div>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {multi ? (
              <Button
                variant="primary"
                leading={<FileArchive size={16} aria-hidden />}
                loading={zipping}
                onClick={downloadZip}
              >
                {t('common.downloadZip')}
              </Button>
            ) : (
              <Button
                variant="primary"
                leading={<Download size={16} aria-hidden />}
                onClick={() => download(files[0])}
              >
                {t('common.download')}
              </Button>
            )}
            {actions}
            {onReset && (
              <Button
                variant="ghost"
                leading={<RotateCcw size={16} aria-hidden />}
                onClick={onReset}
              >
                {resetLabel ?? t('pdf.result.again')}
              </Button>
            )}
          </div>
        </div>
      </div>
      {multi && (
        <ul className="relative mt-5 grid gap-1.5 border-t border-border pt-4 sm:grid-cols-2">
          {files.map((f, i) => (
            <motion.li
              key={f.name + i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.smooth, delay: staggerDelay(i, 0.15) }}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-md py-1 pl-3 pr-1',
                'bg-[color-mix(in_srgb,var(--text)_3%,transparent)]',
              )}
            >
              <FileName name={f.name} className="min-w-0 flex-1 text-small" />
              <span className="shrink-0 text-caption tabular-nums text-text-3">
                {formatBytes(f.blob.size)}
              </span>
              <Tooltip content={t('common.download')}>
                <Button
                  icon
                  size="sm"
                  variant="ghost"
                  aria-label={`${t('common.download')} ${f.name}`}
                  onClick={() => download(f)}
                >
                  <Download size={15} aria-hidden />
                </Button>
              </Tooltip>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  )
}
