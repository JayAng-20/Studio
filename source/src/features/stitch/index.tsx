/**
 * 長圖拼接（#/stitch）：多張照片自由拖曳（可開關輔助定位），合成一張直式或橫式長圖。
 * 空（拖放區）→ 編輯（畫布＋右側面板）→ 輸出中 → 完成（預覽、下載、傳送），同一個容器以 layout 動畫切換。
 */
import { AnimatePresence, Reorder, motion, useDragControls } from 'motion/react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Copy,
  Download,
  GalleryHorizontal,
  GalleryVertical,
  GripVertical,
  Magnet,
  Move,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  Wand2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ModulePage, StageContainer, TopBarActions, Workspace } from '@/components/layout/ModulePage'
import {
  AddFilesButton,
  Button,
  ColorPicker,
  DropTarget,
  DropZone,
  FileName,
  ProgressBar,
  SegmentedControl,
  SendToMenu,
  SliderField,
  SuccessCheck,
  Switch,
  Tooltip,
  toast,
} from '@/components/ui'
import { EmptyIllustration } from '@/design/illustrations'
import { spring, staggerDelay } from '@/design/motion'
import { modKey } from '@/lib/capabilities'
import { saveLargeBlob } from '@/lib/download'
import { formatBytes } from '@/lib/format'
import { canvasToBlob, createCanvas, releaseCanvas } from '@/lib/image'
import { cn } from '@/lib/cn'
import { asFile, useIncomingFiles } from '@/stores/fileBus'
import { useTask, isAbortError } from '@/stores/tasks'
import { useModuleShortcuts, useUnsaved } from '@/stores/ui'
import { useT } from '@/i18n'
import { decodeAny } from '@/features/pdf/lib/raster'
import { bounds, exportScale, type Align } from './lib'
import { addImages, useStitch, type StitchItem, type StitchOptions } from './store'
import { Stage } from './Stage'

const ACCEPT = 'image/*,.heic,.heif,.avif,.webp,.jpg,.jpeg,.png,.gif,.bmp,.svg'

interface Output {
  blob: Blob
  url: string
  name: string
  w: number
  h: number
}

export default function StitchPage() {
  const t = useT()
  const items = useStitch((s) => s.items)
  const loading = useStitch((s) => s.loading)
  const run = useTask('stitch')
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit')
  const [progress, setProgress] = useState(0)
  const [output, setOutput] = useState<Output | null>(null)
  const [ctrl, setCtrl] = useState<AbortController | null>(null)

  const add = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(heic|heif|avif|webp|jpe?g|png|gif|bmp|svg)$/i.test(f.name))
      if (!imgs.length) return
      const n = await addImages(imgs)
      if (n < imgs.length) toast.error(t('stitch.someFailed', { count: imgs.length - n }))
      setPhase('edit')
    },
    [t],
  )
  // 換成新的結果或離開頁面時才釋放預覽網址（放在 ResultView 裡會被 StrictMode 的重複掛載提早釋放）
  useEffect(() => {
    if (!output) return
    const url = output.url
    return () => URL.revokeObjectURL(url)
  }, [output])
  useIncomingFiles('stitch', (p) => void add(p.files))
  useUnsaved('stitch', items.length > 0 && phase !== 'done')

  const exportImage = useCallback(async () => {
    const { items: list, options } = useStitch.getState()
    if (!list.length) return
    const c = new AbortController()
    setCtrl(c)
    setPhase('working')
    setProgress(0)
    try {
      let result: Output | null = null
      await run(
        t('stitch.task', { count: list.length }),
        async ({ signal, progress: report }) => {
          const r = await renderStitch(list, options, signal, (p) => {
            report(p)
            setProgress(p)
          })
          result = r
          return [{ blob: r.blob, name: r.name }]
        },
        { signal: c.signal },
      )
      if (result) {
        setOutput(result)
        setPhase('done')
      }
    } catch (e) {
      if (isAbortError(e)) toast(t('errors.canceled'))
      else {
        console.error(e)
        toast.error(t('stitch.exportFailed'))
      }
      setPhase('edit')
    } finally {
      setCtrl(null)
    }
  }, [run, t])

  useModuleShortcuts([
    { keys: [modKey(), 'Z'], label: t('stitch.shortcuts.undo') },
    { keys: [modKey(), 'Shift', 'Z'], label: t('stitch.shortcuts.redo') },
    { keys: ['←', '↑', '→', '↓'], label: t('stitch.shortcuts.nudge') },
    { keys: [modKey(), 'D'], label: t('stitch.shortcuts.duplicate') },
    { keys: ['Delete'], label: t('stitch.shortcuts.delete') },
    { keys: [modKey(), 'Enter'], label: t('stitch.shortcuts.export') },
  ])
  useStitchKeys(phase === 'edit', exportImage)

  const stage = items.length === 0 && !loading ? 'empty' : phase
  return (
    <ModulePage module="stitch" wide>
      <DropTarget onFiles={(f) => void add(f)} accept={ACCEPT}>
        <StageContainer stage={stage}>
          {stage === 'empty' ? (
            <div data-tour="dropzone">
              <DropZone
                onFiles={(f) => void add(f)}
                accept={ACCEPT}
                title={t('stitch.drop.title')}
                formats={t('stitch.drop.formats')}
                browseLabel={t('stitch.drop.browse')}
                illustration={<EmptyIllustration module="stitch" />}
              >
                <p className="mt-3 max-w-md text-caption text-text-3">{t('stitch.drop.hint')}</p>
              </DropZone>
            </div>
          ) : phase === 'working' ? (
            <WorkingCard progress={progress} onCancel={() => ctrl?.abort()} />
          ) : phase === 'done' && output ? (
            <ResultView
              output={output}
              onBack={() => {
                setPhase('edit')
              }}
            />
          ) : (
            <Workspace main={<Editor onAdd={(f) => void add(f)} />} panel={<Panel onExport={() => void exportImage()} />} />
          )}
        </StageContainer>
      </DropTarget>
      {items.length > 0 && phase === 'edit' && (
        <TopBarActions>
          <Button variant="primary" size="sm" leading={<Download size={14} aria-hidden />} onClick={() => void exportImage()}>
            {t('stitch.exportShort')}
          </Button>
        </TopBarActions>
      )}
    </ModulePage>
  )
}

async function renderStitch(
  items: StitchItem[],
  o: StitchOptions,
  signal: AbortSignal,
  onProgress: (p: number) => void,
): Promise<Output> {
  const b = bounds(items)
  const W = b.w + o.padding * 2
  const H = b.h + o.padding * 2
  const s = exportScale(W, H, o.scale)
  const canvas = createCanvas(W * s, H * s)
  try {
    const ctx = canvas.getContext('2d')!
    const alpha = o.transparent && o.format !== 'jpeg'
    if (!alpha) {
      ctx.fillStyle = o.background
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.imageSmoothingQuality = 'high'
    for (let i = 0; i < items.length; i++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const it = items[i]
      const bmp = await decodeAny(it.file)
      const x = (it.x - b.x + o.padding) * s
      const y = (it.y - b.y + o.padding) * s
      const w = it.w * s
      const h = it.h * s
      ctx.save()
      if (o.radius > 0) {
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, o.radius * s)
        ctx.clip()
      }
      ctx.drawImage(bmp, x, y, w, h)
      ctx.restore()
      bmp.close()
      onProgress(((i + 1) / items.length) * 0.8)
    }
    const mime = `image/${o.format}`
    const blob = await canvasToBlob(canvas, mime, o.format === 'png' ? undefined : o.quality / 100)
    onProgress(1)
    const base = items[0].name.replace(/\.[^.]+$/, '')
    const ext = o.format === 'jpeg' ? 'jpg' : o.format
    return {
      blob,
      url: URL.createObjectURL(blob),
      name: `${base}_stitched.${ext}`,
      w: canvas.width,
      h: canvas.height,
    }
  } finally {
    releaseCanvas(canvas)
  }
}

function useStitchKeys(active: boolean, onExport: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      const st = useStitch.getState()
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        st.redo()
        return
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault()
        onExport()
        return
      }
      const sel = st.items.find((i) => i.id === st.selected)
      if (!sel) return
      // 焦點在滑桿、選項、選單等自帶方向鍵／刪除鍵行為的控制項上時，不搬動圖片
      if (el?.closest('[role="slider"],[role="radio"],[role="tab"],[role="menuitem"],[role="option"],[role="combobox"],select'))
        return
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        st.duplicate(sel.id)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        st.remove(sel.id)
      } else if (e.key === 'Escape') st.select(null)
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const d = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
        st.commit(st.items.map((i) => (i.id === sel.id ? { ...i, x: i.x + dx, y: i.y + dy } : i)))
        st.setFlow('free')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onExport])
}

function Editor({ onAdd }: { onAdd: (f: File[]) => void }) {
  const t = useT()
  const loading = useStitch((s) => s.loading)
  const canUndo = useStitch((s) => s.past.length > 0)
  const canRedo = useStitch((s) => s.future.length > 0)
  const flow = useStitch((s) => s.flow)
  const layout = useStitch((s) => s.layout)
  return (
    <div className="flex flex-col gap-3">
      <div className="card flex flex-wrap items-center gap-2 p-2" data-tour="stitch-toolbar">
        <SegmentedControl<'vertical' | 'horizontal' | 'free'>
          label={t('stitch.flow')}
          size="sm"
          value={flow}
          onChange={(f) => (f === 'free' ? useStitch.getState().setFlow('free') : layout(f))}
          options={[
            { value: 'vertical', label: <span className="inline-flex items-center gap-1.5"><GalleryVertical size={14} aria-hidden />{t('stitch.vertical')}</span> },
            { value: 'horizontal', label: <span className="inline-flex items-center gap-1.5"><GalleryHorizontal size={14} aria-hidden />{t('stitch.horizontal')}</span> },
            { value: 'free', label: <span className="inline-flex items-center gap-1.5"><Move size={14} aria-hidden />{t('stitch.free')}</span> },
          ]}
        />
        <Tooltip content={t('stitch.matchHint')}>
          <Button
            size="sm"
            variant="ghost"
            leading={<Wand2 size={14} aria-hidden />}
            onClick={() => layout(flow === 'horizontal' ? 'horizontal' : 'vertical', { match: true })}
          >
            {flow === 'horizontal' ? t('stitch.matchHeight') : t('stitch.matchWidth')}
          </Button>
        </Tooltip>
        <div className="ml-auto flex items-center gap-1">
          {loading > 0 && (
            <span className="mr-2 text-caption text-text-3" aria-live="polite">
              {t('stitch.loading', { count: loading })}
            </span>
          )}
          <Tooltip content={t('common.undo')}>
            <Button icon size="sm" variant="ghost" aria-label={t('common.undo')} disabled={!canUndo} onClick={() => useStitch.getState().undo()}>
              <Undo2 size={15} aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content={t('common.redo')}>
            <Button icon size="sm" variant="ghost" aria-label={t('common.redo')} disabled={!canRedo} onClick={() => useStitch.getState().redo()}>
              <Redo2 size={15} aria-hidden />
            </Button>
          </Tooltip>
          <AddFilesButton onFiles={onAdd} accept={ACCEPT} size="sm" label={t('stitch.add')} />
        </div>
      </div>
      <Stage />
      <p className="text-center text-caption text-text-3">{t('stitch.hint')}</p>
    </div>
  )
}

function LayerRow({ item, index }: { item: StitchItem; index: number }) {
  const t = useT()
  const controls = useDragControls()
  const selected = useStitch((s) => s.selected === item.id)
  return (
    <Reorder.Item
      value={item.id}
      dragListener={false}
      dragControls={controls}
      layout="position"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12, transition: { duration: 0.15 } }}
      transition={{ ...spring.smooth, delay: staggerDelay(Math.min(index, 8)) }}
      className={cn(
        'flex items-center gap-2 rounded-md border p-1.5 pr-1 transition-colors',
        selected ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))]' : 'border-border bg-surface',
      )}
      onClick={() => useStitch.getState().select(item.id)}
    >
      <button
        type="button"
        aria-label={t('a11y.dragHandle')}
        className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded text-text-3 hover:bg-surface-2"
        onPointerDown={(e) => controls.start(e)}
      >
        <GripVertical size={14} aria-hidden />
      </button>
      <img src={item.url} alt="" className="size-9 shrink-0 rounded object-cover ring-1 ring-border" draggable={false} />
      <div className="min-w-0 flex-1">
        <FileName name={item.name} className="text-small font-medium" />
        <p className="text-[11px] tabular-nums text-text-3">
          {Math.round(item.w)} × {Math.round(item.h)}
        </p>
      </div>
      <Tooltip content={t('stitch.duplicate')}>
        <Button icon size="sm" variant="ghost" aria-label={t('stitch.duplicate')} onClick={(e) => (e.stopPropagation(), useStitch.getState().duplicate(item.id))}>
          <Copy size={14} aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip content={t('common.remove')}>
        <Button icon size="sm" variant="ghost" aria-label={t('common.remove')} onClick={(e) => (e.stopPropagation(), useStitch.getState().remove(item.id))}>
          <Trash2 size={14} aria-hidden />
        </Button>
      </Tooltip>
    </Reorder.Item>
  )
}

function Panel({ onExport }: { onExport: () => void }) {
  const t = useT()
  const items = useStitch((s) => s.items)
  const o = useStitch((s) => s.options)
  const flow = useStitch((s) => s.flow)
  const setO = useStitch((s) => s.setOptions)
  const b = bounds(items)
  const W = b.w + o.padding * 2
  const H = b.h + o.padding * 2
  const s = exportScale(W, H, o.scale)
  const limited = s < o.scale - 0.001
  const vertical = flow !== 'horizontal'
  const alignIcons: Record<Align, typeof AlignStartVertical> = vertical
    ? { start: AlignStartVertical, center: AlignCenterVertical, end: AlignEndVertical }
    : { start: AlignStartHorizontal, center: AlignCenterHorizontal, end: AlignEndHorizontal }
  return (
    <section className="card flex flex-col overflow-hidden lg:max-h-[calc(100dvh-var(--topbar-h)-32px)]">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <h3 className="text-h3 font-semibold">{t('stitch.layoutTitle')}</h3>
        <Switch
          label={t('stitch.snap')}
          description={t('stitch.snapHint')}
          checked={o.snap}
          onChange={(snap) => setO({ snap })}
        />
        <SliderField label={t('stitch.gap')} value={o.gap} min={0} max={120} onChange={(gap) => setO({ gap })} format={(v) => `${v} px`} />
        {flow !== 'free' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-small font-medium text-text-2">{t('stitch.align')}</span>
            <SegmentedControl<Align>
              label={t('stitch.align')}
              full
              size="sm"
              value={o.align}
              onChange={(align) => setO({ align })}
              options={(['start', 'center', 'end'] as const).map((a) => {
                const I = alignIcons[a]
                return { value: a, label: <I size={15} aria-label={t(`stitch.align_${a}`)} />, title: t(`stitch.align_${a}`) }
              })}
            />
          </div>
        )}
        <SliderField label={t('stitch.padding')} value={o.padding} min={0} max={200} onChange={(padding) => setO({ padding })} format={(v) => `${v} px`} />
        <SliderField label={t('stitch.radius')} value={o.radius} min={0} max={80} onChange={(radius) => setO({ radius })} format={(v) => `${v} px`} />
        <ColorPicker label={t('stitch.background')} value={o.background} onChange={(background) => setO({ background })} />
        <Switch
          label={t('stitch.transparent')}
          checked={o.transparent}
          disabled={o.format === 'jpeg'}
          onChange={(transparent) => setO({ transparent })}
        />
        <div className="flex flex-col gap-2" data-tour="stitch-layers">
          <div className="flex items-center justify-between">
            <span className="text-small font-semibold">{t('stitch.layers', { count: items.length })}</span>
            <button
              type="button"
              className="flex items-center gap-1 text-caption text-text-3 hover:text-text"
              onClick={() => useStitch.getState().clear()}
            >
              <RotateCcw size={12} aria-hidden />
              {t('common.clearAll')}
            </button>
          </div>
          <Reorder.Group
            axis="y"
            values={items.map((i) => i.id)}
            onReorder={(ids) => useStitch.getState().reorder(ids)}
            className="flex flex-col gap-1.5"
          >
            <AnimatePresence initial={false}>
              {items.map((it, i) => (
                <LayerRow key={it.id} item={it} index={i} />
              ))}
            </AnimatePresence>
          </Reorder.Group>
        </div>
        <h3 className="mt-2 text-h3 font-semibold">{t('stitch.exportTitle')}</h3>
        <SegmentedControl<StitchOptions['format']>
          label={t('common.format')}
          full
          size="sm"
          value={o.format}
          onChange={(format) => setO({ format, transparent: format === 'jpeg' ? false : o.transparent })}
          options={[
            { value: 'jpeg', label: 'JPG' },
            { value: 'png', label: 'PNG' },
            { value: 'webp', label: 'WebP' },
          ]}
        />
        {o.format !== 'png' && (
          <SliderField label={t('common.quality')} value={o.quality} min={40} max={100} onChange={(quality) => setO({ quality })} />
        )}
        <SegmentedControl
          label={t('stitch.scale')}
          full
          size="sm"
          value={String(o.scale)}
          onChange={(v) => setO({ scale: Number(v) })}
          options={[
            { value: '0.5', label: '50%' },
            { value: '0.75', label: '75%' },
            { value: '1', label: '100%' },
            { value: '2', label: '200%' },
          ]}
        />
        <p className={cn('text-caption tabular-nums', limited ? 'text-warning-ink' : 'text-text-3')}>
          {limited
            ? t('stitch.limited', { w: Math.round(W * s), h: Math.round(H * s) })
            : t('stitch.output', { w: Math.round(W * s), h: Math.round(H * s) })}
        </p>
        <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-auto flex flex-col gap-2 border-t border-border bg-surface p-4">
          <Button variant="primary" size="lg" className="w-full" leading={<Download size={18} aria-hidden />} onClick={onExport}>
            {t('stitch.export')}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-caption text-text-3">
            <Magnet size={12} aria-hidden /> {t('stitch.altHint')}
          </p>
        </div>
      </div>
    </section>
  )
}

function WorkingCard({ progress, onCancel }: { progress: number; onCancel: () => void }) {
  const t = useT()
  return (
    <section className="card flex flex-col items-center gap-6 px-6 py-10 text-center">
      <div className="relative h-28 w-24">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute inset-x-2 h-8 rounded-md bg-gradient-to-br from-[var(--m-1)] to-[var(--m-2)] shadow-e2"
            initial={{ y: -40, opacity: 0, rotate: i % 2 ? 6 : -6 }}
            animate={{ y: [-40, i * 34, i * 34, -40], opacity: [0, 1, 1, 0], rotate: [i % 2 ? 6 : -6, 0, 0, 0] }}
            transition={{ duration: 2.2, times: [0, 0.35, 0.8, 1], repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
          />
        ))}
      </div>
      <div className="w-full max-w-md">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-h3 font-semibold">{t('stitch.working')}</h3>
          <span className="text-small tabular-nums text-text-2">{Math.round(progress * 100)}%</span>
        </div>
        <ProgressBar value={progress} label={t('stitch.working')} />
      </div>
      <Button variant="secondary" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </section>
  )
}

function ResultView({ output, onBack }: { output: Output; onBack: () => void }) {
  const t = useT()
  const tall = output.h > output.w
  return (
    <section className="card grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:p-6">
      <motion.div
        className="grid max-h-[70dvh] place-items-center overflow-auto rounded-lg bg-surface-2 p-4"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={spring.smooth}
      >
        <motion.img
          src={output.url}
          alt={output.name}
          className={cn('rounded-[4px] shadow-e3', tall ? 'w-auto max-w-full' : 'h-auto max-h-[64dvh] max-w-full')}
          style={tall ? { maxWidth: 'min(100%, 520px)' } : undefined}
          initial={{ clipPath: tall ? 'inset(0 0 100% 0)' : 'inset(0 100% 0 0)' }}
          animate={{ clipPath: 'inset(0 0 0% 0)' }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
        />
      </motion.div>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <SuccessCheck size={44} />
          <div>
            <h3 className="text-h2 font-semibold">{t('stitch.doneTitle')}</h3>
            <p className="text-small tabular-nums text-text-2">
              {output.w} × {output.h} · {formatBytes(output.blob.size)}
            </p>
          </div>
        </div>
        <FileName name={output.name} className="text-body text-text-2" />
        <Button
          variant="primary"
          size="lg"
          leading={<Download size={18} aria-hidden />}
          onClick={async () => {
            if (await saveLargeBlob(output.blob, output.name)) toast.success(t('pdf.result.downloaded'))
          }}
        >
          {t('common.download')}
        </Button>
        <SendToMenu
          from="stitch"
          targets={['tools', 'convert', 'pdfconvert']}
          getFiles={() => [asFile(output.blob, output.name)]}
        />
        <Button variant="ghost" leading={<RotateCcw size={16} aria-hidden />} onClick={onBack}>
          {t('stitch.backToEdit')}
        </Button>
      </div>
    </section>
  )
}
