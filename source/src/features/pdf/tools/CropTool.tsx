import { motion } from 'motion/react'
import { Crop, RotateCcw, ScanLine } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, SegmentedControl, SliderField } from '@/components/ui'
import { spring } from '@/design/motion'
import { outputName } from '@/lib/filename'
import { releaseCanvas } from '@/lib/image'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { contentBounds, cropPages, type CropRect } from '../lib/acrobat'
import { parsePageRange } from '../lib/pageRange'
import { renderToCanvas } from '../lib/pdfjs'
import { getDoc, sourceBytes, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { PagePager, PageStage, ToolFrame } from '../components/Frame'
import { RangeInput } from '../components/RangeInput'
import { PanelFooter, PanelSection, ToolPanel } from '../components/Shared'

type Scope = 'all' | 'current' | 'range'
type Mode = 'manual' | 'auto'

const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 }
const MIN = 0.04

/** 找出某頁的內容範圍（低解析度渲染） */
async function autoBounds(source: PdfSource, index: number, pad: number): Promise<CropRect> {
  const doc = await getDoc(source.id)
  const page = await doc.getPage(index + 1)
  const canvas = await renderToCanvas(page, 0.6)
  try {
    const ctx = canvas.getContext('2d')!
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const b = contentBounds(img.data, canvas.width, canvas.height)
    if (!b) return FULL
    const px = pad / canvas.width
    const py = pad / canvas.height
    const x = Math.max(0, b.x - px)
    const y = Math.max(0, b.y - py)
    return { x, y, w: Math.min(1 - x, b.w + 2 * px), h: Math.min(1 - y, b.h + 2 * py) }
  } finally {
    releaseCanvas(canvas)
    page.cleanup()
  }
}

export function CropTool() {
  const t = useT()
  const runner = useRunner()
  return (
    <ToolFrame tool="crop" runner={runner} workingTitle={t('pdf.crop.working')} resetLabel={t('pdf.crop.again')}>
      {(source) => <Editor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

/** 裁切框：框外變暗、八個控制點、框內拖曳移動 */
function CropBox({ rect, onChange }: { rect: CropRect; onChange: (r: CropRect) => void }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ handle: string; sx: number; sy: number; o: CropRect } | null>(null)
  const [dragging, setDragging] = useState(false)
  const end = () => {
    drag.current = null
    setDragging(false)
  }
  const pt = (e: RPointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const down = (e: RPointerEvent<HTMLElement>) => {
    const handle = e.currentTarget.dataset.handle ?? 'move'
    e.stopPropagation()
    box.current!.setPointerCapture(e.pointerId)
    const p = pt(e)
    drag.current = { handle, sx: p.x, sy: p.y, o: rect }
    setDragging(true)
  }
  const move = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = pt(e)
    const dx = p.x - d.sx
    const dy = p.y - d.sy
    let { x, y, w, h } = d.o
    if (d.handle === 'move') {
      x = Math.min(1 - w, Math.max(0, x + dx))
      y = Math.min(1 - h, Math.max(0, y + dy))
    } else {
      if (d.handle.includes('l')) {
        const nx = Math.min(x + w - MIN, Math.max(0, x + dx))
        w += x - nx
        x = nx
      }
      if (d.handle.includes('r')) w = Math.min(1 - x, Math.max(MIN, w + dx))
      if (d.handle.includes('t')) {
        const ny = Math.min(y + h - MIN, Math.max(0, y + dy))
        h += y - ny
        y = ny
      }
      if (d.handle.includes('b')) h = Math.min(1 - y, Math.max(MIN, h + dy))
    }
    onChange({ x, y, w, h })
  }
  const handles = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l']
  const pos = (h: string) => ({
    left: h.includes('l') ? '0%' : h.includes('r') ? '100%' : '50%',
    top: h.includes('t') ? '0%' : h.includes('b') ? '100%' : '50%',
  })
  return (
    <div
      ref={box}
      className="absolute inset-0 touch-none overflow-hidden"
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <motion.div
        className="absolute cursor-move outline-2 outline-dashed outline-[var(--accent)] [box-shadow:0_0_0_9999px_rgba(10,12,16,.5)]"
        initial={false}
        animate={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`,
        }}
        transition={dragging ? { duration: 0 } : spring.smooth}
        data-handle="move"
        onPointerDown={down}
        role="group"
        aria-label={t('pdf.crop.box')}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-40">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="border border-white/40" />
          ))}
        </div>
        {handles.map((h) => (
          <span
            key={h}
            data-handle={h}
            onPointerDown={down}
            className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--accent)] shadow-e2 transition-transform hover:scale-125"
            style={{ ...pos(h), cursor: `${h.length === 2 ? (h === 'tl' || h === 'br' ? 'nwse' : 'nesw') : h === 't' || h === 'b' ? 'ns' : 'ew'}-resize` }}
          />
        ))}
      </motion.div>
    </div>
  )
}

function Editor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [page, setPage] = useState(0)
  const [rect, setRect] = useState<CropRect>({ x: 0.06, y: 0.06, w: 0.88, h: 0.88 })
  const [scope, setScope] = useState<Scope>('all')
  const [range, setRange] = useState('')
  const [mode, setMode] = useState<Mode>('manual')
  const [pad, setPad] = useState(8)
  const parsed = scope === 'range' ? parsePageRange(range, source.pageCount) : null

  // 自動模式：預覽目前頁的偵測結果
  useEffect(() => {
    if (mode !== 'auto') return
    let alive = true
    autoBounds(source, page, pad).then((r) => alive && setRect(r)).catch(() => {})
    return () => {
      alive = false
    }
  }, [mode, page, pad, source])

  const targets = (): Set<number> =>
    scope === 'all'
      ? new Set(Array.from({ length: source.pageCount }, (_, i) => i))
      : scope === 'current'
        ? new Set([page])
        : new Set(parsed && parsed.ok ? parsed.pages.map((p) => p - 1) : [])

  const run = () => {
    const set = targets()
    const fixed = rect
    const name = outputName(source.name, t('pdf.actions.crop'), 'pdf', pattern)
    void runner.start(t('pdf.crop.task', { name: source.name }), async ({ progress, signal }) => {
      const rects = new Map<number, CropRect>()
      if (mode === 'auto') {
        let n = 0
        for (const i of set) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          rects.set(i, await autoBounds(source, i, pad))
          progress((++n / set.size) * 0.9)
        }
      } else set.forEach((i) => rects.set(i, fixed))
      const out = await cropPages(await sourceBytes(source), (i) => rects.get(i) ?? null)
      return { files: [{ blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name }] }
    })
  }
  const size = source.sizes[page] ?? source.sizes[0]
  const mm = (v: number) => Math.round((v * 25.4) / 72)
  return (
    <Workspace
      main={
        <div className="flex flex-col gap-3">
          <PagePager
            index={page}
            count={source.pageCount}
            onChange={setPage}
            extra={
              size && (
                <span className="text-caption tabular-nums text-text-3">
                  {mm(size.w * rect.w)} × {mm(size.h * rect.h)} mm
                </span>
              )
            }
          />
          <PageStage source={source} index={page}>
            <CropBox
              rect={rect}
              onChange={(r) => {
                setMode('manual')
                setRect(r)
              }}
            />
          </PageStage>
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.crop.name')}>
          <PanelSection title={t('pdf.crop.mode')}>
            <SegmentedControl<Mode>
              label={t('pdf.crop.mode')}
              full
              value={mode}
              onChange={setMode}
              options={[
                { value: 'manual', label: t('pdf.crop.manual') },
                { value: 'auto', label: t('pdf.crop.auto') },
              ]}
            />
            {mode === 'auto' ? (
              <SliderField label={t('pdf.crop.padding')} value={pad} min={0} max={40} onChange={setPad} format={(v) => `${v}px`} />
            ) : (
              <p className="text-caption text-text-3">{t('pdf.crop.manualHint')}</p>
            )}
          </PanelSection>
          <PanelSection title={t('pdf.crop.applyTo')}>
            <SegmentedControl<Scope>
              label={t('pdf.crop.applyTo')}
              full
              size="sm"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: t('pdf.crop.all') },
                { value: 'current', label: t('pdf.crop.current') },
                { value: 'range', label: t('pdf.crop.range') },
              ]}
            />
            {scope === 'range' && (
              <RangeInput value={range} onChange={setRange} result={range ? parsed : null} label={t('pdf.crop.range')} hideLabel />
            )}
          </PanelSection>
          <Button
            variant="ghost"
            size="sm"
            leading={mode === 'auto' ? <ScanLine size={15} aria-hidden /> : <RotateCcw size={15} aria-hidden />}
            onClick={() => {
              setMode('manual')
              setRect(FULL)
            }}
          >
            {t('pdf.crop.reset')}
          </Button>
          <p className="text-caption text-text-3">{t('pdf.crop.note')}</p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={targets().size === 0}
              leading={<Crop size={18} aria-hidden />}
              onClick={run}
            >
              {t('pdf.crop.run')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
