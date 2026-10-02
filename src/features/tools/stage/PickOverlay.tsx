/**
 * 在畫布上取色：游標旁顯示放大鏡（11×11 像素放大）與色碼，點一下選取。
 * 觸控時放大鏡顯示在手指上方，放開即選取。
 */
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { spring } from '@/design/motion'
import { useT } from '@/i18n'
import { toast } from '@/components/ui'
import { isLight, toHex } from '../lib/color'
import { useColorStore } from '../ui'

const N = 11
const ZOOM = 9

export function PickOverlay({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const t = useT()
  const addPick = useColorStore((s) => s.addPick)
  const ref = useRef<HTMLDivElement>(null)
  const loupe = useRef<HTMLCanvasElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; hex: string; touch: boolean } | null>(null)

  const sample = (clientX: number, clientY: number) => {
    const el = ref.current
    if (!el || !canvas || !canvas.width) return null
    const r = el.getBoundingClientRect()
    const px = Math.floor(((clientX - r.left) / r.width) * canvas.width)
    const py = Math.floor(((clientY - r.top) / r.height) * canvas.height)
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const d = ctx.getImageData(px, py, 1, 1).data
    const hex = toHex({ r: d[0], g: d[1], b: d[2] })
    // 放大鏡
    const lc = loupe.current?.getContext('2d')
    if (lc) {
      lc.imageSmoothingEnabled = false
      lc.clearRect(0, 0, N * ZOOM, N * ZOOM)
      lc.drawImage(canvas, px - (N >> 1), py - (N >> 1), N, N, 0, 0, N * ZOOM, N * ZOOM)
    }
    return { x: clientX - r.left, y: clientY - r.top, hex }
  }

  const move = (e: PointerEvent) => {
    const s = sample(e.clientX, e.clientY)
    setPos(s ? { ...s, touch: e.pointerType !== 'mouse' } : null)
  }

  const pick = (e: PointerEvent) => {
    const s = sample(e.clientX, e.clientY)
    if (!s) return
    addPick(s.hex)
    toast.success(t('tools.color.picked'), { description: s.hex, duration: 1600 })
  }

  // Esc 結束取色
  const setPicking = useColorStore((s) => s.setPicking)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPicking(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPicking])

  const rgb = pos
    ? {
        r: parseInt(pos.hex.slice(1, 3), 16),
        g: parseInt(pos.hex.slice(3, 5), 16),
        b: parseInt(pos.hex.slice(5, 7), 16),
      }
    : null

  return (
    <div
      ref={ref}
      role="application"
      aria-label={t('tools.color.picking')}
      className="absolute inset-0 cursor-crosshair"
      style={{ touchAction: 'none' }}
      onPointerMove={move}
      onPointerDown={(e) => {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        move(e)
      }}
      onPointerUp={pick}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setPos(null)}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute z-30"
        style={{
          left: pos?.x ?? 0,
          top: pos?.y ?? 0,
          x: '-50%',
          y: pos?.touch ? 'calc(-100% - 36px)' : '-50%',
        }}
        initial={false}
        animate={{ opacity: pos ? 1 : 0, scale: pos ? 1 : 0.6 }}
        transition={spring.snappy}
      >
        <div
          className="relative size-[99px] overflow-hidden rounded-full border-[3px] border-white shadow-e3"
          style={{ background: pos?.hex }}
        >
          <canvas ref={loupe} width={N * ZOOM} height={N * ZOOM} className="tl-loupe size-full" />
          <span className="absolute left-1/2 top-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 border border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]" />
        </div>
        {pos && rgb && (
          <span
            className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 rounded-full px-2 py-0.5 font-mono text-caption shadow-e2"
            style={{ background: pos.hex, color: isLight(rgb) ? '#0F172A' : '#FFFFFF' }}
          >
            {pos.hex}
          </span>
        )}
      </motion.div>
    </div>
  )
}
