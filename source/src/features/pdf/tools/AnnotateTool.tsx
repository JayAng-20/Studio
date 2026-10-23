import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  Highlighter,
  MousePointer2,
  PenLine,
  Redo2,
  Signature,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import {
  Button,
  ColorPicker,
  Dialog,
  NumberField,
  SliderField,
  Toolbar,
  Tooltip,
} from '@/components/ui'
import { uid } from '@/lib/files'
import { outputName } from '@/lib/filename'
import { modKey } from '@/lib/capabilities'
import { canvasToBlob, createCanvas, releaseCanvas } from '@/lib/image'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { useModuleShortcuts, useUnsaved } from '@/stores/ui'
import { useT, type TKey } from '@/i18n'
import {
  annBounds,
  applyAnnotations,
  isStroke,
  moveAnn,
  strokePath,
  type Ann,
  type ImageAnn,
  type TextAnn,
} from '../lib/annotate'
import { renderTextStamp } from '../lib/raster'
import type { Size } from '../lib/placement'
import { sourceBytes, type PdfSource } from '../store'
import { PageThumb } from '../components/PageThumb'
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

type Tool = 'select' | 'pen' | 'highlight' | 'text' | 'sign' | 'erase'
const PEN_COLORS = ['#0F172A', '#DC2626', '#2563EB', '#16A34A']
const HL_COLORS = ['#FDE047', '#86EFAC', '#93C5FD', '#F9A8D4']

export function AnnotateTool() {
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
      {runner.phase !== 'done' && <SourceBar source={source} />}
      {runner.phase !== 'done' && <SourceNotices source={source} tool={toolById.annotate} />}
      {runner.phase === 'working' && (
        <Working
          title={t('pdf.annotate.working')}
          progress={runner.progress}
          onCancel={runner.cancel}
        />
      )}
      {source.status === 'ready' && !editBlocked(source, toolById.annotate) && (
        <Annotator key={source.id} source={source} runner={runner} />
      )}
    </div>
  )
}

/** 文字框以與匯出相同的方式繪成圖片，預覽與輸出一致 */
function useTextStamps(anns: Ann[]) {
  const [map, setMap] = useState<Record<string, { key: string; url: string; size: Size }>>({})
  const texts = anns.filter((a): a is TextAnn => a.kind === 'text')
  const sig = texts.map((a) => `${a.id}|${a.text}|${a.sizePt}|${a.color}`).join('\n')
  useEffect(() => {
    let alive = true
    const made: string[] = []
    ;(async () => {
      const next: Record<string, { key: string; url: string; size: Size }> = {}
      for (const line of sig ? sig.split('\n') : []) {
        const [id, text, size, color] = line.split('|')
        const r = await renderTextStamp({
          text: text || ' ',
          sizePt: Number(size),
          color,
          align: 'left',
        })
        if (!alive) return
        if (!r) continue
        const url = URL.createObjectURL(
          new Blob([r.image.bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
        )
        made.push(url)
        next[id] = { key: line, url, size: r.size }
      }
      if (alive) setMap(next)
    })().catch((e) => console.error(e))
    return () => {
      alive = false
      // 稍後釋放，避免新圖還沒載入前閃爍
      setTimeout(() => made.forEach((u) => URL.revokeObjectURL(u)), 1000)
    }
  }, [sig])
  return map
}

function Annotator({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [hist, setHist] = useState<{ anns: Ann[]; past: Ann[][]; future: Ann[][] }>({
    anns: [],
    past: [],
    future: [],
  })
  const { anns } = hist
  const [page, setPage] = useState(0)
  const [tool, setTool] = useState<Tool>('pen')
  const [penColor, setPenColor] = useState(PEN_COLORS[1])
  const [penWidth, setPenWidth] = useState(2)
  const [hlColor, setHlColor] = useState(HL_COLORS[0])
  const [hlWidth, setHlWidth] = useState(14)
  const [textSize, setTextSize] = useState(14)
  const [textColor, setTextColor] = useState('#0F172A')
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Ann | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null)
  const stamps = useTextStamps(anns)
  const size = source.sizes[page] ?? source.sizes[0] ?? { w: 595, h: 842 }
  const count = source.pageCount
  useUnsaved('pdf-annotate', anns.length > 0 && runner.phase !== 'done')

  const commit = useCallback((next: Ann[]) => {
    setHist((h) => ({ anns: next, past: [...h.past.slice(-49), h.anns], future: [] }))
  }, [])
  /** 拖曳中的即時更新（不記錄步驟） */
  const replaceLive = (next: Ann[]) => setHist((h) => ({ ...h, anns: next }))
  const undo = () =>
    setHist((h) =>
      h.past.length
        ? {
            anns: h.past[h.past.length - 1],
            past: h.past.slice(0, -1),
            future: [h.anns, ...h.future],
          }
        : h,
    )
  const redo = () =>
    setHist((h) =>
      h.future.length
        ? { anns: h.future[0], past: [...h.past, h.anns], future: h.future.slice(1) }
        : h,
    )

  const sel = anns.find((a) => a.id === selected) ?? null
  const patchSel = (p: Partial<TextAnn> | Partial<ImageAnn>) => {
    if (!sel) return
    commit(anns.map((a) => (a.id === sel.id ? ({ ...a, ...p } as Ann) : a)))
  }
  const removeSel = () => {
    if (!sel) return
    commit(anns.filter((a) => a.id !== sel.id))
    setSelected(null)
  }

  /** 螢幕座標 → 頁面 pt */
  const toPt = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    return [
      ((e.clientX - r.left) / r.width) * size.w,
      ((e.clientY - r.top) / r.height) * size.h,
    ] as [number, number]
  }

  const bounds = (a: Ann) => {
    if (a.kind === 'text' && stamps[a.id]) return { x: a.x, y: a.y, ...stamps[a.id].size }
    return annBounds(a)
  }

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const [x, y] = toPt(e)
    if (tool === 'pen' || tool === 'highlight') {
      svg.current?.setPointerCapture(e.pointerId)
      setDraft({
        id: uid('ann'),
        kind: tool,
        page,
        points: [[x, y]],
        color: tool === 'pen' ? penColor : hlColor,
        width: tool === 'pen' ? penWidth : hlWidth,
        opacity: tool === 'pen' ? 1 : 0.45,
      })
      return
    }
    if (tool === 'text') {
      const a: TextAnn = {
        id: uid('ann'),
        kind: 'text',
        page,
        x,
        y: y - textSize * 0.7,
        text: t('pdf.annotate.textDefault'),
        sizePt: textSize,
        color: textColor,
      }
      commit([...anns, a])
      setSelected(a.id)
      setTool('select')
      return
    }
    // 點到空白處：取消選取
    if (tool === 'select') setSelected(null)
  }
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (draft && (draft.kind === 'pen' || draft.kind === 'highlight')) {
      const [x, y] = toPt(e)
      const last = draft.points[draft.points.length - 1]
      if (Math.hypot(x - last[0], y - last[1]) < 0.8) return
      setDraft({ ...draft, points: [...draft.points, [x, y]] })
      return
    }
    const d = drag.current
    if (d) {
      const [x, y] = toPt(e)
      const dx = x - d.x
      const dy = y - d.y
      if (!d.moved && Math.hypot(dx, dy) < 1) return
      if (!d.moved) {
        // 第一次移動時記錄一步，之後的移動即時更新
        commit(anns)
        d.moved = true
      }
      drag.current = { ...d, x, y }
      replaceLive(anns.map((a) => (a.id === d.id ? moveAnn(a, dx, dy) : a)))
    }
  }
  const onUp = () => {
    if (draft) {
      commit([...anns, draft])
      setDraft(null)
    }
    drag.current = null
  }
  const onItemDown = (e: ReactPointerEvent, a: Ann) => {
    if (tool === 'erase') {
      e.stopPropagation()
      commit(anns.filter((x) => x.id !== a.id))
      return
    }
    if (tool !== 'select') return
    e.stopPropagation()
    setSelected(a.id)
    const [x, y] = toPt(e)
    drag.current = { id: a.id, x, y, moved: false }
    svg.current?.setPointerCapture(e.pointerId)
  }

  // 鍵盤：Delete 刪除、方向鍵微調、⌘Z 復原
  const keyRef = useRef({ removeSel, undo, redo, sel, anns, commit })
  useEffect(() => {
    keyRef.current = { removeSel, undo, redo, sel, anns, commit }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      const k = keyRef.current
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') (e.shiftKey ? k.redo : k.undo)()
      else if ((e.key === 'Delete' || e.key === 'Backspace') && k.sel) k.removeSel()
      else if (k.sel && e.key.startsWith('Arrow')) {
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        k.commit(k.anns.map((a) => (a.id === k.sel!.id ? moveAnn(a, dx, dy) : a)))
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useModuleShortcuts([
    { keys: ['Delete'], label: t('pdf.annotate.keyDelete') },
    { keys: ['←', '→', '↑', '↓'], label: t('pdf.annotate.keyNudge') },
    { keys: [modKey(), 'Z'], label: t('common.undo') },
  ])

  const placeSignature = (img: {
    bytes: Uint8Array
    width: number
    height: number
    url: string
  }) => {
    const w = Math.min(180, size.w * 0.4)
    const h = (w * img.height) / img.width
    const a: ImageAnn = {
      id: uid('ann'),
      kind: 'sign',
      page,
      x: size.w / 2 - w / 2,
      y: size.h * 0.7 - h / 2,
      w,
      h,
      image: { bytes: img.bytes, type: 'png', width: img.width, height: img.height },
      url: img.url,
    }
    commit([...anns, a])
    setSelected(a.id)
    setTool('select')
  }

  const exportPdf = () => {
    const list = anns
    const name = outputName(source.name, t('pdf.actions.annotate'), 'pdf', pattern)
    void runner.start(
      t('pdf.annotate.task', { name: source.name }),
      async ({ signal, progress }) => {
        progress(null)
        const out = await applyAnnotations(
          await sourceBytes(source),
          list,
          (a) => renderTextStamp({ text: a.text, sizePt: a.sizePt, color: a.color, align: 'left' }),
          signal,
        )
        return {
          files: [
            { blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name },
          ],
        }
      },
    )
  }

  if (runner.phase === 'working') return null
  if (runner.phase === 'done' && runner.output)
    return (
      <ResultCard
        files={runner.output.files}
        summary={t('pdf.annotate.done', { count: anns.length })}
        onReset={runner.reset}
        resetLabel={t('pdf.annotate.backToEdit')}
      />
    )

  const pageAnns = anns.filter((a) => a.page === page)
  const visible = draft ? [...pageAnns, draft] : pageAnns
  const tools: Array<{ id: Tool; icon: React.ReactNode; label: TKey }> = [
    {
      id: 'select',
      icon: <MousePointer2 size={17} aria-hidden />,
      label: 'pdf.annotate.toolSelect',
    },
    { id: 'pen', icon: <PenLine size={17} aria-hidden />, label: 'pdf.annotate.toolPen' },
    {
      id: 'highlight',
      icon: <Highlighter size={17} aria-hidden />,
      label: 'pdf.annotate.toolHighlight',
    },
    { id: 'text', icon: <Type size={17} aria-hidden />, label: 'pdf.annotate.toolText' },
    { id: 'sign', icon: <Signature size={17} aria-hidden />, label: 'pdf.annotate.toolSign' },
    { id: 'erase', icon: <Eraser size={17} aria-hidden />, label: 'pdf.annotate.toolErase' },
  ]
  const drawing = tool === 'pen' || tool === 'highlight'

  return (
    <Workspace
      main={
        <div className="card overflow-hidden">
          <Toolbar
            label={t('pdf.annotate.toolbar')}
            className="border-b border-border px-2 py-1.5 sm:px-3"
          >
            <div
              role="radiogroup"
              aria-label={t('pdf.annotate.tools')}
              className="flex flex-wrap gap-0.5"
            >
              {tools.map((x) => (
                <Tooltip key={x.id} content={t(x.label)}>
                  <Button
                    icon
                    size="sm"
                    variant="ghost"
                    role="radio"
                    aria-checked={tool === x.id}
                    aria-label={t(x.label)}
                    className={cn(
                      tool === x.id &&
                        'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent-ink',
                    )}
                    onClick={() => {
                      if (x.id === 'sign') setSignOpen(true)
                      else setTool(x.id)
                    }}
                  >
                    {x.icon}
                  </Button>
                </Tooltip>
              ))}
            </div>
            <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
            <Tooltip content={t('common.undo')} shortcut={`${modKey()}Z`}>
              <Button
                icon
                size="sm"
                variant="ghost"
                aria-label={t('common.undo')}
                disabled={!hist.past.length}
                onClick={undo}
              >
                <Undo2 size={17} aria-hidden />
              </Button>
            </Tooltip>
            <Tooltip content={t('common.redo')}>
              <Button
                icon
                size="sm"
                variant="ghost"
                aria-label={t('common.redo')}
                disabled={!hist.future.length}
                onClick={redo}
              >
                <Redo2 size={17} aria-hidden />
              </Button>
            </Tooltip>
            <div className="ml-auto flex items-center gap-1">
              <Button
                icon
                size="sm"
                variant="ghost"
                aria-label={t('pdf.viewer.prev')}
                disabled={page <= 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={17} aria-hidden />
              </Button>
              <span
                className="min-w-14 text-center text-small tabular-nums text-text-2"
                aria-live="polite"
              >
                {page + 1} / {count}
              </span>
              <Button
                icon
                size="sm"
                variant="ghost"
                aria-label={t('pdf.viewer.next')}
                disabled={page >= count - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={17} aria-hidden />
              </Button>
            </div>
          </Toolbar>
          <div className="grid place-items-center bg-surface-2 p-3 sm:p-6">
            <div
              className="relative w-full max-w-[760px] shadow-e3"
              style={{
                aspectRatio: String(size.w / size.h),
                maxWidth: `min(760px, calc((100dvh - 430px) * ${size.w / size.h}))`,
              }}
            >
              <PageThumb
                docId={source.id}
                index={page}
                aspect={size.w / size.h}
                renderWidth={800}
                priority={8}
                className="absolute inset-0"
              />
              <svg
                ref={svg}
                viewBox={`0 0 ${size.w} ${size.h}`}
                className={cn(
                  'absolute inset-0 size-full select-none',
                  drawing
                    ? 'cursor-crosshair touch-none'
                    : tool === 'text'
                      ? 'cursor-text'
                      : tool === 'erase'
                        ? 'cursor-pointer'
                        : 'cursor-default',
                )}
                role="application"
                aria-label={t('pdf.annotate.canvas', { n: page + 1 })}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              >
                {visible.map((a) => {
                  const isSel = a.id === selected
                  const b = bounds(a)
                  return (
                    <g key={a.id}>
                      {isStroke(a) ? (
                        <>
                          <path
                            d={strokePath(a.points)}
                            fill="none"
                            stroke={a.color}
                            strokeWidth={a.width}
                            strokeOpacity={a.opacity}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              mixBlendMode: a.kind === 'highlight' ? 'multiply' : undefined,
                              pointerEvents: 'none',
                            }}
                          />
                          {/* 較寬的透明路徑，方便點選 */}
                          <path
                            d={strokePath(a.points)}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={Math.max(a.width, 10)}
                            style={{
                              pointerEvents:
                                tool === 'select' || tool === 'erase' ? 'stroke' : 'none',
                            }}
                            onPointerDown={(e) => onItemDown(e, a)}
                          />
                        </>
                      ) : (
                        <image
                          href={a.kind === 'sign' ? a.url : stamps[a.id]?.url}
                          x={a.x}
                          y={a.y}
                          width={b.w}
                          height={b.h}
                          preserveAspectRatio="none"
                          style={{
                            pointerEvents: tool === 'select' || tool === 'erase' ? 'auto' : 'none',
                            cursor: tool === 'select' ? 'move' : undefined,
                          }}
                          onPointerDown={(e) => onItemDown(e, a)}
                        />
                      )}
                      {isSel && (
                        <rect
                          x={b.x - 3}
                          y={b.y - 3}
                          width={b.w + 6}
                          height={b.h + 6}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth={1.2}
                          strokeDasharray="4 3"
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.annotate.name')}>
          {sel ? (
            <PanelSection title={t('pdf.annotate.selected')}>
              {sel.kind === 'text' && (
                <>
                  <div className="flex flex-col">
                    <label htmlFor="pdf-ann-text" className="label">
                      {t('pdf.stamp.text')}
                    </label>
                    <textarea
                      id="pdf-ann-text"
                      className="field"
                      rows={3}
                      value={sel.text}
                      onChange={(e) =>
                        replaceLive(
                          anns.map((a) => (a.id === sel.id ? { ...a, text: e.target.value } : a)),
                        )
                      }
                      onFocus={() => commit(anns)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField
                      label={t('pdf.stamp.fontSize')}
                      value={sel.sizePt}
                      onChange={(v) => patchSel({ sizePt: v })}
                      min={6}
                      max={96}
                      suffix="pt"
                    />
                    <ColorPicker
                      label={t('pdf.stamp.color')}
                      value={sel.color}
                      onChange={(v) => patchSel({ color: v })}
                    />
                  </div>
                </>
              )}
              {sel.kind === 'sign' && (
                <SliderField
                  label={t('pdf.annotate.signWidth')}
                  value={Math.round(sel.w)}
                  onChange={(v) => {
                    const h = (v * sel.image.height) / sel.image.width
                    replaceLive(anns.map((a) => (a.id === sel.id ? { ...a, w: v, h } : a)))
                  }}
                  onCommit={() => commit(anns)}
                  min={40}
                  max={Math.round(size.w)}
                  format={(v) => `${v} pt`}
                />
              )}
              <p className="text-caption text-text-3">{t('pdf.annotate.moveHint')}</p>
              <Button
                variant="secondary"
                leading={<Trash2 size={15} aria-hidden />}
                onClick={removeSel}
              >
                {t('pdf.annotate.deleteSelected')}
              </Button>
            </PanelSection>
          ) : tool === 'pen' || tool === 'highlight' ? (
            <PanelSection
              title={t(tool === 'pen' ? 'pdf.annotate.toolPen' : 'pdf.annotate.toolHighlight')}
            >
              <div className="flex gap-2" role="radiogroup" aria-label={t('pdf.stamp.color')}>
                {(tool === 'pen' ? PEN_COLORS : HL_COLORS).map((c) => {
                  const on = (tool === 'pen' ? penColor : hlColor) === c
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={c}
                      onClick={() => (tool === 'pen' ? setPenColor(c) : setHlColor(c))}
                      className={cn(
                        'size-8 rounded-full border border-border-strong transition-transform duration-(--dur-fast)',
                        on
                          ? 'scale-110 ring-2 ring-accent ring-offset-2 ring-offset-surface'
                          : 'hover:scale-105',
                      )}
                      style={{ background: c }}
                    />
                  )
                })}
              </div>
              <SliderField
                label={t('pdf.annotate.width')}
                value={tool === 'pen' ? penWidth : hlWidth}
                onChange={tool === 'pen' ? setPenWidth : setHlWidth}
                min={tool === 'pen' ? 0.5 : 6}
                max={tool === 'pen' ? 10 : 32}
                step={0.5}
                format={(v) => `${v} pt`}
              />
            </PanelSection>
          ) : tool === 'text' ? (
            <PanelSection title={t('pdf.annotate.toolText')}>
              <p className="text-small text-text-2">{t('pdf.annotate.textHint')}</p>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label={t('pdf.stamp.fontSize')}
                  value={textSize}
                  onChange={setTextSize}
                  min={6}
                  max={96}
                  suffix="pt"
                />
                <ColorPicker
                  label={t('pdf.stamp.color')}
                  value={textColor}
                  onChange={setTextColor}
                />
              </div>
            </PanelSection>
          ) : (
            <p className="text-small text-text-2">
              {t(tool === 'erase' ? 'pdf.annotate.eraseHint' : 'pdf.annotate.selectHint')}
            </p>
          )}
          <p className="rounded-md bg-surface-2 px-3 py-2 text-caption tabular-nums text-text-3">
            {t('pdf.annotate.count', {
              count: anns.length,
              pages: new Set(anns.map((a) => a.page)).size,
            })}
          </p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!anns.length}
              leading={<Download size={18} aria-hidden />}
              onClick={exportPdf}
            >
              {t('pdf.annotate.export')}
            </Button>
          </PanelFooter>
          <SignatureDialog open={signOpen} onOpenChange={setSignOpen} onDone={placeSignature} />
        </ToolPanel>
      }
    />
  )
}

/** 手寫簽名：在畫板上簽名，裁掉空白後成為透明 PNG */
function SignatureDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: (img: { bytes: Uint8Array; width: number; height: number; url: string }) => void
}) {
  const t = useT()
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [color, setColor] = useState('#0F172A')
  const [empty, setEmpty] = useState(true)
  const last = useRef<{ x: number; y: number } | null>(null)
  const SCALE = 2

  const setup = (el: HTMLCanvasElement | null) => {
    canvas.current = el
    if (!el) return
    const r = el.getBoundingClientRect()
    if (!r.width) return
    if (el.width !== Math.round(r.width * SCALE)) {
      el.width = Math.round(r.width * SCALE)
      el.height = Math.round(r.height * SCALE)
    }
  }
  const pos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) * SCALE, y: (e.clientY - r.top) * SCALE }
  }
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    setup(e.currentTarget)
    e.currentTarget.setPointerCapture(e.pointerId)
    last.current = pos(e)
  }
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return
    const p = pos(e)
    const ctx = e.currentTarget.getContext('2d')!
    ctx.strokeStyle = color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // 依速度調整粗細，讓筆跡更自然
    const v = Math.hypot(p.x - last.current.x, p.y - last.current.y)
    ctx.lineWidth = Math.max(2.2, 5.5 - v * 0.06) * (SCALE / 2)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    if (empty) setEmpty(false)
  }
  const up = () => {
    last.current = null
  }
  const clear = () => {
    const c = canvas.current
    if (!c) return
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }
  const done = async () => {
    const c = canvas.current
    if (!c) return
    // 裁掉空白
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height)
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 < 0) return
    const pad = 8
    const out = createCanvas(x1 - x0 + 1 + pad * 2, y1 - y0 + 1 + pad * 2)
    out
      .getContext('2d')!
      .drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height)
    try {
      const blob = await canvasToBlob(out, 'image/png')
      onDone({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: out.width,
        height: out.height,
        url: URL.createObjectURL(blob),
      })
      clear()
      onOpenChange(false)
    } finally {
      releaseCanvas(out)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('pdf.annotate.signTitle')}
      description={t('pdf.annotate.signDesc')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={clear} disabled={empty}>
            {t('common.clear')}
          </Button>
          <Button variant="primary" onClick={done} disabled={empty}>
            {t('pdf.annotate.signUse')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <canvas
          ref={setup}
          aria-label={t('pdf.annotate.signPad')}
          className="paper h-[200px] w-full touch-none rounded-md border border-dashed border-border-strong"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
        <div
          className="flex items-center gap-2"
          role="radiogroup"
          aria-label={t('pdf.stamp.color')}
        >
          {['#0F172A', '#1D4ED8', '#DC2626'].map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn(
                'size-7 rounded-full border border-border-strong',
                color === c && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
              )}
              style={{ background: c }}
            />
          ))}
          <span className="ml-auto text-caption text-text-3">{t('pdf.annotate.signTip')}</span>
        </div>
      </div>
    </Dialog>
  )
}
