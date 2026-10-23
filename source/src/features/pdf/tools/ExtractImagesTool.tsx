import { AnimatePresence, motion } from 'motion/react'
import { Archive, Check, ImageDown, ImageOff, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, EmptyState, ProgressBar, SegmentedControl, SendToMenu, toast } from '@/components/ui'
import { spring } from '@/design/motion'
import { downloadBlob, saveLargeBlob } from '@/lib/download'
import { formatBytes } from '@/lib/format'
import { createZip } from '@/lib/zip'
import { cn } from '@/lib/cn'
import { asFile } from '@/stores/fileBus'
import { useT } from '@/i18n'
import { extractImages, type ExtractedImage } from '../lib/extract'
import { getDoc, type PdfSource } from '../store'
import { PdfDrop, SourceBar, ToolPanel, PanelFooter, PanelSection, useActiveSource, useStage } from '../components/Shared'

export function ExtractImagesTool() {
  const source = useActiveSource()
  const [min, setMin] = useState('64')
  const [run, setRun] = useState(0)
  useStage(source ? 'ready' : 'empty')
  if (!source) return <PdfDrop />
  return (
    <div className="flex flex-col gap-3">
      <SourceBar source={source} />
      {source.status === 'ready' && (
        <Extractor
          key={`${source.id}-${min}-${run}`}
          source={source}
          min={min}
          setMin={setMin}
          rerun={() => setRun((n) => n + 1)}
        />
      )}
    </div>
  )
}

function Extractor({
  source,
  min,
  setMin,
  rerun,
}: {
  source: PdfSource
  min: string
  setMin: (v: string) => void
  rerun: () => void
}) {
  const t = useT()
  const [items, setItems] = useState<ExtractedImage[]>([])
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const urls = useRef<string[]>([])
  useStage(done ? 'done' : 'working')

  useEffect(() => {
    const ctrl = new AbortController()
    getDoc(source.id)
      .then((doc) =>
        extractImages(doc, { minSize: Number(min) }, setProgress, ctrl.signal, (img) => {
          urls.current.push(img.url)
          setItems((l) => [...l, img])
          setPicked((p) => new Set(p).add(img.id))
        }),
      )
      .then(() => !ctrl.signal.aborted && setDone(true))
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          console.error(e)
          setDone(true)
        }
      })
    return () => ctrl.abort()
  }, [source.id, min])
  useEffect(() => {
    const list = urls.current
    return () => list.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  const base = source.name.replace(/\.pdf$/i, '')
  const nameOf = (img: ExtractedImage, i: number) => `${base}_p${img.page + 1}_${i + 1}.png`
  const chosen = items.filter((x) => picked.has(x.id))
  const download = async () => {
    if (chosen.length === 1) return downloadBlob(chosen[0].blob, nameOf(chosen[0], items.indexOf(chosen[0])))
    const zip = await createZip(chosen.map((x) => ({ name: nameOf(x, items.indexOf(x)), data: x.blob })))
    await saveLargeBlob(zip, `${base}_images.zip`)
    toast.success(t('pdf.result.downloaded'))
  }

  return (
    <Workspace
      main={
        <div className="card p-4">
          {!done && (
            <div className="mb-4">
              <ProgressBar value={progress} label={t('pdf.extractImages.scanning')} />
              <p className="mt-1.5 text-caption text-text-3" aria-live="polite">
                {t('pdf.extractImages.scanningCount', { count: items.length, percent: Math.round(progress * 100) })}
              </p>
            </div>
          )}
          {done && !items.length ? (
            <EmptyState
              illustration={<ImageOff size={36} className="text-text-3" aria-hidden />}
              title={t('pdf.extractImages.none')}
              description={t('pdf.extractImages.noneDesc')}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              <AnimatePresence>
                {items.map((img, i) => {
                  const on = picked.has(img.id)
                  return (
                    <motion.li
                      key={img.id}
                      layout
                      initial={{ opacity: 0, scale: 0.85, y: 14 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={spring.bouncy}
                    >
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setPicked((p) => {
                            const n = new Set(p)
                            if (n.has(img.id)) n.delete(img.id)
                            else n.add(img.id)
                            return n
                          })
                        }
                        className={cn(
                          'group relative block w-full overflow-hidden rounded-md border-2 bg-[repeating-conic-gradient(var(--surface-2)_0%_25%,var(--surface)_0%_50%)] bg-[length:16px_16px] text-left transition-colors',
                          on ? 'border-[var(--accent)]' : 'border-transparent',
                        )}
                      >
                        <img src={img.url} alt={nameOf(img, i)} className="aspect-square w-full object-contain" />
                        <motion.span
                          className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-[var(--accent-strong)] text-white shadow-e2"
                          animate={{ scale: on ? 1 : 0, opacity: on ? 1 : 0 }}
                          transition={spring.bouncy}
                        >
                          <Check size={14} aria-hidden />
                        </motion.span>
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-4 text-[11px] tabular-nums text-white">
                          {t('pdf.grid.page', { n: img.page + 1 })} · {img.width}×{img.height} · {formatBytes(img.blob.size)}
                        </span>
                      </button>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          )}
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.extractImages.name')}>
          <PanelSection title={t('pdf.extractImages.minSize')}>
            <SegmentedControl
              label={t('pdf.extractImages.minSize')}
              full
              size="sm"
              value={min}
              onChange={setMin}
              options={[
                { value: '1', label: t('pdf.extractImages.all') },
                { value: '64', label: '≥ 64 px' },
                { value: '200', label: '≥ 200 px' },
              ]}
            />
          </PanelSection>
          <p className="text-small text-text-2">
            {t('pdf.extractImages.selected', { count: chosen.length, total: items.length })}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(items.map((x) => x.id)))}>
              {t('pdf.extractImages.selectAll')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              {t('pdf.extractImages.selectNone')}
            </Button>
            <Button size="sm" variant="ghost" icon aria-label={t('common.retry')} onClick={rerun}>
              <RotateCcw size={14} aria-hidden />
            </Button>
          </div>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!chosen.length}
              leading={chosen.length > 1 ? <Archive size={18} aria-hidden /> : <ImageDown size={18} aria-hidden />}
              onClick={() => void download()}
            >
              {chosen.length > 1 ? t('common.downloadZip') : t('common.download')}
            </Button>
            {chosen.length > 0 && (
              <SendToMenu
                from="pdfconvert"
                targets={['tools', 'convert', 'stitch']}
                getFiles={() => chosen.map((x) => asFile(x.blob, nameOf(x, items.indexOf(x))))}
              />
            )}
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
