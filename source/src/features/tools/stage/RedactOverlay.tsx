/**
 * 遮蔽區域：在畫面上拖曳框出新區域；選取後可拖曳移動、方向鍵微調、Delete 刪除。
 * 區域存在框架座標（跟著內容走），這裡換算成顯示座標。
 */
import { AnimatePresence, motion } from 'motion/react'
import { Grid3x3, Square, X } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { create } from 'zustand'
import { spring } from '@/design/motion'
import { uid } from '@/lib/files'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { clampRect, cropRect, frameOf } from '../lib/geometry'
import type { EditState, RedactMode, Rect } from '../lib/types'
import type { Doc } from '../store'

interface RedactUi {
  mode: RedactMode
  selected: string | null
  setMode: (m: RedactMode) => void
  select: (id: string | null) => void
}
export const useRedactUi = create<RedactUi>((set) => ({
  mode: 'mosaic',
  selected: null,
  setMode: (mode) => set({ mode }),
  select: (selected) => set({ selected }),
}))

type Action =
  | { type: 'add'; rect: Rect; mode: RedactMode; id: string }
  | { type: 'move'; id: string; rect: Rect }
  | { type: 'remove'; id: string }

interface Draft {
  kind: 'draw' | 'move'
  id?: string
  start: { x: number; y: number }
  origin?: Rect
  rect: Rect
  pointerId: number
}

export function RedactOverlay({
  doc,
  state,
  kx,
  ky,
  onAction,
}: {
  doc: Doc
  state: EditState
  kx: number
  ky: number
  onAction: (a: Action) => void
}) {
  const t = useT()
  const { mode, selected, select } = useRedactUi()
  const frame = frameOf(state.geometry, doc.srcW, doc.srcH)
  const crop = cropRect(state.geometry, doc.srcW, doc.srcH)
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const toFrame = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: crop.x + (clientX - r.left) / kx, y: crop.y + (clientY - r.top) / ky }
  }
  const toDisp = (r: Rect) => ({
    left: (r.x - crop.x) * kx,
    top: (r.y - crop.y) * ky,
    width: r.w * kx,
    height: r.h * ky,
  })

  const down = (e: PointerEvent, id?: string) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    ref.current!.setPointerCapture(e.pointerId)
    const p = toFrame(e.clientX, e.clientY)
    if (id) {
      const region = state.redactions.find((r) => r.id === id)
      if (!region) return
      select(id)
      setDraft({
        kind: 'move',
        id,
        start: p,
        origin: region.rect,
        rect: region.rect,
        pointerId: e.pointerId,
      })
    } else {
      select(null)
      setDraft({
        kind: 'draw',
        start: p,
        rect: { x: p.x, y: p.y, w: 0, h: 0 },
        pointerId: e.pointerId,
      })
    }
  }

  const move = (e: PointerEvent) => {
    if (!draft || e.pointerId !== draft.pointerId) return
    const p = toFrame(e.clientX, e.clientY)
    if (draft.kind === 'draw') {
      const x0 = Math.max(crop.x, Math.min(draft.start.x, p.x))
      const y0 = Math.max(crop.y, Math.min(draft.start.y, p.y))
      const x1 = Math.min(crop.x + crop.w, Math.max(draft.start.x, p.x))
      const y1 = Math.min(crop.y + crop.h, Math.max(draft.start.y, p.y))
      setDraft({ ...draft, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } })
    } else if (draft.origin) {
      const r = clampRect(
        {
          ...draft.origin,
          x: draft.origin.x + p.x - draft.start.x,
          y: draft.origin.y + p.y - draft.start.y,
        },
        frame.w,
        frame.h,
      )
      setDraft({ ...draft, rect: r })
    }
  }

  const up = (e: PointerEvent) => {
    if (!draft || e.pointerId !== draft.pointerId) return
    const d = draft
    setDraft(null)
    const r = round(d.rect)
    if (d.kind === 'draw') {
      // 太小視為誤觸
      if (r.w * kx < 6 || r.h * ky < 6) return
      const id = uid('rd')
      onAction({ type: 'add', rect: r, mode, id })
      select(id)
    } else if (d.id && d.origin && (r.x !== d.origin.x || r.y !== d.origin.y)) {
      onAction({ type: 'move', id: d.id, rect: r })
    }
  }

  const onKey = (e: KeyboardEvent, id: string, rect: Rect) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onAction({ type: 'remove', id })
      select(null)
      return
    }
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const dir = dirs[e.key]
    if (!dir) return
    e.preventDefault()
    const step = (e.shiftKey ? 10 : 1) / kx
    onAction({
      type: 'move',
      id,
      rect: round(
        clampRect(
          { ...rect, x: rect.x + dir[0] * step, y: rect.y + dir[1] * step },
          frame.w,
          frame.h,
        ),
      ),
    })
  }

  return (
    <div
      ref={ref}
      className="absolute inset-0 cursor-crosshair overflow-hidden"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => down(e)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <AnimatePresence initial={false}>
        {state.redactions.map((r, i) => {
          const rect = draft?.kind === 'move' && draft.id === r.id ? draft.rect : r.rect
          const active = selected === r.id
          return (
            <motion.div
              key={r.id}
              role="button"
              tabIndex={0}
              aria-label={`${t('tools.redact.item', { n: i + 1 })}，${t(r.mode === 'black' ? 'tools.redact.black' : 'tools.redact.mosaic')}`}
              aria-pressed={active}
              onPointerDown={(e) => down(e, r.id)}
              onFocus={() => select(r.id)}
              onKeyDown={(e) => onKey(e, r.id, r.rect)}
              className={cn(
                'absolute cursor-move rounded-[3px] outline-none',
                active
                  ? 'shadow-[0_0_0_2px_var(--accent),0_0_0_4px_rgba(255,255,255,.7)]'
                  : 'shadow-[0_0_0_1.5px_rgba(255,255,255,.85),0_0_0_3px_rgba(0,0,0,.25)] hover:shadow-[0_0_0_2px_var(--accent)]',
              )}
              style={toDisp(rect)}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={spring.snappy}
            >
              <span className="pointer-events-none absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-[rgba(10,12,16,.6)] text-white">
                {r.mode === 'black' ? (
                  <Square size={11} aria-hidden />
                ) : (
                  <Grid3x3 size={11} aria-hidden />
                )}
              </span>
              {active && (
                <button
                  type="button"
                  aria-label={t('tools.redact.remove', { n: i + 1 })}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onAction({ type: 'remove', id: r.id })
                    select(null)
                  }}
                  className="absolute -right-3 -top-3 grid size-7 place-items-center rounded-full bg-surface text-text shadow-e3 hover:text-danger-ink [@media(pointer:coarse)]:size-10"
                >
                  <X size={14} aria-hidden />
                </button>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
      {draft?.kind === 'draw' && draft.rect.w > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[3px] border-2 border-dashed border-white bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] shadow-[0_0_0_1px_rgba(0,0,0,.3)]"
          style={toDisp(draft.rect)}
        />
      )}
    </div>
  )
}

const round = (r: Rect): Rect => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  w: Math.max(1, Math.round(r.w)),
  h: Math.max(1, Math.round(r.h)),
})
