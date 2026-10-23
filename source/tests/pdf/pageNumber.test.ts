// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  formatPageNumber,
  numberingPlan,
  numberingTotal,
  pageNumberLabels,
} from '@/features/pdf/lib/pageNumber'

describe('頁碼文字格式', () => {
  it('三種格式（另含英文）', () => {
    expect(formatPageNumber('plain', 1, 12)).toBe('1')
    expect(formatPageNumber('slash', 3, 12)).toBe('3 / 12')
    expect(formatPageNumber('zh', 5, 12)).toBe('第 5 頁')
    expect(formatPageNumber('en', 5, 12)).toBe('Page 5')
  })
})

describe('編號計畫', () => {
  it('預設從 1 開始', () => {
    expect(numberingPlan(3, { start: 1, skipFirst: false })).toEqual([1, 2, 3])
    expect(numberingTotal(3, { start: 1, skipFirst: false })).toBe(3)
  })
  it('排除首頁：第二頁從起始值開始', () => {
    expect(numberingPlan(4, { start: 1, skipFirst: true })).toEqual([null, 1, 2, 3])
    expect(numberingTotal(4, { start: 1, skipFirst: true })).toBe(3)
  })
  it('自訂起始值', () => {
    expect(numberingPlan(3, { start: 5, skipFirst: false })).toEqual([5, 6, 7])
    expect(pageNumberLabels(3, 'slash', { start: 5, skipFirst: false })).toEqual([
      '5 / 7',
      '6 / 7',
      '7 / 7',
    ])
  })
  it('排除首頁＋1 / N', () => {
    expect(pageNumberLabels(3, 'slash', { start: 1, skipFirst: true })).toEqual([
      null,
      '1 / 2',
      '2 / 2',
    ])
  })
  it('第 n 頁', () => {
    expect(pageNumberLabels(2, 'zh', { start: 1, skipFirst: false })).toEqual([
      '第 1 頁',
      '第 2 頁',
    ])
  })
  it('只有一頁且排除首頁時沒有任何頁碼', () => {
    expect(pageNumberLabels(1, 'plain', { start: 1, skipFirst: true })).toEqual([null])
  })
})
