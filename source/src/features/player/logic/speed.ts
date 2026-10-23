/** 播放速度與逐格（純函式） */

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const

/** 依方向切換到相鄰的速度；目前值不在清單內時先對齊最接近的 */
export function stepSpeed(current: number, dir: 1 | -1): number {
  let idx = 0
  let best = Infinity
  SPEEDS.forEach((s, i) => {
    const d = Math.abs(s - current)
    if (d < best) {
      best = d
      idx = i
    }
  })
  if (best > 1e-6) {
    // 不在清單上：往指定方向找第一個
    const list = dir > 0 ? SPEEDS.filter((s) => s > current) : SPEEDS.filter((s) => s < current)
    if (!list.length) return current
    return dir > 0 ? list[0] : list[list.length - 1]
  }
  const next = Math.max(0, Math.min(SPEEDS.length - 1, idx + dir))
  return SPEEDS[next]
}

export const formatSpeed = (r: number) => `${Number(r.toFixed(2))}×`

export const DEFAULT_FRAME = 1 / 30

/** 由 requestVideoFrameCallback 取得的影格間隔樣本估算單格時長（中位數，限制在 1/120 到 1/5 秒） */
export function estimateFrameDuration(deltas: number[]): number {
  const valid = deltas.filter((d) => Number.isFinite(d) && d > 1 / 240 && d < 0.5)
  if (valid.length < 5) return DEFAULT_FRAME
  const sorted = valid.slice().sort((a, b) => a - b)
  const mid = sorted[Math.floor(sorted.length / 2)]
  return Math.min(1 / 5, Math.max(1 / 120, mid))
}

/** 逐格：對齊到格線再前進或後退一格 */
export function frameStep(t: number, frame: number, dir: 1 | -1, duration: number): number {
  const idx = Math.round(t / frame)
  // 加上四分之一格，避免落在兩格邊界而顯示前一格
  const target = (idx + dir) * frame + frame * 0.25
  return Math.max(0, Math.min(Number.isFinite(duration) ? duration : target, target))
}
