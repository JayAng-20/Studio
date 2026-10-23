import { motion, useReducedMotion } from 'motion/react'
import { useId } from 'react'
import { LOGO_BLADES, LOGO_CENTER, LOGO_PLAY } from './logoGeometry'
import { duration, easing, sec, spring } from './motion'
import { cn } from '@/lib/cn'

interface LogoProps {
  size?: number
  /** 載入時從四方旋轉飛入組裝 */
  animate?: boolean
  /** hover 時整體緩慢轉 90° */
  hoverSpin?: boolean
  className?: string
  title?: string
  delay?: number
}

/** 風車工作台 Logo */
export function Logo({
  size = 40,
  animate = false,
  hoverSpin = false,
  className,
  title,
  delay = 0,
}: LogoProps) {
  const uid = useId().replace(/:/g, '')
  const reduce = useReducedMotion()
  const assemble = animate && !reduce
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn('shrink-0 overflow-visible', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      whileHover={hoverSpin ? { rotate: 90 } : undefined}
      transition={{ duration: sec(duration.slower), ease: easing.emphasized }}
    >
      <defs>
        <linearGradient id={`c-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5AA2FF" />
          <stop offset="1" stopColor="#2F6BEA" />
        </linearGradient>
        {LOGO_BLADES.map((b) => (
          <linearGradient key={b.key} id={`${b.key}-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={b.from} />
            <stop offset="1" stopColor={b.to} />
          </linearGradient>
        ))}
      </defs>
      {LOGO_BLADES.map((b, i) => (
        <motion.rect
          key={b.key}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={b.r}
          fill={`url(#${b.key}-${uid})`}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          initial={assemble ? { x: b.dx, y: b.dy, rotate: -120, opacity: 0, scale: 0.6 } : false}
          animate={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 1 }}
          transition={{
            ...spring.smooth,
            delay: delay + i * 0.07,
            opacity: { duration: sec(duration.base), delay: delay + i * 0.07 },
          }}
        />
      ))}
      <motion.g
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={assemble ? { scale: 0.4, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...spring.bouncy, delay: delay + 0.3 }}
      >
        <rect
          x={LOGO_CENTER.x}
          y={LOGO_CENTER.y}
          width={LOGO_CENTER.w}
          height={LOGO_CENTER.h}
          rx={LOGO_CENTER.r}
          fill={`url(#c-${uid})`}
        />
        <rect
          x={LOGO_CENTER.x + 0.5}
          y={LOGO_CENTER.y + 0.5}
          width={LOGO_CENTER.w - 1}
          height={LOGO_CENTER.h - 1}
          rx={LOGO_CENTER.r - 0.5}
          fill="none"
          stroke="rgba(255,255,255,.35)"
          strokeWidth="1"
        />
        <path d={LOGO_PLAY} fill="#fff" />
      </motion.g>
    </motion.svg>
  )
}

/** 風車載入指示：單色（currentColor）或彩色，持續旋轉 */
export function WindmillSpinner({
  size = 20,
  colored = false,
  className,
  label,
}: {
  size?: number
  colored?: boolean
  className?: string
  label?: string
}) {
  const opacities = [1, 0.75, 0.5, 0.3]
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      className={cn('inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="motion-spin"
        style={{ animation: `spin ${duration.hero * 1.1}ms linear infinite` }}
      >
        {LOGO_BLADES.map((b, i) => (
          <rect
            key={b.key}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={b.r}
            fill={colored ? b.to : 'currentColor'}
            opacity={colored ? 1 : opacities[i]}
          />
        ))}
        <rect
          x={LOGO_CENTER.x}
          y={LOGO_CENTER.y}
          width={LOGO_CENTER.w}
          height={LOGO_CENTER.h}
          rx={LOGO_CENTER.r}
          fill={colored ? '#2F6BEA' : 'currentColor'}
          opacity={colored ? 1 : 0.9}
        />
      </svg>
    </span>
  )
}
