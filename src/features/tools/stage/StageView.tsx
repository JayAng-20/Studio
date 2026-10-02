/**
 * 中央畫布：依目前分頁顯示「整張轉正後的畫面＋裁切框」或「最終成品」，
 * 壓縮分頁時換成前後對比滑桿。預覽用縮小的代理圖即時重算；拖曳中先用 1× 解析度，
 * 停下來後再補一張清晰的。
 */
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CompareSlider, Spinner } from '@/components/ui'
import { createCanvas, releaseCanvas } from '@/lib/image'
import { duration, sec } from '@/design/motion'
import { useT } from '@/i18n'
import { cropRect, frameOf, outputSize } from '../lib/geometry'
import { renderEdit } from '../lib/render'
import { defaultEditState, type EditState, type Rect } from '../lib/types'
import { useEstimate } from '../estimate'
import { useTools, type Doc } from '../store'
import { useBitmap, useColorStore, useElementSize, useViewStore } from '../ui'
import { CropOverlay } from './CropOverlay'
import { PickOverlay } from './PickOverlay'
import { RedactOverlay } from './RedactOverlay'

/** 顯示區與圖片之間的留白（裁切把手需要空間） */
const PAD = 28
/** 小圖最多放大到 2 倍顯示 */
const MAX_ZOOM = 2

export function StageView({ doc, state }: { doc: Doc; state: EditState }) {
  const t = useT()
  const tab = useTools((s) => s.tab)
  const peek = useViewStore((s) => s.peek)
  const compare = useViewStore((s) => s.compare)
  const picking = useColorStore((s) => s.picking)
  const estimate = useEstimate()
  const [setBox, box] = useElementSize<HTMLDivElement>()
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)

  const ready = doc.status === 'ready' && !!doc.proxy
  const mode: 'frame' | 'final' = tab === 'crop' && !peek ? 'frame' : 'final'
  const frame = frameOf(state.geometry, doc.srcW, doc.srcH)
  const crop = cropRect(state.geometry, doc.srcW, doc.srcH)
  const out = outputSize(state, doc.srcW, doc.srcH)
  // 內容大小（邏輯像素）：原圖／框架／成品
  const content = peek
    ? { w: doc.srcW, h: doc.srcH }
    : mode === 'frame'
      ? { w: frame.w, h: frame.h }
      : { w: out.w, h: out.h }
  const pad = box.w < 520 ? PAD / 2 : PAD
  const avail = { w: Math.max(0, box.w - pad * 2), h: Math.max(0, box.h - pad * 2) }
  const k =
    content.w && content.h && avail.w > 0 && avail.h > 0
      ? Math.min(avail.w / content.w, avail.h / content.h, MAX_ZOOM)
      : 0
  const disp = {
    w: Math.max(1, Math.round(content.w * k)),
    h: Math.max(1, Math.round(content.h * k)),
  }

  const showCompare =
    tab === 'compress' &&
    compare &&
    !peek &&
    estimate.docId === doc.id &&
    !!estimate.url &&
    estimate.status !== 'error'

  const wmBitmap = useBitmap(state.watermark.kind === 'image' ? state.watermark.image : null)

  // 重新繪製
  const lastAt = useRef(0)
  const refining = useRef(false)
  const [refine, setRefine] = useState(0)
  useEffect(() => {
    if (!ready || !canvasEl || k <= 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const raf = requestAnimationFrame(() => {
      const now = performance.now()
      const interactive = !refining.current && now - lastAt.current < 140
      refining.current = false
      lastAt.current = now
      const dpr = interactive ? 1 : Math.min(2, window.devicePixelRatio || 1)
      let scale: number
      if (peek) scale = (disp.w * dpr) / doc.srcW
      else if (mode === 'final') scale = Math.min(1, (disp.w * dpr) / out.w)
      else scale = (disp.w * dpr) / frame.w
      let result: HTMLCanvasElement | OffscreenCanvas
      try {
        result = renderEdit({
          source: doc.proxy!,
          srcW: doc.srcW,
          srcH: doc.srcH,
          state: peek ? PEEK_STATE : state,
          stage: peek ? 'frame' : mode,
          scale,
          make: createCanvas,
          watermarkImage: wmBitmap,
          geometryOnly: peek,
        })
      } catch (e) {
        console.error(e)
        return
      }
      canvasEl.width = result.width
      canvasEl.height = result.height
      canvasEl.getContext('2d')?.drawImage(result, 0, 0)
      releaseCanvas(result as HTMLCanvasElement)
      if (interactive)
        timer = setTimeout(() => {
          refining.current = true
          setRefine((n) => n + 1)
        }, 180)
    })
    return () => {
      cancelAnimationFrame(raf)
      if (timer) clearTimeout(timer)
    }
    // refine 只用來觸發補畫
  }, [ready, canvasEl, k, disp.w, disp.h, doc, state, mode, peek, wmBitmap, out.w, frame.w, refine])

  const edit = useTools((s) => s.edit)
  const commitCrop = useCallback(
    (rect: Rect | null, kind: 'crop' | 'nudge') =>
      edit(
        doc.id,
        t('tools.crop.actions.crop'),
        (s) => ({ ...s, geometry: { ...s.geometry, crop: rect } }),
        kind === 'nudge' ? 'crop-nudge' : undefined,
      ),
    [doc.id, edit, t],
  )

  const canvas = (
    <canvas ref={setCanvasEl} className="block size-full" role="img" aria-label={doc.name} />
  )

  return (
    <div ref={setBox} className="tl-stage relative size-full overflow-hidden">
      {!ready ? (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner size={36} />
        </div>
      ) : (
        <div
          className="tl-checker tl-image-shadow absolute left-1/2 top-1/2"
          style={{
            width: disp.w,
            height: disp.h,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {showCompare ? (
            <div className="absolute inset-0">
              <CompareSlider
                className="size-full rounded-none!"
                before={canvas}
                after={
                  <img src={estimate.url!} alt="" className="block size-full" draggable={false} />
                }
                beforeLabel={t('tools.compress.before')}
                afterLabel={t('tools.compress.after')}
              />
            </div>
          ) : (
            canvas
          )}
          {!peek && mode === 'frame' && (
            <CropOverlay doc={doc} state={state} k={k} onCommit={commitCrop} />
          )}
          {!peek && tab === 'redact' && (
            <RedactOverlay
              doc={doc}
              state={state}
              kx={disp.w / crop.w}
              ky={disp.h / crop.h}
              onAction={(a) =>
                edit(
                  doc.id,
                  t(
                    a.type === 'add'
                      ? 'tools.redact.actions.add'
                      : a.type === 'move'
                        ? 'tools.redact.actions.move'
                        : 'tools.redact.actions.remove',
                  ),
                  (s) => ({
                    ...s,
                    redactions:
                      a.type === 'add'
                        ? [...s.redactions, { id: a.id, rect: a.rect, mode: a.mode }]
                        : a.type === 'move'
                          ? s.redactions.map((r) => (r.id === a.id ? { ...r, rect: a.rect } : r))
                          : s.redactions.filter((r) => r.id !== a.id),
                  }),
                  a.type === 'move' ? `redact-move-${a.id}` : undefined,
                )
              }
            />
          )}
          {!peek && picking && tab === 'color' && <PickOverlay canvas={canvasEl} />}
        </div>
      )}
      <AnimatePresence>
        {peek && (
          <motion.span
            className="pointer-events-none absolute left-3 top-3 rounded-full bg-[rgba(10,12,16,.62)] px-2.5 py-1 text-caption font-medium text-white backdrop-blur"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: sec(duration.fast) }}
          >
            {t('tools.toolbar.original')}
          </motion.span>
        )}
        {tab === 'compress' && compare && estimate.status === 'running' && (
          <motion.span
            className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[rgba(10,12,16,.62)] px-3 py-1 text-caption font-medium text-white backdrop-blur"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: sec(duration.fast) }}
          >
            <Spinner size={14} />
            {t('tools.compress.estimating')}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 「按住看原圖」：完全不套用任何編輯 */
const PEEK_STATE: EditState = defaultEditState()
