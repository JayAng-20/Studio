// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildOutputName, formatDate, unknownVars } from '@/features/convert/lib/naming'
import { createDeduper } from '@/lib/filename'

const base = {
  original: 'IMG_1234.HEIC',
  action: 'converted',
  format: 'jpg',
  width: 1920,
  height: 1440,
}

describe('命名規則', () => {
  it('預設 {name}_{action}', () => {
    expect(buildOutputName('{name}_{action}', base)).toBe('IMG_1234_converted.jpg')
  })

  it('{name}_{w}x{h}', () => {
    expect(buildOutputName('{name}_{w}x{h}', base)).toBe('IMG_1234_1920x1440.jpg')
  })

  it('格式、品質、序號（依總數補零）、日期', () => {
    const d = new Date(2026, 9, 2)
    expect(buildOutputName('{index}-{name}', { ...base, index: 3, total: 120 })).toBe(
      '003-IMG_1234.jpg',
    )
    expect(buildOutputName('{name}_{index}', { ...base, index: 7, total: 9 })).toBe(
      'IMG_1234_07.jpg',
    )
    expect(buildOutputName('{name}_q{quality}', { ...base, quality: 82 })).toBe('IMG_1234_q82.jpg')
    expect(buildOutputName('{date}_{name}.{format}', { ...base, date: d })).toBe(
      '20261002_IMG_1234.jpg.jpg',
    )
    expect(formatDate(d)).toBe('20261002')
  })

  it('沒有值的變數連同前面的分隔符一起省略', () => {
    expect(buildOutputName('{name}_q{quality}', { ...base })).toBe('IMG_1234_q.jpg')
    expect(buildOutputName('{name}_{quality}', { ...base })).toBe('IMG_1234.jpg')
    expect(
      buildOutputName('{name}-{w}x{h}', { ...base, width: undefined, height: undefined }),
    ).toBe('IMG_1234x.jpg')
  })

  it('淨化不合法字元，空模板退回原檔名', () => {
    expect(buildOutputName('{name}', { ...base, original: 'a<b>:c?.png' })).toBe('a_b__c_.jpg')
    expect(buildOutputName('', base)).toBe('IMG_1234.jpg')
    expect(buildOutputName('{name}', { ...base, original: 'con.png' })).toBe('image.jpg')
  })

  it('不認得的變數', () => {
    expect(unknownVars('{name}_{foo}_{w}_{bar}_{foo}')).toEqual(['foo', 'bar'])
    expect(unknownVars('{name}_{w}x{h}_{index}_{date}_{format}_{quality}_{action}')).toEqual([])
  })

  it('同名結果自動加流水號', () => {
    const d = createDeduper()
    const names = ['a.png', 'b.png', 'a.png'].map((n) =>
      d(buildOutputName('{name}', { ...base, original: n })),
    )
    expect(names).toEqual(['a.jpg', 'b.jpg', 'a (2).jpg'])
  })
})
