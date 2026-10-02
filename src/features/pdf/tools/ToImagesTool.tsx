import { motion } from 'motion/react'
import { Images, TriangleAlert, OctagonAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import {
  Button,
  Callout,
  ColorPicker,
  CopyButton,
  NumberField,
  SegmentedControl,
  SendToMenu,
  SliderField,
  Switch,
} from '@/components/ui'
import { spring, staggerDelay } from '@/design/motion'
import { canEncode, canvasToBlob, releaseCanvas } from '@/lib/image'
import { copyBlob } from '@/lib/download'
import { caps } from '@/lib/capabilities'
import { formatBytes } from '@/lib/format'
import { outputName, sanitizeFilename, splitExt } from '@/lib/filename'
import { asFile } from '@/stores/fileBus'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { formatPageRange, parsePageRange } from '../lib/pageRange'
import { MAX_CANVAS_PIXELS, renderToCanvas } from '../lib/pdfjs'
import {
  FORMAT_MAX_DIM,
  LONG_MAX_WIDTH,
  LONG_WARN_BYTES,
  LONG_WARN_PIXELS,
  estimatePngBytes,
  groupPages,
  planLongImage,
  scaleForWidth,
  type LongAlign,
} from '../lib/longImage'
import { renderLongPng } from '../lib/longRender'
import { getDoc, type PdfSource } from '../store'
import { PageGrid, toggleSelection } from '../components/PageGrid'
import { RangeInput } from '../components/RangeInput'
import { ResultCard, type ResultFile } from '../components/ResultCard'
import { Working } from '../components/Working'
import { useRunner, type Runner } from '../components/useRunner'
import {
  PanelSection,
  PdfDrop,
  SourceBar,
  useActiveSource,
  useStage,
  ToolPanel,
  PanelFooter,
} from '../components/Shared'

type Fmt = 'png' | 'jpg' | 'webp'
type Output = 'each' | 'long'
type SizeMode = 'dpi' | 'width'
const MIME: Record<Fmt, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }
const DPI_MIN = 36
const DPI_MAX = 600
const DPI_PRESETS = [72, 150, 200, 300, 600]
/** 複製到剪貼簿的上限：太大的圖片剪貼簿與其他程式通常無法處理 */
const COPY_MAX_PIXELS = 40_000_000
const COPY_MAX_BYTES = 40 * 1024 * 1024

interface ToImagesData {
  mode: Output
  /** 長圖是否為透明背景 */
  alpha?: boolean
  previews: Blob[]
  dims: Array<{ w: number; h: number }>
}

export function ToImagesTool() {
  const t = useT()
  const source = useActiveSource()
  const runner = useRunner<ToImagesData>()
  useStage(
    runner.phase === 'working'
      ? 'working'
      : runner.phase === 'done'
        ? 'done'
        : source
          ? 'ready'
          : 'empty',
  )
  if (!source) return <PdfDrop />
  return (
    <div className="flex flex-col gap-3">
      {runner.phase === 'working' && (
        <Working
          title={t('pdf.toImages.working')}
          progress={runner.progress}
          onCancel={runner.cancel}
        />
      )}
      {runner.phase === 'done' && runner.output?.data && (
        <ToImagesResult
          source={source}
          runner={runner}
          files={runner.output.files}
          data={runner.output.data}
        />
      )}
      <div hidden={runner.phase !== 'idle'} className="flex flex-col gap-3">
        <SourceBar source={source} />
        {source.status === 'ready' && <Exporter key={source.id} source={source} runner={runner} />}
      </div>
    </div>
  )
}

/** 物件網址：在 effect 內建立、卸載時釋放 */
function useObjectUrls(blobs: Blob[]) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const list = blobs.map((b) => URL.createObjectURL(b))
    const id = requestAnimationFrame(() => setUrls(list))
    return () => {
      cancelAnimationFrame(id)
      list.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [blobs])
  return urls
}

function ToImagesResult({
  source,
  runner,
  files,
  data,
}: {
  source: PdfSource
  runner: Runner<ToImagesData>
  files: ResultFile[]
  data: ToImagesData
}) {
  const t = useT()
  const long = data.mode === 'long'
  const thumbs = useMemo(
    () => (long ? data.previews : files.slice(0, 8).map((f) => f.blob)),
    [long, data, files],
  )
  const urls = useObjectUrls(thumbs)
  const single = files.length === 1
  const px = data.dims[0] ? data.dims[0].w * data.dims[0].h : 0
  const copyOk =
    caps.clipboardWrite() && single && px <= COPY_MAX_PIXELS && files[0].blob.size <= COPY_MAX_BYTES
  const copyReason = !caps.clipboardWrite()
    ? t('pdf.toImages.copyUnsupported')
    : !single
      ? t('pdf.toImages.copyMulti')
      : t('pdf.toImages.copyTooBig')
  return (
    <ResultCard
      files={files}
      zipName={`${sanitizeFilename(splitExt(source.name).base)}_${long ? 'long' : 'images'}.zip`}
      previewUrl={long ? urls[0] : undefined}
      onReset={runner.reset}
      resetLabel={t('pdf.toImages.backToEdit')}
      summary={
        long
          ? t(single ? 'pdf.toImages.longDoneOne' : 'pdf.toImages.longDoneMulti', {
              count: files.length,
              w: data.dims[0]?.w ?? 0,
              h: data.dims[0]?.h ?? 0,
              size: formatBytes(files.reduce((n, f) => n + f.blob.size, 0)),
            })
          : undefined
      }
      actions={
        <>
          {single &&
            (copyOk ? (
              <CopyButton variant="secondary" onCopy={() => copyBlob(files[0].blob)} />
            ) : null)}
          <SendToMenu
            from="pdf"
            targets={['tools', 'convert']}
            getFiles={() => files.map((f) => asFile(f.blob, f.name))}
          />
        </>
      }
    >
      {long ? (
        <div className="flex flex-col gap-2">
          <div
            className={`max-h-[360px] overflow-y-auto rounded-md border border-border ${data.alpha ? 'checker' : 'bg-surface-2'}`}
          >
            <div className="flex flex-col items-center gap-3 p-3">
              {urls.map((u, i) => (
                <img
                  key={u}
                  src={u}
                  alt={t('pdf.toImages.longPreviewAlt', { n: i + 1 })}
                  className="w-full max-w-[320px] shadow-e1"
                />
              ))}
            </div>
          </div>
          {!copyOk && single && <p className="text-caption text-text-3">{copyReason}</p>}
          {data.dims.some((d) => d.h > 32767) && (
            <p className="text-caption text-text-3">{t('pdf.toImages.viewerNote')}</p>
          )}
        </div>
      ) : (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-hidden>
          {urls.map((u, i) => (
            <motion.li
              key={u}
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ ...spring.smooth, delay: staggerDelay(i, 0.2) }}
              className="h-16 shrink-0 overflow-hidden rounded-[3px] border border-border shadow-e1"
            >
              <img src={u} alt="" className="h-full w-auto" />
            </motion.li>
          ))}
        </ul>
      )}
    </ResultCard>
  )
}

function Exporter({ source, runner }: { source: PdfSource; runner: Runner<ToImagesData> }) {
  const t = useT()
  const quality = useSettings((s) => s.imageQuality)
  const [text, setText] = useState('')
  const [output, setOutput] = useState<Output>('each')
  const [fmt, setFmt] = useState<Fmt>('png')
  const [q, setQ] = useState(quality)
  const [sizeMode, setSizeMode] = useState<SizeMode>('dpi')
  const [dpi, setDpi] = useState(150)
  const [widthPx, setWidthPx] = useState(1600)
  const [gap, setGap] = useState(16)
  const [transparent, setTransparent] = useState(false)
  const [bg, setBg] = useState('#FFFFFF')
  const [separator, setSeparator] = useState(false)
  const [align, setAlign] = useState<LongAlign>('center')
  const [split, setSplit] = useState(false)
  const [per, setPer] = useState(10)
  const [webp, setWebp] = useState<boolean | null>(null)
  const last = useRef<number | null>(null)
  const count = source.pageCount
  const long = output === 'long'

  useEffect(() => {
    let alive = true
    canEncode('image/webp').then((ok) => alive && setWebp(ok))
    return () => {
      alive = false
    }
  }, [])

  const parsed = useMemo(() => (text.trim() ? parsePageRange(text, count) : null), [text, count])
  const pages = useMemo(
    () =>
      parsed
        ? parsed.ok
          ? [...new Set(parsed.pages)]
          : []
        : Array.from({ length: count }, (_, i) => i + 1),
    [parsed, count],
  )
  const selected = useMemo(() => new Set(text.trim() ? pages.map((p) => p - 1) : []), [pages, text])

  const onClick = (i: number, e: MouseEvent) => {
    const next = toggleSelection(selected, i, e, last.current)
    last.current = i
    setText(formatPageRange([...next].sort((a, b) => a - b).map((p) => p + 1)))
  }

  // 縮放：DPI 或輸出寬度（長圖以最寬頁為準；每頁一張時每頁寬度相同）
  const sizeOf = (p: number) => source.sizes[p - 1] ?? source.sizes[0] ?? { w: 595, h: 842 }
  const longScale = sizeMode === 'dpi' ? dpi / 72 : scaleForWidth(source.sizes, pages, widthPx)
  const pageScale = (p: number) => (sizeMode === 'dpi' ? dpi / 72 : widthPx / sizeOf(p).w)
  const groups = useMemo(
    () => (long && split ? groupPages(pages, per) : [pages]),
    [long, split, pages, per],
  )
  const layouts = useMemo(
    () =>
      long && pages.length
        ? groups.map((g) =>
            planLongImage(source.sizes, g, { scale: longScale, gap, align, separator }),
          )
        : [],
    [long, pages.length, groups, source.sizes, longScale, gap, align, separator],
  )

  // 尺寸摘要
  const stats = useMemo(() => {
    if (long) {
      const pixels = layouts.reduce((n, l) => n + l.width * l.height, 0)
      const maxW = Math.max(0, ...layouts.map((l) => l.width))
      const maxH = Math.max(0, ...layouts.map((l) => l.height))
      return {
        w: maxW,
        h: maxH,
        pixels,
        bytes: estimatePngBytes(pixels, transparent),
        maxSide: Math.max(maxW, maxH),
      }
    }
    let pixels = 0
    let maxSide = 0
    for (const p of pages) {
      const s = sizeOf(p)
      const k = pageScale(p)
      pixels += Math.round(s.w * k) * Math.round(s.h * k)
      maxSide = Math.max(maxSide, Math.round(s.w * k), Math.round(s.h * k))
    }
    const first = pages[0] ? sizeOf(pages[0]) : { w: 0, h: 0 }
    const k = pages[0] ? pageScale(pages[0]) : 1
    const perPx =
      fmt === 'png' ? 0.35 : fmt === 'jpg' ? 0.12 * (0.5 + q / 100) : 0.08 * (0.5 + q / 100)
    return {
      w: Math.round(first.w * k),
      h: Math.round(first.h * k),
      pixels,
      bytes: pixels * perPx,
      maxSide,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [long, layouts, pages, transparent, fmt, q, dpi, widthPx, sizeMode, source.sizes])

  const tooWide = long && stats.w > LONG_MAX_WIDTH
  const heavy = long && (stats.pixels > LONG_WARN_PIXELS || stats.bytes > LONG_WARN_BYTES)
  const jpgOver = stats.maxSide > FORMAT_MAX_DIM.jpg
  const webpOver = stats.maxSide > FORMAT_MAX_DIM.webp
  const effFmt: Fmt = long
    ? 'png'
    : (fmt === 'jpg' && jpgOver) || (fmt === 'webp' && (webpOver || webp === false))
      ? 'png'
      : fmt
  const capped =
    !long &&
    effFmt !== 'png' &&
    pages.some((p) => {
      const s = sizeOf(p)
      const k = pageScale(p)
      return s.w * s.h * k * k > MAX_CANVAS_PIXELS
    })

  const run = () => {
    const list = pages
    const width = String(count).length
    const base = source.name
    if (long) {
      const plans = layouts
      const totalRows = plans.reduce((n, l) => n + l.height, 0)
      const opts = { background: transparent ? null : bg, lineColor: '#CBD5E1', scale: longScale }
      void runner.start(
        t('pdf.toImages.longTask', { count: list.length }),
        async ({ signal, progress }) => {
          const doc = await getDoc(source.id)
          const files: ResultFile[] = []
          const previews: Blob[] = []
          let before = 0
          for (let i = 0; i < plans.length; i++) {
            const r = await renderLongPng(doc, plans[i], {
              ...opts,
              signal,
              onProgress: (done) => progress((before + done) / totalRows),
            })
            before += plans[i].height
            files.push({
              blob: r.blob,
              name: outputName(
                base,
                plans.length > 1 ? `long_${String(i + 1).padStart(2, '0')}` : 'long',
                'png',
                '{name}_{action}',
              ),
            })
            previews.push(r.preview)
          }
          return {
            files,
            data: {
              mode: 'long',
              alpha: transparent,
              previews,
              dims: plans.map((l) => ({ w: l.width, h: l.height })),
            },
          }
        },
      )
      return
    }
    const f = effFmt
    void runner.start(
      t('pdf.toImages.task', { count: list.length }),
      async ({ signal, progress }) => {
        const doc = await getDoc(source.id)
        const files: ResultFile[] = []
        const dims: ToImagesData['dims'] = []
        for (let i = 0; i < list.length; i++) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          const s = sizeOf(list[i])
          const k = pageScale(list[i])
          const name = outputName(
            base,
            `p${String(list[i]).padStart(width, '0')}`,
            f,
            '{name}_{action}',
          )
          if (f === 'png' && s.w * s.h * k * k > MAX_CANVAS_PIXELS) {
            // 超過 canvas 上限：改用條帶渲染＋串流 PNG，不必降解析度
            const layout = planLongImage(source.sizes, [list[i]], {
              scale: k,
              gap: 0,
              align: 'left',
              separator: false,
            })
            const r = await renderLongPng(doc, layout, {
              scale: k,
              background: '#FFFFFF',
              lineColor: '#FFFFFF',
              signal,
              onProgress: (d, total) => progress((i + d / total) / list.length),
            })
            files.push({ blob: r.blob, name })
            dims.push({ w: layout.width, h: layout.height })
          } else {
            const page = await doc.getPage(list[i])
            try {
              const canvas = await renderToCanvas(page, k, { signal })
              try {
                const blob = await canvasToBlob(canvas, MIME[f], f === 'png' ? undefined : q / 100)
                files.push({ blob, name })
                dims.push({ w: canvas.width, h: canvas.height })
              } finally {
                releaseCanvas(canvas)
              }
            } finally {
              page.cleanup()
            }
          }
          progress((i + 1) / list.length)
        }
        return { files, data: { mode: 'each', previews: [], dims } }
      },
    )
  }

  const mp = (n: number) => (n / 1e6 >= 100 ? (n / 1e6).toFixed(0) : (n / 1e6).toFixed(1))

  return (
    <Workspace
      main={
        <PageGrid
          source={source}
          label={t('pdf.toImages.gridLabel')}
          onItemClick={onClick}
          state={(i) => ({
            selected: text.trim() ? selected.has(i) : true,
            dim: !!text.trim() && !selected.has(i),
          })}
        />
      }
      panel={
        <ToolPanel title={t('pdf.tools.toImages.name')}>
          <RangeInput
            value={text}
            onChange={setText}
            result={parsed}
            label={t('pdf.toImages.pages')}
            placeholder={t('pdf.toImages.allPages', { count })}
            hint={t('pdf.toImages.pagesHint')}
          />
          <PanelSection title={t('pdf.toImages.output')}>
            <SegmentedControl
              full
              label={t('pdf.toImages.output')}
              value={output}
              onChange={setOutput}
              options={[
                { value: 'each', label: t('pdf.toImages.outputEach') },
                { value: 'long', label: t('pdf.toImages.outputLong') },
              ]}
            />
          </PanelSection>
          <PanelSection title={t('common.format')}>
            {long ? (
              <p className="rounded-md bg-surface-2 px-3 py-2 text-caption text-text-2">
                {t('pdf.toImages.longPngOnly')}
              </p>
            ) : (
              <>
                <SegmentedControl
                  full
                  label={t('common.format')}
                  value={effFmt}
                  onChange={setFmt}
                  options={[
                    { value: 'png', label: 'PNG' },
                    {
                      value: 'jpg',
                      label: 'JPG',
                      disabled: jpgOver,
                      title: jpgOver ? t('pdf.toImages.jpgTooBig') : undefined,
                    },
                    {
                      value: 'webp',
                      label: 'WebP',
                      disabled: webp === false || webpOver,
                      title:
                        webp === false
                          ? t('pdf.toImages.webpUnsupported')
                          : webpOver
                            ? t('pdf.toImages.webpTooBig')
                            : undefined,
                    },
                  ]}
                />
                {webp === false && (
                  <p className="text-caption text-text-3">{t('pdf.toImages.webpUnsupported')}</p>
                )}
                {(jpgOver || (webpOver && webp !== false)) && (
                  <p className="text-caption text-text-3">
                    {jpgOver ? t('pdf.toImages.jpgTooBig') : t('pdf.toImages.webpTooBig')}
                  </p>
                )}
              </>
            )}
          </PanelSection>
          {!long && effFmt !== 'png' && (
            <SliderField
              label={t('common.quality')}
              value={q}
              onChange={setQ}
              min={1}
              max={100}
              format={(v) => `${v}`}
            />
          )}
          <PanelSection title={t('pdf.toImages.size')}>
            <SegmentedControl
              full
              size="sm"
              label={t('pdf.toImages.size')}
              value={sizeMode}
              onChange={setSizeMode}
              options={[
                { value: 'dpi', label: t('pdf.toImages.byDpi') },
                { value: 'width', label: t('pdf.toImages.byWidth') },
              ]}
            />
            {sizeMode === 'dpi' ? (
              <>
                <NumberField
                  label={t('pdf.toImages.dpi')}
                  value={dpi}
                  onChange={setDpi}
                  min={DPI_MIN}
                  max={DPI_MAX}
                  step={1}
                  suffix="dpi"
                />
                <div className="grid grid-cols-5 gap-1">
                  {DPI_PRESETS.map((v) => (
                    <Button
                      key={v}
                      size="sm"
                      variant={dpi === v ? 'secondary' : 'outline'}
                      className="px-0 tabular-nums"
                      aria-pressed={dpi === v}
                      onClick={() => setDpi(v)}
                    >
                      {v}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <NumberField
                label={long ? t('pdf.toImages.widthLong') : t('pdf.toImages.widthEach')}
                value={widthPx}
                onChange={(v) => setWidthPx(Math.round(v))}
                min={16}
                max={LONG_MAX_WIDTH}
                step={100}
                suffix="px"
              />
            )}
            <dl
              className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-surface-2 px-3 py-2.5 text-caption tabular-nums"
              aria-live="polite"
            >
              <dt className="text-text-3">
                {long ? t('pdf.toImages.finalSize') : t('pdf.toImages.firstSize')}
              </dt>
              <dd className="text-right font-medium text-text">
                {stats.w.toLocaleString()} × {stats.h.toLocaleString()} px
              </dd>
              <dt className="text-text-3">{t('pdf.toImages.totalPixels')}</dt>
              <dd className="text-right text-text">
                {t('pdf.toImages.megapixels', { value: mp(stats.pixels) })}
              </dd>
              <dt className="text-text-3">{t('pdf.toImages.estimate')}</dt>
              <dd className="text-right text-text">≈ {formatBytes(stats.bytes)}</dd>
            </dl>
          </PanelSection>
          {long && (
            <PanelSection title={t('pdf.toImages.longOptions')}>
              <SliderField
                label={t('pdf.toImages.gap')}
                value={gap}
                onChange={setGap}
                min={0}
                max={64}
                format={(v) => `${v} px`}
              />
              <Switch
                label={t('pdf.toImages.transparent')}
                description={t('pdf.toImages.transparentDesc')}
                checked={transparent}
                onChange={setTransparent}
              />
              {!transparent && (
                <ColorPicker label={t('pdf.toImages.background')} value={bg} onChange={setBg} />
              )}
              <Switch
                label={t('pdf.toImages.separator')}
                checked={separator}
                onChange={setSeparator}
              />
              <SegmentedControl
                full
                size="sm"
                label={t('pdf.toImages.align')}
                value={align}
                onChange={setAlign}
                options={[
                  { value: 'center', label: t('pdf.toImages.alignCenter') },
                  { value: 'left', label: t('pdf.toImages.alignLeft') },
                ]}
              />
              <Switch
                label={t('pdf.toImages.split')}
                description={t('pdf.toImages.splitDesc')}
                checked={split}
                onChange={setSplit}
              />
              {split && (
                <NumberField
                  label={t('pdf.toImages.perImage')}
                  value={per}
                  onChange={(v) => setPer(Math.max(1, Math.round(v)))}
                  min={1}
                  max={Math.max(1, count)}
                  suffix={t('pdf.split.pagesSuffix')}
                />
              )}
            </PanelSection>
          )}
          {tooWide && (
            <Callout
              tone="danger"
              icon={<OctagonAlert size={16} />}
              title={t('pdf.toImages.tooWideTitle')}
            >
              {t('pdf.toImages.tooWideDesc', { max: LONG_MAX_WIDTH })}
            </Callout>
          )}
          {heavy && !tooWide && (
            <Callout
              tone="warning"
              icon={<TriangleAlert size={16} />}
              title={t('pdf.toImages.heavyTitle')}
            >
              <p>
                {t('pdf.toImages.heavyDesc', {
                  px: mp(stats.pixels),
                  size: formatBytes(stats.bytes),
                })}
              </p>
              {!split && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => setSplit(true)}
                >
                  {t('pdf.toImages.heavyAction', { n: per })}
                </Button>
              )}
            </Callout>
          )}
          {capped && (
            <Callout tone="warning" icon={<TriangleAlert size={16} />}>
              {t('pdf.toImages.capped')}
            </Callout>
          )}
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!pages.length || (!!parsed && !parsed.ok) || tooWide}
              leading={<Images size={18} aria-hidden />}
              onClick={run}
            >
              {long
                ? layouts.length > 1
                  ? t('pdf.toImages.startLongMulti', { count: layouts.length })
                  : t('pdf.toImages.startLong')
                : t('pdf.toImages.start', { count: pages.length })}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
