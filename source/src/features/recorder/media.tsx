/** 小型媒體元件：音量條、Blob 圖片、MediaStream 影片 */
import { useEffect, useRef, type CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { bandLevels } from './core'

/**
 * 音量條：AnalyserNode 的頻帶以 rAF 跳動（只改 transform）。
 * 快速上升、緩慢回落；沒有 analyser 時維持最低高度。
 * 用元素所在視窗的 rAF，放進 Document PiP 視窗時也能動。
 */
export function LevelMeter({
  analyser,
  bars = 12,
  className,
  barClassName,
  muted,
  style,
}: {
  analyser: AnalyserNode | null
  bars?: number
  className?: string
  barClassName?: string
  muted?: boolean
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const win = el.ownerDocument.defaultView ?? window
    const nodes = Array.from(el.children) as HTMLElement[]
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    const smooth = new Array<number>(bars).fill(0)
    let raf = 0
    const loop = () => {
      const levels =
        analyser && data && !muted
          ? (analyser.getByteFrequencyData(data), bandLevels(data, bars))
          : null
      for (let i = 0; i < bars; i++) {
        // 放大中低音量，讓說話時明顯跳動
        const target = levels ? Math.min(1, Math.pow(levels[i], 0.8) * 1.35) : 0
        smooth[i] = target > smooth[i] ? target : smooth[i] * 0.86 + target * 0.14
        const node = nodes[i]
        if (node) node.style.transform = `scaleY(${(0.12 + 0.88 * smooth[i]).toFixed(3)})`
      }
      raf = win.requestAnimationFrame(loop)
    }
    raf = win.requestAnimationFrame(loop)
    return () => win.cancelAnimationFrame(raf)
  }, [analyser, bars, muted])
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn('flex h-6 items-center gap-[3px]', className)}
      style={style}
    >
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-full w-[3px] origin-center rounded-full',
            muted ? 'bg-[color-mix(in_srgb,var(--text)_22%,transparent)]' : 'bg-accent',
            barClassName,
          )}
          style={{ transform: 'scaleY(0.12)' }}
        />
      ))}
    </div>
  )
}

/** 以 Blob 顯示的圖片：在 effect 內建立並 revoke 物件 URL */
export function BlobImage({
  blob,
  className,
  alt = '',
}: {
  blob: Blob | null
  className?: string
  alt?: string
}) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !blob) return
    const url = URL.createObjectURL(blob)
    el.src = url
    return () => {
      el.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [blob])
  if (!blob) return null
  return <img ref={ref} alt={alt} className={className} draggable={false} />
}

/** 即時預覽：把 MediaStream 綁到 <video>（靜音） */
export function StreamVideo({
  stream,
  className,
  mirror,
  label,
}: {
  stream: MediaStream | null
  className?: string
  mirror?: boolean
  label?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.srcObject = stream
    if (stream) v.play().catch(() => {})
    return () => {
      v.srcObject = null
    }
  }, [stream])
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      aria-label={label}
      className={className}
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  )
}
