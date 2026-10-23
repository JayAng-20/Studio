import { motion } from 'motion/react'
import { spring } from '@/design/motion'

/**
 * 播放／暫停圖示：兩個四邊形以 path 變形切換（三角形左右兩半 ↔ 兩條直槓）。
 * 兩種狀態的頂點數相同，motion 可直接內插 d 屬性。
 */
const PLAY = ['M7 4.5 L12.5 7.9 L12.5 16.1 L7 19.5 Z', 'M12.5 7.9 L19 12 L19 12 L12.5 16.1 Z']
const PAUSE = ['M6.5 5 L10.25 5 L10.25 19 L6.5 19 Z', 'M13.75 5 L17.5 5 L17.5 19 L13.75 19 Z']

export function MorphPlayIcon({ playing, size = 22 }: { playing: boolean; size?: number }) {
  const d = playing ? PAUSE : PLAY
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <motion.path
        initial={false}
        animate={{ d: d[0] }}
        transition={spring.snappy}
        strokeLinejoin="round"
      />
      <motion.path
        initial={false}
        animate={{ d: d[1] }}
        transition={spring.snappy}
        strokeLinejoin="round"
      />
    </svg>
  )
}
