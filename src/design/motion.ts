/**
 * 動畫 token：全站唯一的時間、緩動、彈簧來源。元件內禁止寫死魔術數字。
 * CSS 端對應的變數在 tokens.css（--dur-*、--ease-*），由測試確認兩者一致。
 */
import type { Transition } from 'motion/react'

export const duration = {
  instant: 90,
  fast: 160,
  base: 240,
  slow: 360,
  slower: 560,
  hero: 900,
  accent: 400,
} as const

/** 秒（motion 使用秒） */
export const sec = (ms: number) => ms / 1000

export const easing = {
  standard: [0.2, 0, 0, 1],
  decelerate: [0.05, 0.7, 0.1, 1],
  accelerate: [0.3, 0, 0.8, 0.15],
  emphasized: [0.16, 1, 0.3, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>

export const cssEasing = (e: keyof typeof easing) => `cubic-bezier(${easing[e].join(',')})`

export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.9 },
  smooth: { type: 'spring', stiffness: 300, damping: 30 },
  gentle: { type: 'spring', stiffness: 180, damping: 24 },
  bouncy: { type: 'spring', stiffness: 420, damping: 20 },
} as const satisfies Record<string, Transition>

export const stagger = {
  step: 0.04,
  max: 12,
} as const

/** 第 i 項的進場延遲（秒）：超過上限的項目一起進場 */
export const staggerDelay = (i: number, base = 0) => base + Math.min(i, stagger.max) * stagger.step

export const fade = (
  ms: number = duration.base,
  ease: keyof typeof easing = 'standard',
): Transition => ({
  duration: sec(ms),
  ease: easing[ease],
})

/** 常用位移量（px） */
export const offset = {
  page: 12,
  panel: 8,
  hover: 2,
  shake: 4,
} as const

/** 互動縮放量 */
export const scale = {
  press: 0.97,
  pageExit: 0.98,
  dialogFrom: 0.96,
  dropHover: 1.01,
} as const

/** 計時（ms） */
export const timing = {
  tooltipDelay: 400,
  copiedReset: 1200,
  controlsIdle: 2500,
  previewDebounce: 150,
  sidebarTextLead: 80,
  shake: 220,
} as const
