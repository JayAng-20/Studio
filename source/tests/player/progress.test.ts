import { beforeEach, describe, expect, it } from 'vitest'
import {
  PROGRESS_MAX,
  loadProgress,
  resumePoint,
  saveProgressEntry,
  updateProgress,
} from '@/features/player/logic/progress'
import { STORAGE_KEYS } from '@/lib/storage'
import { fileKey } from '@/lib/files'

describe('updateProgress／resumePoint', () => {
  it('記住中段進度並可繼續', () => {
    const m = updateProgress({}, 'k', 754.04, 3600, 1)
    expect(m.k).toEqual({ t: 754, d: 3600, at: 1 })
    expect(resumePoint(m, 'k')).toBe(754)
  })
  it('開頭與結尾不記（並移除舊紀錄）', () => {
    const m = updateProgress({}, 'k', 100, 600, 1)
    expect(updateProgress(m, 'k', 2, 600, 2).k).toBeUndefined()
    expect(updateProgress(m, 'k', 598, 600, 2).k).toBeUndefined()
  })
  it('太短的媒體不記', () => {
    expect(updateProgress({}, 'k', 10, 15, 1).k).toBeUndefined()
  })
  it('超過上限時移除最舊的', () => {
    let m = {}
    for (let i = 0; i < PROGRESS_MAX + 5; i++) m = updateProgress(m, `k${i}`, 30, 600, i)
    const keys = Object.keys(m)
    expect(keys).toHaveLength(PROGRESS_MAX)
    expect(keys).not.toContain('k0')
    expect(keys).toContain(`k${PROGRESS_MAX + 4}`)
  })
  it('沒有紀錄或已在結尾時不提示', () => {
    expect(resumePoint({}, 'x')).toBeNull()
    expect(resumePoint({ k: { t: 597, d: 600, at: 1 } }, 'k')).toBeNull()
    // 實際長度較短（例如檔案被剪過）時以實際長度判斷
    expect(resumePoint({ k: { t: 100, d: 600, at: 1 } }, 'k', 102)).toBeNull()
  })
})

describe('localStorage 持久化', () => {
  beforeEach(() => localStorage.clear())
  it('以 fileKey 為 key 寫入 STORAGE_KEYS.progress', () => {
    const f = new File(['x'], 'movie.mp4', { lastModified: 1700000000000 })
    const key = fileKey(f)
    expect(key).toBe('movie.mp4|1|1700000000000')
    saveProgressEntry(key, 754, 3600)
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.progress) ?? '{}')
    expect(raw[key].t).toBe(754)
    expect(resumePoint(loadProgress(), key)).toBe(754)
  })
  it('損毀的資料不會造成錯誤', () => {
    localStorage.setItem(STORAGE_KEYS.progress, '{bad json')
    expect(loadProgress()).toEqual({})
    localStorage.setItem(
      STORAGE_KEYS.progress,
      JSON.stringify({ a: { t: 'x' }, b: { t: 9, d: 99, at: 1 } }),
    )
    expect(Object.keys(loadProgress())).toEqual(['b'])
  })
})
