/** 圖片互轉的小元件：計數徽章、縮圖（blur-up）、完成勾勾（只播一次） */
import { motion } from 'motion/react'
import { Check, TrendingDown, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AnimatedNumber, Badge, Skeleton, SuccessCheck } from '@/components/ui'
import { duration, easing, sec } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'

/** 已播放過完成動畫的項目（離開再回來不重播） */
const celebrated = new Set<string>()

/** 從 0 滾動到目標值（只在第一次出現時滾動） */
export function CountUp({
  value,
  format,
  className,
  onceKey,
}: {
  value: number
  format: (v: number) => string
  className?: string
  onceKey?: string
}) {
  const skip = !!onceKey && celebrated.has(`n:${onceKey}`)
  const [v, setV] = useState(skip ? value : 0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setV(value))
    if (onceKey) celebrated.add(`n:${onceKey}`)
    return () => cancelAnimationFrame(id)
  }, [value, onceKey])
  return <AnimatedNumber value={v} format={format} className={className} />
}

/** 節省（綠色）或增加（警示）百分比徽章 */
export function SavingsBadge({
  pct,
  onceKey,
  className,
}: {
  pct: number
  onceKey?: string
  className?: string
}) {
  const t = useT()
  const saved = pct <= 0
  const rounded = Math.round(Math.abs(pct))
  // 增加超過 10 倍時改用倍數顯示（+39089% 不好讀）
  const times = !saved && pct >= 900 ? (1 + pct / 100).toFixed(pct >= 9000 ? 0 : 1) : null
  const label = saved
    ? t('convert.result.saved', { pct: rounded })
    : times
      ? t('convert.result.times', { n: times })
      : t('convert.result.increased', { pct: rounded })
  return (
    <Badge
      tone={saved ? 'success' : 'warning'}
      className={cn('shrink-0 tabular-nums', className)}
      icon={saved ? <TrendingDown size={13} aria-hidden /> : <TrendingUp size={13} aria-hidden />}
    >
      <span className="sr-only">{label}</span>
      {times ? (
        <span aria-hidden>×{times}</span>
      ) : (
        <span aria-hidden>
          {saved ? '−' : '+'}
          <CountUp value={rounded} format={(v) => `${Math.round(v)}%`} onceKey={onceKey} />
        </span>
      )}
    </Badge>
  )
}

/** 完成勾勾：第一次出現時描繪＋光環，之後靜態顯示 */
export function DoneCheck({
  id,
  size = 22,
  className,
}: {
  id: string
  size?: number
  className?: string
}) {
  const [first] = useState(() => !celebrated.has(`c:${id}`))
  useEffect(() => {
    celebrated.add(`c:${id}`)
  }, [id])
  if (first) return <SuccessCheck size={size} className={className} />
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-success text-white',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Check size={size * 0.6} strokeWidth={2.8} aria-hidden />
    </span>
  )
}

/** 縮圖：載入後由模糊轉清晰（blur-up） */
export function BlurImage({
  src,
  className,
  fit = 'cover',
  alt = '',
}: {
  src?: string
  className?: string
  fit?: 'cover' | 'contain'
  alt?: string
}) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const ready = !!src && loaded === src
  return (
    <span className={cn('block overflow-hidden', className ?? 'relative')}>
      {!ready && <Skeleton className="absolute inset-0 rounded-none" />}
      {src && (
        <motion.img
          key={src}
          src={src}
          alt={alt}
          draggable={false}
          decoding="async"
          onLoad={() => setLoaded(src)}
          className={cn(
            'absolute inset-0 size-full',
            fit === 'cover' ? 'object-cover' : 'object-contain',
          )}
          initial={{ opacity: 0, scale: 1.08, filter: 'blur(14px)' }}
          animate={
            ready
              ? { opacity: 1, scale: 1, filter: 'blur(0px)' }
              : { opacity: 0, scale: 1.08, filter: 'blur(14px)' }
          }
          transition={{ duration: sec(duration.slower), ease: easing.decelerate }}
        />
      )}
    </span>
  )
}
