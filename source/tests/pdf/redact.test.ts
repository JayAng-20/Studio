import { describe, expect, it } from 'vitest'
import { spanRatio } from '@/features/pdf/lib/redact'

describe('塗黑框位置', () => {
  it('沒有量測函式時依字數比例', () => {
    expect(spanRatio('abcd', 1, 3)).toEqual([0.25, 0.75])
  })
  it('有量測函式時依實際字寬（比例字型下 i 與 W 寬度差很多）', () => {
    const widths: Record<string, number> = { i: 1, W: 4 }
    const measure = (s: string) => [...s].reduce((n, c) => n + (widths[c] ?? 2), 0)
    // 'iiiiWWWW' 總寬 20；'WWWW' 從 4 開始到 20
    expect(spanRatio('iiiiWWWW', 4, 8, measure)).toEqual([0.2, 1])
  })
})
