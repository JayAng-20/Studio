// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  makeShuffleOrder,
  moveItem,
  nextId,
  orderByNames,
  prevId,
  removeFromQueue,
  syncOrder,
  type QueueState,
} from '@/features/player/logic/playlist'

const base: QueueState = {
  ids: ['a', 'b', 'c'],
  order: ['a', 'b', 'c'],
  currentId: 'a',
  shuffle: false,
  repeat: 'off',
}

/** 可重現的亂數 */
const seeded =
  (seed = 1) =>
  () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }

describe('nextId／prevId', () => {
  it('依序播放，最後一首沒有下一首', () => {
    expect(nextId(base)).toBe('b')
    expect(nextId({ ...base, currentId: 'c' })).toBeNull()
    expect(nextId({ ...base, currentId: 'c' }, 'ended')).toBeNull()
  })
  it('全部循環回到第一首', () => {
    expect(nextId({ ...base, currentId: 'c', repeat: 'all' })).toBe('a')
    expect(prevId({ ...base, currentId: 'a', repeat: 'all' })).toBe('c')
  })
  it('單曲循環：播完重播同一首，手動下一首仍前進', () => {
    const s = { ...base, currentId: 'b', repeat: 'one' as const }
    expect(nextId(s, 'ended')).toBe('b')
    expect(nextId(s, 'user')).toBe('c')
    expect(nextId({ ...s, currentId: 'c' }, 'user')).toBe('a')
  })
  it('上一首', () => {
    expect(prevId({ ...base, currentId: 'b' })).toBe('a')
    expect(prevId(base)).toBeNull()
  })
  it('隨機：依 order 前進', () => {
    const s = { ...base, shuffle: true, order: ['a', 'c', 'b'] }
    expect(nextId(s)).toBe('c')
    expect(nextId({ ...s, currentId: 'c' })).toBe('b')
    expect(nextId({ ...s, currentId: 'b' })).toBeNull()
    expect(prevId({ ...s, currentId: 'b' })).toBe('c')
  })
  it('空清單與找不到目前曲目', () => {
    expect(nextId({ ...base, ids: [], order: [] })).toBeNull()
    expect(nextId({ ...base, currentId: null })).toBe('a')
  })
})

describe('隨機順序', () => {
  it('包含全部且目前曲目在第一個', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `t${i}`)
    const order = makeShuffleOrder(ids, 't7', seeded(3))
    expect(order[0]).toBe('t7')
    expect([...order].sort()).toEqual([...ids].sort())
    expect(order).not.toEqual(ids)
  })
  it('syncOrder：移除不存在的、新項目插在目前曲目之後', () => {
    const out = syncOrder(['c', 'a', 'b'], ['a', 'c', 'd'], 'a', seeded(5))
    expect(out.slice(0, 2)).toEqual(['c', 'a'])
    expect(out).toContain('d')
    expect(out).not.toContain('b')
    expect(out.indexOf('d')).toBeGreaterThan(out.indexOf('a'))
  })
})

describe('移除與排序', () => {
  it('移除目前曲目時改選下一首', () => {
    const s = removeFromQueue({ ...base, currentId: 'b' }, 'b')
    expect(s.ids).toEqual(['a', 'c'])
    expect(s.currentId).toBe('c')
  })
  it('移除最後一首時改選上一首；清空時為 null', () => {
    expect(removeFromQueue({ ...base, currentId: 'c' }, 'c').currentId).toBe('b')
    const one = { ...base, ids: ['a'], order: ['a'] }
    expect(removeFromQueue(one, 'a').currentId).toBeNull()
  })
  it('移除其他曲目不影響目前曲目', () => {
    expect(removeFromQueue(base, 'c').currentId).toBe('a')
  })
  it('moveItem', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })
  it('orderByNames 依儲存的檔名順序排列', () => {
    const files = [{ name: 'b.mp3' }, { name: 'x.mp3' }, { name: 'a.mp3' }]
    const r = orderByNames(files, ['a.mp3', 'b.mp3', 'c.mp3'])
    expect(r.ordered.map((f) => f.name)).toEqual(['a.mp3', 'b.mp3'])
    expect(r.missing).toEqual(['c.mp3'])
    expect(r.extra.map((f) => f.name)).toEqual(['x.mp3'])
  })
})
