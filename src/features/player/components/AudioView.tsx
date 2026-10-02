import { AnimatePresence, motion } from 'motion/react'
import { Music } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { splitExt } from '@/lib/filename'
import { duration as dur, sec, spring } from '@/design/motion'
import { usePlayer, type PlayItem } from '../store'
import { getAnalyser } from '../audio'

/**
 * 音訊檔畫面：封面（ID3 圖片或模組色漸層）＋標題／演出者，換曲目時交叉淡化；
 * 下方是 AnalyserNode 頻譜（柱狀或波形，顏色取模組色）。
 */
export function AudioView({ item }: { item: PlayItem }) {
  const title = item.meta?.title || splitExt(item.name).base
  const sub = [item.meta?.artist, item.meta?.album].filter(Boolean).join(' — ')
  const cover = item.meta?.coverUrl
  return (
    <div className="absolute inset-0 overflow-hidden">
      <AnimatePresence initial={false}>
        <motion.div
          key={`${item.id}-${cover ?? ''}`}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: sec(dur.slower) }}
        >
          {/* 背景：封面模糊放大，或模組色光暈 */}
          {cover ? (
            <img src={cover} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-45 blur-3xl" />
          ) : (
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(60% 70% at 25% 30%, color-mix(in srgb, var(--accent-2) 45%, transparent), transparent 70%), radial-gradient(50% 60% at 80% 70%, color-mix(in srgb, var(--accent) 40%, transparent), transparent 70%)',
              }}
            />
          )}
          <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--stage-bg)_45%,transparent)]" aria-hidden />
          <div className="absolute inset-x-0 top-0 flex h-[62%] flex-col items-center justify-center gap-4 px-6 @lg:flex-row @lg:gap-6 @lg:px-[8%]">
            <motion.div
              className="relative aspect-square h-[46cqh] max-h-56 shrink-0 overflow-hidden rounded-xl shadow-[0_20px_50px_-12px_rgba(0,0,0,.7)] @lg:h-[52cqh]"
              initial={{ scale: 0.9, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              transition={spring.smooth}
            >
              {cover ? (
                <img src={cover} alt="" className="size-full object-cover" />
              ) : (
                <div
                  className="grid size-full place-items-center"
                  style={{ background: 'linear-gradient(135deg, var(--m-1), var(--m-2))' }}
                >
                  <Music className="size-1/3 text-white/90" strokeWidth={1.75} aria-hidden />
                  <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,.22),transparent_55%)]" />
                </div>
              )}
            </motion.div>
            <motion.div
              className="min-w-0 max-w-full text-center @lg:text-left"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.smooth, delay: sec(dur.instant) }}
            >
              <p className="line-clamp-2 text-h2 font-semibold @2xl:text-[26px] @2xl:leading-9">{title}</p>
              {sub && <p className="mt-1 truncate text-body text-[var(--stage-fg-2)]">{sub}</p>}
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>
      <Visualizer />
    </div>
  )
}

/** 頻譜視覺化：只在播放時跑；暫停時柱子緩慢落下 */
function Visualizer() {
  const ref = useRef<HTMLCanvasElement>(null)
  const mode = usePlayer((s) => s.visualizer)
  const paused = usePlayer((s) => s.paused)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    let raf = 0
    let levels = new Float32Array(64)
    let freq: Uint8Array<ArrayBuffer> | null = null
    let wave: Uint8Array<ArrayBuffer> | null = null
    const reduced = document.documentElement.dataset.motion === 'off'
    const draw = () => {
      const w = c.clientWidth
      const h = c.clientHeight
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr)
      if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const css = getComputedStyle(c)
      const m1 = css.getPropertyValue('--m-1').trim() || '#5aa2ff'
      const m2 = css.getPropertyValue('--m-2').trim() || '#2f6bea'
      const an = getAnalyser()
      const playing = !usePlayer.getState().paused
      if (mode === 'wave' && an) {
        if (!wave || wave.length !== an.fftSize) wave = new Uint8Array(an.fftSize)
        an.getByteTimeDomainData(wave)
        const grad = ctx.createLinearGradient(0, 0, w, 0)
        grad.addColorStop(0, m1)
        grad.addColorStop(1, m2)
        ctx.lineWidth = 2.5
        ctx.strokeStyle = grad
        ctx.shadowColor = m1
        ctx.shadowBlur = 12
        ctx.beginPath()
        const step = wave.length / w
        for (let x = 0; x < w; x++) {
          const v = (wave[Math.floor(x * step)] - 128) / 128
          const y = h * 0.55 + v * h * 0.4
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.shadowBlur = 0
      } else {
        const bars = Math.max(16, Math.min(64, Math.floor(w / 14)))
        if (levels.length !== bars) levels = new Float32Array(bars)
        if (an && playing) {
          if (!freq || freq.length !== an.frequencyBinCount) freq = new Uint8Array(an.frequencyBinCount)
          an.getByteFrequencyData(freq)
          // 對數分佈：低頻多一點細節
          for (let i = 0; i < bars; i++) {
            const lo = Math.floor(Math.pow(freq.length * 0.7, i / bars))
            const hi = Math.max(lo + 1, Math.floor(Math.pow(freq.length * 0.7, (i + 1) / bars)))
            let sum = 0
            for (let k = lo; k < hi; k++) sum += freq[k]
            const v = sum / (hi - lo) / 255
            levels[i] = Math.max(v, levels[i] * 0.86)
          }
        } else {
          for (let i = 0; i < bars; i++) levels[i] *= 0.9
        }
        const gap = 4
        const bw = (w - gap * (bars - 1)) / bars
        const grad = ctx.createLinearGradient(0, h, 0, 0)
        grad.addColorStop(0, m2)
        grad.addColorStop(1, m1)
        ctx.fillStyle = grad
        for (let i = 0; i < bars; i++) {
          const bh = Math.max(3, levels[i] * h * 0.92)
          const x = i * (bw + gap)
          ctx.globalAlpha = 0.55 + levels[i] * 0.45
          ctx.beginPath()
          ctx.roundRect(x, h - bh, bw, bh, Math.min(4, bw / 2))
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }
      const settled = !playing && levels.every((l) => l < 0.004)
      if (!reduced && !settled) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [mode, paused])
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-x-[6%] bottom-[calc(var(--controls-h)-4px)] h-[22%] w-[88%] opacity-90"
    />
  )
}
