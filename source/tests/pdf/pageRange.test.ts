// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  chunkPages,
  formatPageRange,
  parsePageRange,
  spanToIndices,
} from '@/features/pdf/lib/pageRange'

const pages = (input: string, count = 10) => {
  const r = parsePageRange(input, count)
  if (!r.ok) throw new Error(`預期成功，卻得到 ${r.error.code}`)
  return r.pages
}
const err = (input: string, count = 10) => {
  const r = parsePageRange(input, count)
  if (r.ok) throw new Error(`預期失敗，卻得到 ${r.pages.join(',')}`)
  return r.error
}

describe('parsePageRange：正確輸入', () => {
  it('單頁、範圍、開放結尾', () => {
    expect(pages('1-3,5,8-')).toEqual([1, 2, 3, 5, 8, 9, 10])
  })
  it('開放開頭 -3', () => {
    expect(pages('-3')).toEqual([1, 2, 3])
  })
  it('單一頁與整份', () => {
    expect(pages('7')).toEqual([7])
    expect(pages('1-')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
  it('容許空白、全形逗號、頓號、分號與各種連字號', () => {
    expect(pages(' 1 - 2 ， 4、6；8～9 ')).toEqual([1, 2, 4, 6, 8, 9])
    expect(pages('1–2,3—4')).toEqual([1, 2, 3, 4])
  })
  it('全形數字', () => {
    expect(pages('１－３')).toEqual([1, 2, 3])
  })
  it('保留輸入順序與重複', () => {
    expect(pages('5,1-2,1')).toEqual([5, 1, 2, 1])
  })
  it('結尾多一個逗號可以接受', () => {
    expect(pages('1,2,')).toEqual([1, 2])
  })
  it('單頁範圍 3-3', () => {
    expect(pages('3-3')).toEqual([3])
  })
  it('spans 保留每個群組', () => {
    const r = parsePageRange('1-3,5,8-', 10)
    expect(r.ok && r.spans).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 8, end: 10 },
    ])
  })
})

describe('parsePageRange：錯誤輸入', () => {
  it('空字串與只有空白', () => {
    expect(err('').code).toBe('empty')
    expect(err('   ').code).toBe('empty')
  })
  it('無法辨識的文字', () => {
    const e = err('1,abc')
    expect(e.code).toBe('syntax')
    expect(e.token).toBe('abc')
    expect(e.index).toBe(2)
  })
  it('多重連字號與單獨連字號', () => {
    expect(err('1-2-3').code).toBe('syntax')
    expect(err('-').code).toBe('syntax')
    expect(err('1--3').code).toBe('syntax')
  })
  it('小數與負號形式', () => {
    expect(err('1.5').code).toBe('syntax')
    expect(err('--2').code).toBe('syntax')
  })
  it('第 0 頁', () => {
    expect(err('0').code).toBe('zero')
    expect(err('0-3').code).toBe('zero')
  })
  it('超過總頁數', () => {
    const e = err('3,11', 10)
    expect(e.code).toBe('outOfRange')
    expect(e.max).toBe(10)
    expect(e.token).toBe('11')
    expect(err('9-12').code).toBe('outOfRange')
    expect(err('99999999999999999999').code).toBe('outOfRange')
  })
  it('反向範圍', () => {
    const e = err('5-3')
    expect(e.code).toBe('reversed')
    expect(e.token).toBe('5-3')
  })
  it('中間空項目', () => {
    expect(err('1,,3').code).toBe('emptyItem')
    expect(err(',1').code).toBe('emptyItem')
  })
  it('文件沒有頁面', () => {
    expect(err('1', 0).code).toBe('noPages')
  })
  it('錯誤位置指向片段開頭（跳過前導空白）', () => {
    const e = err('1,  x')
    expect(e.index).toBe(4)
  })
})

describe('formatPageRange 與輔助函式', () => {
  it('壓縮連續頁碼', () => {
    expect(formatPageRange([1, 2, 3, 5, 8, 9, 10])).toBe('1-3,5,8-10')
    expect(formatPageRange([])).toBe('')
    expect(formatPageRange([4])).toBe('4')
    expect(formatPageRange([3, 2, 1])).toBe('3,2,1')
  })
  it('解析後再格式化可來回', () => {
    expect(formatPageRange(pages('1-3,5,8-'))).toBe('1-3,5,8-10')
  })
  it('每 N 頁一組', () => {
    expect(chunkPages(10, 4)).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 8 },
      { start: 9, end: 10 },
    ])
    expect(chunkPages(3, 0)).toHaveLength(3)
  })
  it('範圍轉 0 起算索引', () => {
    expect(spanToIndices({ start: 2, end: 4 })).toEqual([1, 2, 3])
  })
})
