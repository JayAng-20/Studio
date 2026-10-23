import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight, ImagePlus, Stamp, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import {
  Button,
  ColorPicker,
  NumberField,
  SegmentedControl,
  Select,
  SliderField,
  Switch,
  Tabs,
  Tooltip,
  toast,
} from '@/components/ui'
import { timing, spring } from '@/design/motion'
import { outputName } from '@/lib/filename'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { useT, type TKey } from '@/i18n'
import { stampPages, type EncodedImage, type StampSpec } from '../lib/ops'
import { parsePageRange } from '../lib/pageRange'
import {
  PAGE_NUMBER_FORMATS,
  formatPageNumber,
  numberingPlan,
  numberingTotal,
  pageNumberLabels,
  type PageNumberFormat,
} from '../lib/pageNumber'
import {
  anchorPlacement,
  tilePlacements,
  type Anchor,
  type Placement,
  type Size,
} from '../lib/placement'
import { encodeWatermarkImage, renderTextStamp } from '../lib/raster'
import { sourceBytes, type PdfSource } from '../store'
import { PageThumb } from '../components/PageThumb'
import { RangeInput } from '../components/RangeInput'
import { ResultCard } from '../components/ResultCard'
import { Working } from '../components/Working'
import { useRunner, type Runner } from '../components/useRunner'
import {
  PanelSection,
  PdfDrop,
  SourceBar,
  SourceNotices,
  editBlocked,
  useActiveSource,
  useStage,
  ToolPanel,
  PanelFooter,
} from '../components/Shared'
import { toolById } from '../tools'

type NumPos = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'
const NUM_POS: NumPos[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br']
const WM_MARGIN = 36

interface WatermarkState {
  enabled: boolean
  kind: 'text' | 'image'
  text: string
  sizePt: number
  color: string
  bold: boolean
  image: (EncodedImage & { url: string; name: string }) | null
  imageScale: number
  opacity: number
  angle: number
  anchor: Anchor
  tile: boolean
  gap: number
  pages: string
}

interface NumberState {
  enabled: boolean
  format: PageNumberFormat
  position: NumPos
  start: number
  skipFirst: boolean
  sizePt: number
  color: string
  margin: number
}

export function StampTool() {
  const t = useT()
  const source = useActiveSource()
  const runner = useRunner()
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
          title={t('pdf.stamp.working')}
          progress={runner.progress}
          onCancel={runner.cancel}
        />
      )}
      {runner.phase === 'done' && runner.output && (
        <ResultCard
          files={runner.output.files}
          onReset={runner.reset}
          resetLabel={t('pdf.stamp.backToEdit')}
        />
      )}
      <div hidden={runner.phase !== 'idle'} className="flex flex-col gap-3">
        <SourceBar source={source} />
        <SourceNotices source={source} tool={toolById.stamp} />
        {source.status === 'ready' && (
          <StampEditor key={source.id} source={source} runner={runner} />
        )}
      </div>
    </div>
  )
}

/** 以 150 ms 防抖把文字繪成圖章，供預覽使用 */
function useTextStamp(o: { text: string; sizePt: number; color: string; bold: boolean } | null) {
  const [stamp, setStamp] = useState<{ url: string; size: Size; key: string } | null>(null)
  const key = o ? JSON.stringify(o) : ''
  useEffect(() => {
    if (!o) return
    let alive = true
    let made: string | null = null
    const timer = setTimeout(async () => {
      const r = await renderTextStamp({ ...o, outline: undefined })
      if (!alive || !r) return
      made = URL.createObjectURL(
        new Blob([r.image.bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
      )
      setStamp({ url: made, size: r.size, key })
    }, timing.previewDebounce)
    return () => {
      alive = false
      clearTimeout(timer)
      if (made) URL.revokeObjectURL(made)
    }
    // key 已涵蓋 o 的內容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return stamp
}

function StampEditor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [tab, setTab] = useState<'wm' | 'num'>('wm')
  const [wm, setWm] = useState<WatermarkState>(() => ({
    enabled: true,
    kind: 'text',
    text: t('pdf.stamp.defaultText'),
    sizePt: 56,
    color: '#DC2626',
    bold: true,
    image: null,
    imageScale: 35,
    opacity: 25,
    angle: 45,
    anchor: 'mc',
    tile: false,
    gap: 72,
    pages: '',
  }))
  const [num, setNum] = useState<NumberState>({
    enabled: false,
    format: 'slash',
    position: 'bc',
    start: 1,
    skipFirst: false,
    sizePt: 11,
    color: '#334155',
    margin: 28,
  })
  const [previewPage, setPreviewPage] = useState(0)
  const count = source.pageCount
  const patchWm = (p: Partial<WatermarkState>) => setWm((s) => ({ ...s, ...p }))
  const patchNum = (p: Partial<NumberState>) => setNum((s) => ({ ...s, ...p }))

  // 卸載時釋放圖片浮水印的物件網址
  const imageUrl = useRef<string | null>(null)
  useEffect(() => {
    imageUrl.current = wm.image?.url ?? null
  }, [wm.image])
  useEffect(
    () => () => {
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current)
    },
    [],
  )

  const wmRange = useMemo(
    () => (wm.pages.trim() ? parsePageRange(wm.pages, count) : null),
    [wm.pages, count],
  )
  const wmPages = useMemo(
    () =>
      wmRange ? (wmRange.ok ? new Set(wmRange.pages.map((p) => p - 1)) : new Set<number>()) : null,
    [wmRange],
  )

  const textStamp = useTextStamp(
    wm.enabled && wm.kind === 'text' && wm.text.trim()
      ? { text: wm.text, sizePt: wm.sizePt, color: wm.color, bold: wm.bold }
      : null,
  )
  const labels = useMemo(
    () => pageNumberLabels(count, num.format, { start: num.start, skipFirst: num.skipFirst }),
    [count, num.format, num.start, num.skipFirst],
  )
  const numStamp = useTextStamp(
    num.enabled && labels[previewPage]
      ? { text: labels[previewPage]!, sizePt: num.sizePt, color: num.color, bold: false }
      : null,
  )

  const wmSize = (visual: Size): Size | null => {
    if (wm.kind === 'text') return textStamp?.size ?? null
    if (!wm.image) return null
    const w = (visual.w * wm.imageScale) / 100
    return { w, h: (w * wm.image.height) / wm.image.width }
  }
  const wmPlacements = (visual: Size, size: Size): Placement[] =>
    wm.tile
      ? tilePlacements(visual, size, wm.angle, wm.gap)
      : [anchorPlacement(visual, size, wm.anchor, WM_MARGIN, wm.angle)]

  const pageSize = source.sizes[previewPage] ?? source.sizes[0] ?? { w: 595, h: 842 }
  const showWm = wm.enabled && (!wmPages || wmPages.has(previewPage))

  const blocked = editBlocked(source, toolById.stamp)
  const wmReady = !wm.enabled || (wm.kind === 'text' ? !!wm.text.trim() : !!wm.image)
  const valid = (wm.enabled || num.enabled) && wmReady && (!wmRange || wmRange.ok)

  const pickImage = async (file: File) => {
    try {
      const enc = await encodeWatermarkImage(file)
      setWm((s) => {
        if (s.image) URL.revokeObjectURL(s.image.url)
        return { ...s, image: { ...enc, name: file.name } }
      })
    } catch (e) {
      console.error(e)
      toast.error(t('pdf.images.decodeFailed'), {
        description: t('pdf.images.decodeFailedDesc', { name: file.name }),
      })
    }
  }

  const run = () => {
    const name = outputName(
      source.name,
      wm.enabled && num.enabled
        ? t('pdf.actions.stampBoth')
        : wm.enabled
          ? t('pdf.actions.watermark')
          : t('pdf.actions.numbers'),
      'pdf',
      pattern,
    )
    const wmState = wm
    const numState = num
    const pagesFilter = wmPages
    void runner.start(t('pdf.stamp.task', { name: source.name }), async ({ signal, progress }) => {
      const layers: Parameters<typeof stampPages>[1] = []
      if (wmState.enabled) {
        let text: { image: EncodedImage; size: Size } | null = null
        if (wmState.kind === 'text') {
          text = await renderTextStamp({
            text: wmState.text,
            sizePt: wmState.sizePt,
            color: wmState.color,
            bold: wmState.bold,
          })
        }
        const opacity = wmState.opacity / 100
        layers.push({
          stampFor: (i, visual): StampSpec | null => {
            if (pagesFilter && !pagesFilter.has(i)) return null
            if (text) return { image: text.image, size: text.size, opacity }
            if (!wmState.image) return null
            const w = (visual.w * wmState.imageScale) / 100
            return {
              image: wmState.image,
              size: { w, h: (w * wmState.image.height) / wmState.image.width },
              opacity,
            }
          },
          placements: (_i, visual, stamp) =>
            wmState.tile
              ? tilePlacements(visual, stamp.size, wmState.angle, wmState.gap)
              : [anchorPlacement(visual, stamp.size, wmState.anchor, WM_MARGIN, wmState.angle)],
        })
      }
      if (numState.enabled) {
        const cache = new Map<string, { image: EncodedImage; size: Size } | null>()
        const labelList = pageNumberLabels(count, numState.format, {
          start: numState.start,
          skipFirst: numState.skipFirst,
        })
        for (let i = 0; i < labelList.length; i++) {
          const l = labelList[i]
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          if (l && !cache.has(l))
            cache.set(
              l,
              await renderTextStamp({ text: l, sizePt: numState.sizePt, color: numState.color }),
            )
          progress((i / labelList.length) * 0.3)
        }
        layers.push({
          stampFor: (i) => {
            const l = labelList[i]
            const s = l ? cache.get(l) : null
            return s ? { image: s.image, size: s.size, opacity: 1 } : null
          },
          placements: (_i, visual, stamp) => [
            anchorPlacement(visual, stamp.size, numState.position, numState.margin, 0),
          ],
        })
      }
      const out = await stampPages(await sourceBytes(source), layers, signal, (p) =>
        progress((numState.enabled ? 0.3 : 0) + p * (numState.enabled ? 0.7 : 1)),
      )
      return {
        files: [
          { blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name },
        ],
      }
    })
  }

  return (
    <Workspace
      main={
        <div className="card flex flex-col items-center gap-3 p-3 sm:p-5">
          <div className="flex w-full items-center justify-between gap-2">
            <p className="text-small font-medium text-text-2">{t('pdf.stamp.preview')}</p>
            <div className="flex items-center gap-1">
              <Button
                icon
                size="sm"
                variant="ghost"
                aria-label={t('pdf.viewer.prev')}
                disabled={previewPage <= 0}
                onClick={() => setPreviewPage((p) => p - 1)}
              >
                <ChevronLeft size={17} aria-hidden />
              </Button>
              <span
                className="min-w-16 text-center text-small tabular-nums text-text-2"
                aria-live="polite"
              >
                {t('pdf.stamp.previewPage', { n: previewPage + 1, total: count })}
              </span>
              <Button
                icon
                size="sm"
                variant="ghost"
                aria-label={t('pdf.viewer.next')}
                disabled={previewPage >= count - 1}
                onClick={() => setPreviewPage((p) => p + 1)}
              >
                <ChevronRight size={17} aria-hidden />
              </Button>
            </div>
          </div>
          <StampPreview
            source={source}
            index={previewPage}
            page={pageSize}
            wm={
              showWm
                ? (() => {
                    const size = wmSize(pageSize)
                    const url = wm.kind === 'text' ? textStamp?.url : wm.image?.url
                    return size && url
                      ? {
                          url,
                          size,
                          opacity: wm.opacity / 100,
                          placements: wmPlacements(pageSize, size),
                        }
                      : null
                  })()
                : null
            }
            num={
              num.enabled && numStamp && labels[previewPage]
                ? {
                    url: numStamp.url,
                    size: numStamp.size,
                    opacity: 1,
                    placements: [
                      anchorPlacement(pageSize, numStamp.size, num.position, num.margin, 0),
                    ],
                  }
                : null
            }
          />
        </div>
      }
      panel={
        <ToolPanel>
          <Tabs
            label={t('pdf.tools.stamp.name')}
            value={tab}
            onChange={setTab}
            fullWidth
            items={[
              { value: 'wm', label: t('pdf.stamp.tabWatermark') },
              { value: 'num', label: t('pdf.stamp.tabNumbers') },
            ]}
          >
            <div className="flex flex-col gap-4 pt-4">
              {tab === 'wm' ? (
                <>
                  <Switch
                    label={t('pdf.stamp.wmEnable')}
                    checked={wm.enabled}
                    onChange={(v) => patchWm({ enabled: v })}
                  />
                  <fieldset
                    disabled={!wm.enabled}
                    className={cn('flex flex-col gap-4', !wm.enabled && 'opacity-50')}
                  >
                    <SegmentedControl
                      full
                      label={t('pdf.stamp.wmKind')}
                      value={wm.kind}
                      onChange={(v) => patchWm({ kind: v })}
                      options={[
                        { value: 'text', label: t('pdf.stamp.kindText') },
                        { value: 'image', label: t('pdf.stamp.kindImage') },
                      ]}
                    />
                    {wm.kind === 'text' ? (
                      <>
                        <div className="flex flex-col">
                          <label htmlFor="pdf-wm-text" className="label">
                            {t('pdf.stamp.text')}
                          </label>
                          <textarea
                            id="pdf-wm-text"
                            className="field min-h-[64px]!"
                            rows={2}
                            value={wm.text}
                            onChange={(e) => patchWm({ text: e.target.value })}
                            placeholder={t('pdf.stamp.textPlaceholder')}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <NumberField
                            label={t('pdf.stamp.fontSize')}
                            value={wm.sizePt}
                            onChange={(v) => patchWm({ sizePt: v })}
                            min={6}
                            max={300}
                            suffix="pt"
                          />
                          <ColorPicker
                            label={t('pdf.stamp.color')}
                            value={wm.color}
                            onChange={(v) => patchWm({ color: v })}
                          />
                        </div>
                        <Switch
                          label={t('pdf.stamp.bold')}
                          checked={wm.bold}
                          onChange={(v) => patchWm({ bold: v })}
                        />
                      </>
                    ) : (
                      <ImagePick
                        image={wm.image}
                        onPick={pickImage}
                        onClear={() => patchWm({ image: null })}
                      />
                    )}
                    {wm.kind === 'image' && (
                      <SliderField
                        label={t('pdf.stamp.imageScale')}
                        value={wm.imageScale}
                        onChange={(v) => patchWm({ imageScale: v })}
                        min={5}
                        max={100}
                        format={(v) => `${v}%`}
                      />
                    )}
                    <SliderField
                      label={t('pdf.stamp.opacity')}
                      value={wm.opacity}
                      onChange={(v) => patchWm({ opacity: v })}
                      min={5}
                      max={100}
                      format={(v) => `${v}%`}
                    />
                    <SliderField
                      label={t('pdf.stamp.angle')}
                      value={wm.angle}
                      onChange={(v) => patchWm({ angle: v })}
                      min={-90}
                      max={90}
                      format={(v) => `${v}°`}
                    />
                    <Switch
                      label={t('pdf.stamp.tile')}
                      description={t('pdf.stamp.tileDesc')}
                      checked={wm.tile}
                      onChange={(v) => patchWm({ tile: v })}
                    />
                    {wm.tile ? (
                      <SliderField
                        label={t('pdf.stamp.gap')}
                        value={wm.gap}
                        onChange={(v) => patchWm({ gap: v })}
                        min={0}
                        max={240}
                        format={(v) => `${v} pt`}
                      />
                    ) : (
                      <PanelSection title={t('pdf.stamp.position')}>
                        <AnchorPicker
                          value={wm.anchor}
                          onChange={(a) => patchWm({ anchor: a })}
                          anchors={['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']}
                          label={t('pdf.stamp.position')}
                        />
                      </PanelSection>
                    )}
                    <RangeInput
                      value={wm.pages}
                      onChange={(v) => patchWm({ pages: v })}
                      result={wmRange}
                      label={t('pdf.stamp.wmPages')}
                      placeholder={t('pdf.toImages.allPages', { count })}
                      hint={t('pdf.stamp.wmPagesHint')}
                    />
                  </fieldset>
                </>
              ) : (
                <>
                  <Switch
                    label={t('pdf.stamp.numEnable')}
                    checked={num.enabled}
                    onChange={(v) => patchNum({ enabled: v })}
                  />
                  <fieldset
                    disabled={!num.enabled}
                    className={cn('flex flex-col gap-4', !num.enabled && 'opacity-50')}
                  >
                    <Select
                      label={t('pdf.stamp.numFormat')}
                      value={num.format}
                      onChange={(v) => patchNum({ format: v })}
                      options={PAGE_NUMBER_FORMATS.map((f) => ({
                        value: f,
                        label: formatPageNumber(f, 1, numberingTotal(count, num)),
                      }))}
                    />
                    <PanelSection title={t('pdf.stamp.position')}>
                      <AnchorPicker
                        value={num.position}
                        onChange={(a) => patchNum({ position: a as NumPos })}
                        anchors={NUM_POS}
                        label={t('pdf.stamp.position')}
                      />
                    </PanelSection>
                    <div className="grid grid-cols-2 gap-3">
                      <NumberField
                        label={t('pdf.stamp.numStart')}
                        value={num.start}
                        onChange={(v) => patchNum({ start: Math.round(v) })}
                        min={0}
                        max={99999}
                      />
                      <NumberField
                        label={t('pdf.stamp.fontSize')}
                        value={num.sizePt}
                        onChange={(v) => patchNum({ sizePt: v })}
                        min={6}
                        max={72}
                        suffix="pt"
                      />
                    </div>
                    <ColorPicker
                      label={t('pdf.stamp.color')}
                      value={num.color}
                      onChange={(v) => patchNum({ color: v })}
                    />
                    <SliderField
                      label={t('pdf.stamp.margin')}
                      value={num.margin}
                      onChange={(v) => patchNum({ margin: v })}
                      min={8}
                      max={96}
                      format={(v) => `${v} pt`}
                    />
                    <Switch
                      label={t('pdf.stamp.skipFirst')}
                      description={t('pdf.stamp.skipFirstDesc')}
                      checked={num.skipFirst}
                      onChange={(v) => patchNum({ skipFirst: v })}
                    />
                    <p className="text-caption text-text-3">
                      {t('pdf.stamp.numSummary', {
                        first: numberingPlan(count, num).find((n) => n !== null) ?? '-',
                        last: numberingTotal(count, num),
                      })}
                    </p>
                  </fieldset>
                </>
              )}
            </div>
          </Tabs>
          <p className="rounded-md bg-surface-2 px-3 py-2 text-caption text-text-3">
            {t('pdf.stamp.cjkNote')}
          </p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!valid || blocked}
              leading={<Stamp size={18} aria-hidden />}
              onClick={run}
            >
              {t('pdf.stamp.apply')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}

/** 預覽：頁面縮圖＋以相同擺放計算疊上的圖章 */
function StampPreview({
  source,
  index,
  page,
  wm,
  num,
}: {
  source: PdfSource
  index: number
  page: Size
  wm: { url: string; size: Size; opacity: number; placements: Placement[] } | null
  num: { url: string; size: Size; opacity: number; placements: Placement[] } | null
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(480)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const aspect = page.w / page.h
  const k = w / page.w
  const layer = (l: NonNullable<typeof wm>, key: string) =>
    l.placements.map((p, i) => (
      <img
        key={`${key}${i}`}
        src={l.url}
        alt=""
        draggable={false}
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          left: (p.cx - l.size.w / 2) * k,
          top: (p.cy - l.size.h / 2) * k,
          width: l.size.w * k,
          height: l.size.h * k,
          opacity: l.opacity,
          transform: `rotate(${-p.angle}deg)`,
        }}
      />
    ))
  return (
    <div
      className="w-full max-w-[560px]"
      style={{
        maxWidth: aspect < 1 ? `min(560px, calc((100dvh - 440px) * ${aspect}))` : undefined,
      }}
    >
      <motion.div
        ref={ref}
        layout
        transition={spring.smooth}
        className="relative w-full overflow-hidden rounded-[4px] shadow-e3"
        style={{ aspectRatio: String(aspect) }}
        role="img"
        aria-label={t('pdf.stamp.previewLabel', { n: index + 1 })}
      >
        <PageThumb
          docId={source.id}
          index={index}
          aspect={aspect}
          renderWidth={560}
          priority={8}
          className="absolute inset-0"
        />
        {wm && layer(wm, 'w')}
        {num && layer(num, 'n')}
      </motion.div>
    </div>
  )
}

/** 位置選擇：九宮格（或上下兩列） */
function AnchorPicker<A extends Anchor>({
  value,
  onChange,
  anchors,
  label,
}: {
  value: A
  onChange: (a: A) => void
  anchors: A[]
  label: string
}) {
  const t = useT()
  const rows = anchors.length === 9 ? 3 : 2
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid w-[132px] grid-cols-3 gap-1 rounded-md bg-surface-2 p-1.5"
      style={{ gridTemplateRows: `repeat(${rows}, 28px)` }}
    >
      {anchors.map((a) => {
        const on = a === value
        return (
          <Tooltip key={a} content={t(`pdf.anchors.${a}` as TKey)}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t(`pdf.anchors.${a}` as TKey)}
              onClick={() => onChange(a)}
              className={cn(
                'relative grid place-items-center rounded-[6px] transition-colors duration-(--dur-fast)',
                on ? 'bg-surface shadow-e1' : 'hover:bg-surface-3',
              )}
            >
              <span
                className={cn(
                  'block size-2 rounded-full transition-transform duration-(--dur-fast)',
                  on ? 'scale-125 bg-accent' : 'bg-text-3/50',
                )}
              />
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

/** 圖片浮水印的選擇 */
function ImagePick({
  image,
  onPick,
  onClear,
}: {
  image: { url: string; name: string } | null
  onPick: (f: File) => void
  onClear: () => void
}) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed border-border-strong p-2.5">
      <span className="checker grid size-14 shrink-0 place-items-center overflow-hidden rounded-sm border border-border">
        {image ? (
          <img src={image.url} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <ImagePlus size={20} className="text-text-3" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-small font-medium">
          {image ? image.name : t('pdf.stamp.noImage')}
        </p>
        <p className="text-caption text-text-3">{t('pdf.stamp.imageHint')}</p>
      </div>
      <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
        {image ? t('pdf.stamp.change') : t('pdf.stamp.choose')}
      </Button>
      {image && (
        <Button icon size="sm" variant="ghost" aria-label={t('common.remove')} onClick={onClear}>
          <X size={15} aria-hidden />
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
