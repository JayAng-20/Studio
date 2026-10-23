// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { duration, easing, staggerDelay, stagger } from '@/design/motion'

const css = readFileSync('src/design/tokens.css', 'utf8')

describe('動畫 token', () => {
  it('CSS 的時間與 motion.ts 一致', () => {
    for (const [k, v] of Object.entries(duration)) expect(css).toContain(`--dur-${k}: ${v}ms;`)
  })
  it('CSS 的緩動與 motion.ts 一致', () => {
    for (const [k, v] of Object.entries(easing))
      expect(css).toContain(`--ease-${k}: cubic-bezier(${v.join(', ')});`)
  })
  it('stagger 最多算 12 項', () => {
    expect(staggerDelay(100)).toBeCloseTo(stagger.max * stagger.step)
    expect(stagger.step).toBeGreaterThanOrEqual(0.035)
    expect(stagger.step).toBeLessThanOrEqual(0.05)
  })
})
