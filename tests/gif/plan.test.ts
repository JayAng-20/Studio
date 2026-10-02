import { describe, expect, it } from 'vitest'
import { autoPlan } from '@/features/gif/feed'
import { outputSize } from '@/features/gif/render'
import { resizeCrop } from '@/features/gif/components/CropOverlay'
import {
  fitCropToRatio,
  matchPreset,
  normalizeSettings,
  DEFAULT_SETTINGS,
  PRESETS,
} from '@/features/gif/settings'
import type { Source } from '@/features/gif/store'

const video = { kind: 'video', width: 1920, height: 1080, duration: 10 } as unknown as Source

describe('影格計畫', () => {
  it('影片：依區間、fps、速度、倒放產生來源時間與延遲', () => {
    const p = autoPlan(video, [2, 3], { fps: 10, speed: 1, reverse: true, pingpong: false })
    expect(p).toHaveLength(10)
    expect(p[0].src).toBe(2.9)
    expect(p[9].src).toBe(2)
    expect(new Set(p.map((x) => x.id)).size).toBe(10)
  })
  it('圖片：來回播放', () => {
    const imgs = { kind: 'images', items: [{}, {}, {}] } as unknown as Source
    expect(
      autoPlan(imgs, [0, 0], { fps: 5, speed: 1, reverse: false, pingpong: true }).map(
        (x) => x.src,
      ),
    ).toEqual([0, 1, 2, 1])
  })
  it('沒有來源時為空', () => {
    expect(autoPlan(null, [0, 1], DEFAULT_SETTINGS)).toEqual([])
  })
})

describe('輸出尺寸與裁切', () => {
  it('寬度與裁切決定高度', () => {
    expect(outputSize(1920, 1080, { x: 0, y: 0, w: 1, h: 1 }, 480)).toEqual({ w: 480, h: 270 })
    expect(outputSize(1920, 1080, { x: 0, y: 0, w: 0.5625, h: 1 }, 480)).toEqual({ w: 480, h: 480 })
    expect(outputSize(640, 360, { x: 0, y: 0, w: 1, h: 1 }, 'original')).toEqual({ w: 640, h: 360 })
  })
  it('依比例置中取最大範圍', () => {
    const c = fitCropToRatio(1, 1920, 1080, { x: 0, y: 0, w: 1, h: 1 })
    expect(c.h).toBe(1)
    expect(c.w * 1920).toBeCloseTo(1080)
    expect(c.x).toBeCloseTo((1 - c.w) / 2)
  })
  it('拖曳裁切角：不超出畫面、鎖定比例', () => {
    const r = resizeCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'se', 0.6, 0.1, null)
    expect(r.x + r.w).toBeLessThanOrEqual(1)
    expect(r.w).toBeCloseTo(0.8)
    const locked = resizeCrop({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'se', 0.1, 0, 1)
    expect(locked.w).toBeCloseTo(locked.h)
    const moved = resizeCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'move', 0.9, -0.9, null)
    expect(moved).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 })
  })
})

describe('預設檔', () => {
  it('辨識目前預設檔，手動調整後變成自訂', () => {
    expect(matchPreset({ ...DEFAULT_SETTINGS, ...PRESETS.high })).toBe('high')
    expect(matchPreset({ ...DEFAULT_SETTINGS, colors: 200 })).toBeNull()
  })
  it('讀取舊設定時修正範圍', () => {
    const s = normalizeSettings({ colors: 9999, speed: 10, width: 5, loop: 0 })
    expect(s.colors).toBe(256)
    expect(s.speed).toBe(3)
    expect(s.width).toBe(64)
    expect(s.loop).toBe(1)
  })
})
