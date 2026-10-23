import { describe, expect, it } from 'vitest'
import { zhDict, enDict } from '@/i18n/dictionaries'
import { interpolate } from '@/i18n'

const flatten = (o: object, p = ''): Record<string, string> =>
  Object.entries(o).reduce(
    (acc, [k, v]) =>
      typeof v === 'string'
        ? { ...acc, [p + k]: v }
        : { ...acc, ...flatten(v as object, `${p}${k}.`) },
    {} as Record<string, string>,
  )

describe('i18n', () => {
  const zh = flatten(zhDict)
  const en = flatten(enDict)
  it('zh-TW 與 en 的鍵完全一致', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
  it('沒有空字串（placeholder 除外）', () => {
    for (const [k, v] of Object.entries(zh))
      if (!k.endsWith('placeholder')) expect(v, k).not.toBe('')
  })
  it('變數名稱一致', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) || []).sort().join()
    for (const k of Object.keys(zh)) expect(vars(en[k]), k).toBe(vars(zh[k]))
  })
  it('中文不使用大陸用語', () => {
    const banned = [
      '視頻',
      '默認',
      '設置',
      '保存',
      '導出',
      '導入',
      '文件夾',
      '鼠標',
      '光標',
      '軟件',
      '網絡',
      '程序',
      '您',
    ]
    for (const [k, v] of Object.entries(zh))
      for (const w of banned) expect(v.includes(w), `${k}：${w}`).toBe(false)
  })
  it('interpolate 只替換提供的變數', () => {
    expect(interpolate('{a} 與 {b}', { a: 1 })).toBe('1 與 {b}')
  })
})
