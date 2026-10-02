import { motion, useSpring } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, ProgressBar, ProgressRing, Skeleton } from '@/components/ui'
import { spring } from '@/design/motion'
import { useGT } from '../useGT'
import { useGifStore } from '../store'
import { heroTarget, useEncodeState } from '../progress'
import type { Thumb } from '../hooks'
import type { Geometry } from '../render'
import type { PlanItem } from '../settings'

const HERO_W = 168

/**
 * 編碼中：膠卷上方浮著「正在寫入的影格」小預覽＋進度環，隨處理位置在膠卷上移動。
 * 完成時同一個 layoutId（gif-hero）的結果卡從這裡以彈簧放大。
 */
export function EncodingView({
  geom,
  plan,
  thumbs,
  thumbCount,
  onCancel,
}: {
  geom: Geometry
  plan: PlanItem[]
  thumbs: Thumb[]
  thumbCount: number
  onCancel: () => void
}) {
  const t = useGT()
  const source = useGifStore((s) => s.source)
  const range = useGifStore((s) => s.range)
  const progress = useEncodeState((s) => s.progress)
  const strip = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const x = useSpring(0, spring.smooth)

  useEffect(() => {
    const el = strip.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    // ResizeObserver 開始觀察時會立即回呼一次
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const total = progress?.total ?? plan.length
  const frame = Math.min(total - 1, Math.max(0, progress?.frame ?? 0))
  const value = progress?.value ?? 0
  // 目前影格在膠卷上的位置（0–1）
  let pos = total > 1 ? frame / (total - 1) : 0
  if (source?.kind === 'video' && plan[frame])
    pos = plan[frame].src / Math.max(0.1, source.duration)
  else if (source?.kind === 'images' && plan[frame])
    pos = (plan[frame].src + 0.5) / source.items.length

  const heroH = Math.round((HERO_W * geom.outH) / geom.outW)
  const heroW = heroH > 132 ? Math.round((132 * geom.outW) / geom.outH) : HERO_W
  const heroHeight = Math.min(heroH, 132)

  useEffect(() => {
    if (!width) return
    x.set(Math.max(0, Math.min(width - heroW, pos * width - heroW / 2)))
  }, [pos, width, heroW, x])

  const phase = progress?.phase ?? 'extract'
  const pct = Math.round(value * 100)
  const dur = source?.kind === 'video' ? source.duration : 1
  const left = source?.kind === 'video' ? (range[0] / dur) * 100 : 0
  const right = source?.kind === 'video' ? (range[1] / dur) * 100 : 100
  const cells = source?.kind === 'images' ? source.items.map((i) => i.url) : null

  return (
    <section className="card overflow-hidden p-5 sm:p-6" aria-labelledby="gif-encoding-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="gif-encoding-title" className="text-h2 font-semibold">
            {t('encoding.title')}
          </h2>
          <p className="mt-0.5 text-body text-text-2" aria-live="polite">
            {t(`encoding.phases.${phase}`)} · {t('encoding.frame', { current: frame + 1, total })}
          </p>
        </div>
        <Button variant="secondary" leading={<X size={16} aria-hidden />} onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
      </div>

      <div
        className="relative mt-6 pt-[calc(var(--hero-h)+20px)]"
        style={{ ['--hero-h' as string]: `${heroHeight}px` }}
      >
        {/* 正在寫入的影格 */}
        <motion.div className="absolute left-0 top-0 z-10" style={{ x }}>
          <motion.div
            layoutId="gif-hero"
            transition={spring.smooth}
            className="gif-checker relative overflow-visible rounded-md shadow-e3 ring-2 ring-accent"
            style={{ width: heroW, height: heroHeight }}
          >
            <canvas
              ref={(el) => {
                heroTarget.canvas = el
              }}
              width={heroW * 2}
              height={heroHeight * 2}
              aria-label={t('encoding.writing')}
              role="img"
              className="absolute inset-0 size-full rounded-md"
            />
            <span className="absolute -right-3 -top-3 grid place-items-center rounded-full bg-surface p-0.5 shadow-e2">
              <ProgressRing
                value={value}
                size={36}
                stroke={3.5}
                label={t('encoding.progress', { value: pct })}
              />
              <span className="absolute text-[10px] font-semibold tabular-nums text-text">
                {pct}
              </span>
            </span>
            <span
              aria-hidden
              className="absolute left-1/2 top-full h-[18px] w-0.5 -translate-x-1/2 bg-accent"
            />
          </motion.div>
        </motion.div>

        <div
          ref={strip}
          className="relative h-14 overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
          aria-hidden
        >
          <div className="absolute inset-0 flex">
            {cells
              ? cells.map((url, i) => (
                  <div key={i} className="relative h-full min-w-0 flex-1 overflow-hidden">
                    <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
                  </div>
                ))
              : Array.from({ length: thumbCount }, (_, i) => (
                  <div key={i} className="relative h-full min-w-0 flex-1 overflow-hidden">
                    {thumbs[i] ? (
                      <img
                        src={thumbs[i].url}
                        alt=""
                        className="absolute inset-0 size-full object-cover"
                      />
                    ) : (
                      <Skeleton className="absolute inset-0 rounded-none" />
                    )}
                  </div>
                ))}
          </div>
          <span
            className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--bg)_65%,transparent)]"
            style={{ width: `${left}%` }}
          />
          <span
            className="absolute inset-y-0 right-0 bg-[color-mix(in_srgb,var(--bg)_65%,transparent)]"
            style={{ width: `${100 - right}%` }}
          />
          <span
            className="absolute inset-y-0 border-y-2 border-accent"
            style={{ left: `${left}%`, right: `${100 - right}%` }}
          />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <ProgressBar value={value} label={t('encoding.progress', { value: pct })} />
        <div className="flex flex-wrap justify-between gap-2 text-small text-text-3">
          <span>{t('encoding.background')}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
      </div>
    </section>
  )
}
