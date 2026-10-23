import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { AnimatedNumber, NumberField, RangeSlider, Skeleton } from '@/components/ui'
import { duration as dur, easing, sec, spring, staggerDelay } from '@/design/motion'
import { formatTime } from '@/lib/format'
import { useGT } from '../useGT'
import { gridMax, roundTime, snapThreshold, snapToSecond } from '../timeline'
import type { Thumb } from '../hooks'
import { usePlayhead } from '../playhead'

/** 預覽播放頭：獨立訂閱，避免整條膠卷跟著每格重繪 */
function Playhead({ max }: { max: number }) {
  const t = usePlayhead((s) => s.t)
  if (t === null) return null
  return (
    <span
      className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,.35)]"
      style={{ left: `${(Math.min(max, Math.max(0, t)) / max) * 100}%` }}
    />
  )
}

interface Props {
  duration: number
  value: [number, number]
  onChange: (v: [number, number]) => void
  /** 正在拖曳的把手位置（讓預覽跟著顯示該畫面） */
  onScrub?: (t: number) => void
  thumbs: Thumb[]
  thumbCount: number
  /** 編碼中：只顯示膠卷，不能拖曳 */
  readOnly?: boolean
}

const TRACK_H = 56

/**
 * 縮圖膠卷＋雙把手區間：
 * - 縮圖逐格「翻入」（stagger）
 * - 拖曳時靠近整數秒會吸附，吸附點閃一下並出現提示
 * - 鍵盤方向鍵以 0.1 秒微調（不吸附）
 */
export function RangeTimeline({
  duration,
  value,
  onChange,
  onScrub,
  thumbs,
  thumbCount,
  readOnly,
}: Props) {
  const t = useGT()
  const dragging = useRef(false)
  const [flash, setFlash] = useState<{ v: number; key: number } | null>(null)
  const lastSnap = useRef<number | null>(null)
  const max = gridMax(duration)

  useEffect(() => {
    const up = () => {
      dragging.current = false
      lastSnap.current = null
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), dur.slower)
    return () => clearTimeout(id)
  }, [flash])

  const change = (next: [number, number]) => {
    const moved = next[0] !== value[0] ? 0 : 1
    let v = roundTime(next[moved])
    if (dragging.current) {
      const s = snapToSecond(v, snapThreshold(duration))
      v = s.value
      if (s.snapped !== null && s.snapped !== lastSnap.current) {
        setFlash({ v: s.snapped, key: performance.now() })
      }
      lastSnap.current = s.snapped
    }
    const out: [number, number] =
      moved === 0
        ? [Math.min(v, value[1] - 0.1), value[1]]
        : [value[0], Math.max(v, value[0] + 0.1)]
    out[0] = Math.max(0, roundTime(out[0]))
    out[1] = Math.min(roundTime(max), roundTime(out[1]))
    onChange(out)
    onScrub?.(out[moved])
  }

  const len = value[1] - value[0]
  // 整數秒刻度：秒數太多時改成每 5／10 秒一格
  const tickStep = duration > 120 ? 10 : duration > 30 ? 5 : 1
  const ticks: number[] = []
  for (let s = tickStep; s < duration; s += tickStep) ticks.push(s)

  const strip = (
    <div className="absolute inset-0 flex" aria-hidden>
      {Array.from({ length: thumbCount }, (_, i) => {
        const th = thumbs[i]
        return (
          <div
            key={i}
            className="relative h-full min-w-0 flex-1 overflow-hidden [perspective:400px]"
          >
            {th ? (
              <motion.img
                src={th.url}
                alt=""
                draggable={false}
                className="absolute inset-0 size-full object-cover"
                initial={{ rotateY: -80, opacity: 0, scale: 0.9 }}
                animate={{ rotateY: 0, opacity: 1, scale: 1 }}
                transition={{
                  ...spring.smooth,
                  opacity: { duration: sec(dur.fast), ease: easing.standard },
                  // 縮圖依序產生，本身就會逐格翻入；快取命中一次到齊時再補上交錯延遲
                  delay: th.burst ? staggerDelay(i) : 0,
                }}
                style={{ transformOrigin: 'left center' }}
              />
            ) : (
              <Skeleton className="absolute inset-0 rounded-none" />
            )}
            {i > 0 && <span className="absolute inset-y-0 left-0 w-px bg-black/20" />}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        {readOnly ? (
          <div
            className="relative overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
            style={{ height: TRACK_H }}
          >
            {strip}
          </div>
        ) : (
          <div
            onPointerDownCapture={() => {
              dragging.current = true
            }}
          >
            <RangeSlider
              value={value}
              onChange={change}
              max={max}
              step={0.1}
              minGap={0.1}
              trackHeight={TRACK_H}
              format={(v) => t('range.seconds', { value: v.toFixed(1) })}
              labels={[t('range.start'), t('range.end')]}
            >
              {strip}
            </RangeSlider>
          </div>
        )}
        {/* 刻度、吸附閃光、播放頭（不攔截指標事件） */}
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2"
          style={{ height: TRACK_H }}
          aria-hidden
        >
          {ticks.map((s) => (
            <span
              key={s}
              className="absolute bottom-0 h-1.5 w-px bg-white/70 mix-blend-difference"
              style={{ left: `${(s / max) * 100}%` }}
            />
          ))}
          <AnimatePresence>
            {flash && (
              <motion.span
                key={flash.key}
                className="absolute inset-y-[-6px] w-[3px] -translate-x-1/2 rounded-full bg-accent shadow-[0_0_12px_var(--accent)]"
                style={{ left: `${(flash.v / max) * 100}%` }}
                initial={{ opacity: 0.95, scaleY: 1.15 }}
                animate={{ opacity: 0, scaleY: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: sec(dur.slower), ease: easing.decelerate }}
              />
            )}
          </AnimatePresence>
          <Playhead max={max} />
        </div>
      </div>
      {!readOnly && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
          <NumberField
            label={t('range.start')}
            value={value[0]}
            min={0}
            max={roundTime(value[1] - 0.1)}
            step={0.1}
            size="sm"
            onChange={(v) => {
              onChange([roundTime(v), value[1]])
              onScrub?.(v)
            }}
          />
          <div className="flex min-w-[88px] flex-col items-center pb-1" aria-live="polite">
            <span className="text-caption text-text-3">{t('range.length')}</span>
            <span className="text-h3 font-semibold tabular-nums text-text">
              <AnimatedNumber
                value={len}
                format={(v) => t('range.seconds', { value: v.toFixed(1) })}
              />
            </span>
            <span className="sr-only">{flash ? t('range.snapped', { value: flash.v }) : ''}</span>
          </div>
          <NumberField
            label={t('range.end')}
            value={value[1]}
            min={roundTime(value[0] + 0.1)}
            max={roundTime(max)}
            step={0.1}
            size="sm"
            onChange={(v) => {
              onChange([value[0], roundTime(v)])
              onScrub?.(v)
            }}
          />
        </div>
      )}
      {!readOnly && (
        <div className="flex justify-between text-caption tabular-nums text-text-3" aria-hidden>
          <span>{formatTime(0, { tenths: true })}</span>
          <span>{formatTime(duration, { tenths: true })}</span>
        </div>
      )}
    </div>
  )
}
