import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'
import { clamp } from '@/lib/format'
import { useGT } from '../useGT'
import { useGifStore } from '../store'
import { measureText, textVisible, type Geometry } from '../render'

let measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  return measureCtx
}

/** 預覽上的文字框：可拖曳移動、方向鍵微調、點選後在下方編輯 */
export function TextOverlayBoxes({
  view,
  outT,
  selected,
  onSelect,
}: {
  view: Geometry
  outT: number
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const t = useGT()
  const texts = useGifStore((s) => s.texts)
  const updateText = useGifStore((s) => s.updateText)
  const drag = useRef<{ id: string; px: number; py: number; x: number; y: number; w: number; h: number } | null>(
    null,
  )
  const ctx = getMeasureCtx()
  if (!ctx) return null

  const down = (e: PointerEvent<HTMLButtonElement>, id: string, x: number, y: number) => {
    const box = e.currentTarget.parentElement?.getBoundingClientRect()
    if (!box) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id, px: e.clientX, py: e.clientY, x, y, w: box.width, h: box.height }
    onSelect(id)
  }
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    updateText(d.id, {
      x: clamp(d.x + (e.clientX - d.px) / d.w, 0, 1),
      y: clamp(d.y + (e.clientY - d.py) / d.h, 0, 1),
    })
  }
  const up = () => {
    drag.current = null
  }
  const key = (e: KeyboardEvent, id: string, x: number, y: number) => {
    const step = e.shiftKey ? 0.05 : 0.01
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const d = map[e.key]
    if (!d) return
    e.preventDefault()
    updateText(id, { x: clamp(x + d[0], 0, 1), y: clamp(y + d[1], 0, 1) })
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {texts.map((layer, i) => {
        const visible = textVisible(layer, outT)
        if (!visible && layer.id !== selected) return null
        if (!layer.text.trim()) return null
        const r = measureText(ctx, layer, view.outW, view.outH)
        return (
          <button
            key={layer.id}
            type="button"
            aria-label={`${t('text.select')}：${t('text.layer', { index: i + 1 })}`}
            aria-pressed={layer.id === selected}
            onPointerDown={(e) => down(e, layer.id, layer.x, layer.y)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onKeyDown={(e) => key(e, layer.id, layer.x, layer.y)}
            onClick={() => onSelect(layer.id)}
            className={cn(
              'pointer-events-auto absolute cursor-move touch-none rounded-xs outline-none transition-[box-shadow,opacity] duration-(--dur-fast)',
              'hover:shadow-[0_0_0_1.5px_rgba(255,255,255,.9),0_0_0_3px_rgba(0,0,0,.35)]',
              'focus-visible:shadow-[0_0_0_2px_var(--accent)]',
              layer.id === selected && 'shadow-[0_0_0_2px_var(--accent),0_0_0_4px_rgba(255,255,255,.6)]',
              !visible && 'opacity-40',
            )}
            style={{
              left: `${(r.x / view.outW) * 100}%`,
              top: `${(r.y / view.outH) * 100}%`,
              width: `${(r.w / view.outW) * 100}%`,
              height: `${(r.h / view.outH) * 100}%`,
            }}
          />
        )
      })}
    </div>
  )
}
