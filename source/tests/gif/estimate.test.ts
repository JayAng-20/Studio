// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  BYTES_LIMIT,
  FRAME_LIMIT,
  overLimit,
  projectSize,
  scaleStats,
  suggestFixes,
} from '@/features/gif/estimate'

const FPS = [5, 8, 10, 12, 15, 20, 24, 30]
const WIDTHS = [240, 320, 400, 480, 560, 640]

describe('大小預估', () => {
  it('第一格＋其餘差異格', () => {
    expect(projectSize(10, { fullAvg: 1000, deltaAvg: 200 })).toBe(1000 + 9 * 200)
    expect(projectSize(0, { fullAvg: 1000, deltaAvg: 200 })).toBe(0)
    expect(projectSize(1, { fullAvg: 1000, deltaAvg: 200 }, 50)).toBe(1050)
  })
  it('依像素數換算尺寸', () => {
    const s = scaleStats({ fullAvg: 1000, deltaAvg: 400, width: 480, height: 270 }, 240, 135)
    expect(s.fullAvg).toBeCloseTo(250)
    expect(s.deltaAvg).toBeCloseTo(100)
  })
  it('門檻判斷', () => {
    expect(overLimit(FRAME_LIMIT, BYTES_LIMIT)).toEqual({ frames: false, bytes: false })
    expect(overLimit(FRAME_LIMIT + 1, 0).frames).toBe(true)
    expect(overLimit(1, BYTES_LIMIT + 1).bytes).toBe(true)
  })
})

describe('超量建議', () => {
  const base = {
    fps: 30,
    width: 640,
    height: 360,
    rangeLength: 10,
    fpsOptions: FPS,
    widthOptions: WIDTHS,
    pingpong: false,
    stats: null,
    header: 0,
  }
  it('在門檻內沒有建議', () => {
    expect(suggestFixes({ ...base, frames: 100, bytes: 1e6 })).toEqual([])
  })
  it('影格過多：建議能壓到 200 格內的最高 fps 與縮短區間', () => {
    const s = suggestFixes({ ...base, frames: 300, bytes: 10e6 })
    const fps = s.find((x) => x.kind === 'fps')!
    expect(fps.value).toBe(20)
    expect(fps.frames).toBeLessThanOrEqual(FRAME_LIMIT)
    const range = s.find((x) => x.kind === 'range')!
    expect(range.frames).toBeLessThanOrEqual(FRAME_LIMIT)
    expect(range.value).toBeLessThan(10)
    // 只超格數時不建議降寬度
    expect(s.find((x) => x.kind === 'width')).toBeUndefined()
  })
  it('檔案過大：建議降寬度，且預估值在門檻內', () => {
    const s = suggestFixes({ ...base, frames: 150, bytes: 80 * 1024 * 1024 })
    const w = s.find((x) => x.kind === 'width')!
    expect(w.value).toBeLessThan(640)
    expect(w.bytes).toBeLessThanOrEqual(BYTES_LIMIT)
  })
  it('圖片模式不建議縮短區間；已是最低 fps 時不建議 fps', () => {
    const s = suggestFixes({ ...base, fps: 5, rangeLength: null, frames: 400, bytes: 1e6 })
    expect(s).toEqual([])
  })
})
