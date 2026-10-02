import { motion } from 'motion/react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  FileText,
  RotateCcw,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Callout,
  Dialog,
  FileName,
  Skeleton,
  SuccessCheck,
  Tooltip,
  toast,
} from '@/components/ui'
import { duration, sec, spring, staggerDelay } from '@/design/motion'
import { saveLargeBlob } from '@/lib/download'
import { formatBytes } from '@/lib/format'
import { createZip } from '@/lib/zip'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { closePreview, openPreview, renderPage, type PreviewDoc } from '../lib/preview'
import type { Output } from '../store'

const FIRST_PAGES = 8

interface Thumb {
  url: string
  ratio: number
}

/**
 * 預覽某一份 PDF：開啟後依序渲染縮圖（先前幾頁，展開後渲染全部）。
 * 由呼叫端以 key 綁定輸出檔，換檔時整個重建，狀態自然歸零。
 */
function usePreview(output: Output, limit: number) {
  const [doc, setDoc] = useState<PreviewDoc | null>(null)
  const [thumbs, setThumbs] = useState<Record<number, Thumb>>({})
  const [failed, setFailed] = useState(false)
  const rendered = useRef(new Set<number>())
  const urls = useRef<string[]>([])

  useEffect(() => {
    let alive = true
    let opened: PreviewDoc | null = null
    void (async () => {
      try {
        const d = await openPreview(new Uint8Array(await output.blob.arrayBuffer()))
        opened = d
        if (alive) setDoc(d)
        else void closePreview(d)
      } catch (e) {
        console.error(e)
        if (alive) setFailed(true)
      }
    })()
    const made = urls.current
    return () => {
      alive = false
      void closePreview(opened)
      made.forEach((u) => URL.revokeObjectURL(u))
      made.length = 0
    }
  }, [output])

  useEffect(() => {
    if (!doc) return
    let alive = true
    void (async () => {
      for (let i = 0; i < Math.min(limit, output.pages); i++) {
        if (!alive) return
        // 只記錄「已完成」的頁：被中斷的渲染下次會重來
        if (rendered.current.has(i)) continue
        try {
          const r = await renderPage(doc, i + 1, 220)
          if (!alive) {
            URL.revokeObjectURL(r.url)
            return
          }
          rendered.current.add(i)
          urls.current.push(r.url)
          setThumbs((prev) => ({ ...prev, [i]: r }))
        } catch (e) {
          console.error(e)
          if (alive) setFailed(true)
          return
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [doc, limit, output.pages])

  const renderLarge = useCallback(
    async (page: number, width: number) => {
      if (!doc) throw new Error('no doc')
      return renderPage(doc, page, width)
    },
    [doc],
  )

  return { thumbs, failed, renderLarge }
}

export function Result({
  outputs,
  onEdit,
  onReset,
}: {
  outputs: Output[]
  onEdit: () => void
  onReset: () => void
}) {
  const t = useT()
  const [sel, setSel] = useState(0)
  const [zipping, setZipping] = useState(false)
  const output = outputs[Math.min(sel, outputs.length - 1)]
  const totalPages = outputs.reduce((s, o) => s + o.pages, 0)
  const totalSize = outputs.reduce((s, o) => s + o.blob.size, 0)
  const missing = outputs.reduce((s, o) => s + o.missing, 0)
  const multi = outputs.length > 1

  const download = async (o: Output) => {
    const ok = await saveLargeBlob(o.blob, o.name)
    if (ok) toast.success(t('doc2pdf.result.downloaded'), { description: o.name })
  }
  const downloadZip = async () => {
    setZipping(true)
    try {
      const zip = await createZip(outputs.map((o) => ({ name: o.name, data: o.blob })))
      await saveLargeBlob(zip, `${t('doc2pdf.result.zipName')}.zip`)
    } catch (e) {
      console.error(e)
      toast.error(t('doc2pdf.errors.zip'), { description: t('doc2pdf.errors.zipDesc') })
    } finally {
      setZipping(false)
    }
  }

  return (
    <section className="card relative overflow-hidden p-5 sm:p-6" aria-live="polite">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-36 opacity-70"
        style={{
          background:
            'radial-gradient(60% 100% at 18% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent)',
        }}
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
        {/* 招牌動畫：紙張飛入結果卡 */}
        <div className="relative mx-auto shrink-0 sm:mx-0">
          {multi && (
            <>
              <span
                aria-hidden
                className="d2p-paper absolute inset-0 translate-x-2.5 translate-y-1.5 rotate-[6deg] rounded-[3px] border border-black/10 shadow-e1"
              />
              <span
                aria-hidden
                className="d2p-paper absolute inset-0 translate-x-1 translate-y-0.5 rotate-[3deg] rounded-[3px] border border-black/10 shadow-e1"
              />
            </>
          )}
          <motion.div
            layoutId="d2p-paper"
            initial={{ y: -80, rotate: -14, scale: 0.7, opacity: 0 }}
            animate={{ y: 0, rotate: -2, scale: 1, opacity: 1 }}
            transition={{ ...spring.bouncy, opacity: { duration: sec(duration.fast) } }}
            className="d2p-paper relative grid h-[164px] w-[124px] place-items-center overflow-hidden rounded-[3px] border border-black/10 shadow-e3"
          >
            <FirstPage key={outputs[0].name} output={outputs[0]} />
          </motion.div>
          <span className="absolute -bottom-3 -right-3">
            <SuccessCheck size={38} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-h2 font-semibold">{t('doc2pdf.result.title')}</h3>
          <p className="mt-1 text-body tabular-nums text-text-2">
            {multi
              ? t('doc2pdf.result.summaryMany', {
                  count: outputs.length,
                  pages: totalPages,
                  size: formatBytes(totalSize),
                })
              : t('doc2pdf.result.summaryOne', {
                  pages: output.pages,
                  size: formatBytes(output.blob.size),
                })}
          </p>
          {!multi && <FileName name={output.name} className="mt-0.5 text-small text-text-3" />}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {multi ? (
              <Button
                variant="primary"
                loading={zipping}
                leading={<FileArchive size={16} aria-hidden />}
                onClick={downloadZip}
              >
                {t('doc2pdf.result.downloadZip')}
              </Button>
            ) : (
              <Button
                variant="primary"
                leading={<Download size={16} aria-hidden />}
                onClick={() => download(output)}
              >
                {t('doc2pdf.result.download')}
              </Button>
            )}
            <Button
              variant="secondary"
              leading={<SlidersHorizontal size={16} aria-hidden />}
              onClick={onEdit}
            >
              {t('doc2pdf.result.edit')}
            </Button>
            <Button variant="ghost" leading={<RotateCcw size={16} aria-hidden />} onClick={onReset}>
              {t('doc2pdf.result.again')}
            </Button>
          </div>
        </div>
      </div>

      {missing > 0 && (
        <Callout
          tone="warning"
          className="relative mt-5"
          icon={<TriangleAlert size={16} aria-hidden />}
        >
          {t('doc2pdf.result.missing', { n: missing })}
        </Callout>
      )}

      {multi && (
        <ul className="relative mt-5 grid gap-1.5 border-t border-border pt-4 sm:grid-cols-2">
          {outputs.map((o, i) => (
            <motion.li
              key={o.name}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.smooth, delay: staggerDelay(i, 0.15) }}
              className={cn(
                'flex min-w-0 items-center gap-1 rounded-md py-1 pl-1 pr-1',
                i === sel
                  ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                  : 'bg-[color-mix(in_srgb,var(--text)_3%,transparent)]',
              )}
            >
              <button
                type="button"
                onClick={() => setSel(i)}
                aria-pressed={i === sel}
                aria-label={t('doc2pdf.result.previewOf', { name: o.name })}
                className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-sm px-2 text-left"
              >
                <FileName name={o.name} className="min-w-0 flex-1 text-small" />
                <span className="shrink-0 text-caption tabular-nums text-text-3">
                  {o.pages} · {formatBytes(o.blob.size)}
                </span>
              </button>
              <Tooltip content={t('common.download')}>
                <Button
                  icon
                  size="sm"
                  variant="ghost"
                  aria-label={`${t('common.download')} ${o.name}`}
                  onClick={() => download(o)}
                >
                  <Download size={15} aria-hidden />
                </Button>
              </Tooltip>
            </motion.li>
          ))}
        </ul>
      )}

      <PreviewSection
        key={output.name}
        output={output}
        heading={
          multi ? t('doc2pdf.result.previewOf', { name: output.name }) : t('doc2pdf.result.preview')
        }
      />
    </section>
  )
}

function FirstPage({ output }: { output: Output }) {
  const { thumbs } = usePreview(output, 1)
  return thumbs[0] ? (
    <img src={thumbs[0].url} alt="" className="size-full object-cover object-top" />
  ) : (
    <FileText size={30} className="text-black/30" aria-hidden />
  )
}

function PreviewSection({ output, heading }: { output: Output; heading: string }) {
  const t = useT()
  const [all, setAll] = useState(false)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const limit = all ? output.pages : FIRST_PAGES
  const { thumbs, failed, renderLarge } = usePreview(output, limit)
  return (
    <div className="relative mt-6">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h4 className="min-w-0 truncate text-h3 font-semibold">{heading}</h4>
        <span className="shrink-0 text-caption tabular-nums text-text-3">
          {t('doc2pdf.result.summaryOne', {
            pages: output.pages,
            size: formatBytes(output.blob.size),
          })}
        </span>
      </div>
      {failed ? (
        <p className="rounded-md bg-surface-2 px-4 py-6 text-center text-small text-text-2">
          {t('doc2pdf.result.previewFailed')}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(132px,1fr))]">
          {Array.from({ length: Math.min(limit, output.pages) }, (_, i) => {
            const th = thumbs[i]
            return (
              <motion.li
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring.smooth, delay: staggerDelay(i % FIRST_PAGES) }}
                className="flex flex-col items-center gap-1.5"
              >
                <button
                  type="button"
                  onClick={() => th && setLightbox(i)}
                  disabled={!th}
                  aria-label={t('doc2pdf.result.open', { n: i + 1 })}
                  className="d2p-paper relative block w-full overflow-hidden rounded-[3px] border border-black/10 shadow-e1 transition-shadow duration-(--dur-fast) hover:shadow-e3"
                  style={{ aspectRatio: th ? `1 / ${th.ratio}` : '1 / 1.414' }}
                >
                  {th ? (
                    <img src={th.url} alt="" className="size-full object-contain" />
                  ) : (
                    <Skeleton className="absolute inset-0 rounded-none" />
                  )}
                </button>
                <span className="text-caption tabular-nums text-text-3">{i + 1}</span>
              </motion.li>
            )
          })}
        </ul>
      )}
      {output.pages > FIRST_PAGES && !failed && (
        <div className="mt-3 flex justify-center">
          <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
            {all ? t('doc2pdf.result.showLess') : t('doc2pdf.result.showAll', { n: output.pages })}
          </Button>
        </div>
      )}
      <Lightbox
        open={lightbox !== null}
        page={lightbox ?? 0}
        total={output.pages}
        onChange={setLightbox}
        render={renderLarge}
      />
    </div>
  )
}

function Lightbox({
  open,
  page,
  total,
  onChange,
  render,
}: {
  open: boolean
  page: number
  total: number
  onChange: (p: number | null) => void
  render: (page: number, width: number) => Promise<Thumb>
}) {
  const t = useT()
  const go = useCallback(
    (d: number) => onChange(Math.max(0, Math.min(total - 1, page + d))),
    [onChange, page, total],
  )
  // 方向鍵／Page Up/Down 翻頁
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, go])
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onChange(null)}
      title={t('doc2pdf.result.pageLabel', { n: page + 1, total })}
      size="lg"
    >
      <div className="flex flex-col items-center gap-3">
        <LightboxPage key={page} page={page} render={render} />
        <div className="flex items-center gap-3">
          <Button
            icon
            variant="secondary"
            aria-label={t('doc2pdf.result.prev')}
            disabled={page <= 0}
            onClick={() => go(-1)}
          >
            <ChevronLeft size={18} aria-hidden />
          </Button>
          <span className="min-w-20 text-center text-small tabular-nums text-text-2">
            {page + 1} / {total}
          </span>
          <Button
            icon
            variant="secondary"
            aria-label={t('doc2pdf.result.next')}
            disabled={page >= total - 1}
            onClick={() => go(1)}
          >
            <ChevronRight size={18} aria-hidden />
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function LightboxPage({
  page,
  render,
}: {
  page: number
  render: (page: number, width: number) => Promise<Thumb>
}) {
  const t = useT()
  const [img, setImg] = useState<Thumb | null>(null)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    const width = Math.min(820, window.innerWidth - 64)
    render(page + 1, width)
      .then((r) => {
        made = r.url
        if (alive) setImg(r)
        else URL.revokeObjectURL(r.url)
      })
      .catch((e) => console.error(e))
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [page, render])
  return (
    <div
      className="d2p-paper relative overflow-hidden rounded-[3px] border border-black/10 shadow-e2"
      // 依視窗高度限制頁面大小，翻頁按鈕永遠看得到
      style={{
        aspectRatio: `1 / ${img?.ratio ?? 1.414}`,
        width: `min(100%, calc((100dvh - 240px) / ${img?.ratio ?? 1.414}), 600px)`,
      }}
    >
      {img ? (
        <motion.img
          src={img.url}
          alt={t('doc2pdf.result.page', { n: page + 1 })}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: sec(duration.fast) }}
          className="absolute inset-0 size-full object-contain"
        />
      ) : (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
    </div>
  )
}
