import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFS,
  loadPrefs,
  pickPrefs,
  sanitizePrefs,
  savePrefs,
} from '@/features/player/logic/prefs'
import { STORAGE_KEYS } from '@/lib/storage'

describe('播放器偏好驗證', () => {
  it('非物件或空值退回預設', () => {
    for (const raw of [null, undefined, 42, 'x', [], true])
      expect(sanitizePrefs(raw)).toEqual(DEFAULT_PREFS)
  })
  it('保留合法值', () => {
    const p = {
      volume: 0.4,
      repeat: 'one',
      shuffle: true,
      autoNext: false,
      abLoop: false,
      subsOn: false,
      subStyle: { size: 1.5, position: 20, bg: 'box' },
      eqEnabled: true,
      eqGains: [7, 4, 0, -1, 0],
      visualizer: 'wave',
      waveformOn: false,
    }
    expect(sanitizePrefs(p)).toEqual(p)
  })
  it('範圍外的數值夾在範圍內；增強音量不恢復', () => {
    const p = sanitizePrefs({
      volume: 1.8,
      subStyle: { size: 9, position: -5, bg: 'shadow' },
      eqGains: [40, -40, 3.4, 0, 0],
    })
    expect(p.volume).toBe(1)
    expect(p.subStyle).toEqual({ size: 2, position: 0, bg: 'shadow' })
    expect(p.eqGains).toEqual([12, -12, 3, 0, 0])
    expect(sanitizePrefs({ volume: -1 }).volume).toBe(0)
  })
  it('型別錯誤或不合法的選項逐欄退回預設', () => {
    const p = sanitizePrefs({
      volume: 'loud',
      repeat: 'forever',
      shuffle: 'yes',
      subStyle: { size: NaN, position: '10', bg: 'glow' },
      eqGains: [1, 2, 3],
      visualizer: 'circle',
      waveformOn: 1,
    })
    expect(p).toEqual(DEFAULT_PREFS)
  })
  it('等化器含非數字時整組退回平坦', () => {
    expect(sanitizePrefs({ eqGains: [1, 2, 'x', 4, 5] }).eqGains).toEqual([0, 0, 0, 0, 0])
  })
  it('pickPrefs 只取偏好欄位', () => {
    const state = {
      ...DEFAULT_PREFS,
      volume: 0.5,
      items: [1, 2],
      el: {},
    } as unknown as typeof DEFAULT_PREFS
    const p = pickPrefs(state)
    expect(Object.keys(p).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort())
    expect(p.volume).toBe(0.5)
  })
})

describe('偏好持久化', () => {
  beforeEach(() => localStorage.clear())
  it('寫入 STORAGE_KEYS.playerPrefs 並讀回', () => {
    savePrefs({ ...DEFAULT_PREFS, repeat: 'all', visualizer: 'wave' })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.playerPrefs) ?? '{}').repeat).toBe('all')
    expect(loadPrefs()).toMatchObject({ repeat: 'all', visualizer: 'wave' })
  })
  it('損毀的 JSON 退回預設', () => {
    localStorage.setItem(STORAGE_KEYS.playerPrefs, '{oops')
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
  })
})
