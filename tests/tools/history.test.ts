// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  COALESCE_MS,
  canRedo,
  canUndo,
  createHistory,
  mapHistory,
  pushHistory,
  redo,
  redoLabel,
  undo,
  undoLabel,
} from '@/features/tools/lib/history'

describe('復原堆疊', () => {
  it('push → undo → redo 依序切換狀態，並記住動作名稱', () => {
    let h = createHistory(0)
    h = pushHistory(h, 1, { label: '裁切', now: 0 })
    h = pushHistory(h, 2, { label: '旋轉', now: 1000 })
    expect(h.present).toBe(2)
    expect(undoLabel(h)).toBe('旋轉')
    h = undo(h)
    expect(h.present).toBe(1)
    expect(redoLabel(h)).toBe('旋轉')
    expect(undoLabel(h)).toBe('裁切')
    h = undo(h)
    expect(h.present).toBe(0)
    expect(canUndo(h)).toBe(false)
    h = redo(h)
    h = redo(h)
    expect(h.present).toBe(2)
    expect(canRedo(h)).toBe(false)
  })

  it('至少保留 50 步（預設上限 100），超過時丟掉最舊的', () => {
    let h = createHistory(0)
    for (let i = 1; i <= 120; i++) h = pushHistory(h, i, { label: `#${i}`, now: i * 10_000 })
    expect(h.past.length).toBe(100)
    let steps = 0
    while (canUndo(h)) {
      h = undo(h)
      steps++
    }
    expect(steps).toBe(100)
    expect(steps).toBeGreaterThanOrEqual(50)
    expect(h.present).toBe(20)
  })

  it('自訂上限', () => {
    let h = createHistory(0)
    for (let i = 1; i <= 10; i++) h = pushHistory(h, i, { label: 'x', now: i * 10_000, limit: 3 })
    expect(h.past.map((e) => e.value)).toEqual([7, 8, 9])
  })

  it('新動作會清掉重做堆疊', () => {
    let h = createHistory('a')
    h = pushHistory(h, 'b', { label: '1', now: 0 })
    h = undo(h)
    h = pushHistory(h, 'c', { label: '2', now: 5000 })
    expect(canRedo(h)).toBe(false)
    expect(h.past.map((e) => e.value)).toEqual(['a'])
  })

  it('相同 key 在時間內連續變更（拖曳滑桿）合併成一步', () => {
    let h = createHistory(0)
    h = pushHistory(h, 1, { label: '亮度', coalesce: 'b', now: 0 })
    h = pushHistory(h, 2, { label: '亮度', coalesce: 'b', now: 100 })
    h = pushHistory(h, 3, { label: '亮度', coalesce: 'b', now: 200 })
    expect(h.past.length).toBe(1)
    expect(h.present).toBe(3)
    h = undo(h)
    expect(h.present).toBe(0)
  })

  it('超過合併時間或換 key 就是新的一步', () => {
    let h = createHistory(0)
    h = pushHistory(h, 1, { label: 'a', coalesce: 'b', now: 0 })
    h = pushHistory(h, 2, { label: 'a', coalesce: 'b', now: COALESCE_MS + 1 })
    h = pushHistory(h, 3, { label: 'a', coalesce: 'c', now: COALESCE_MS + 2 })
    expect(h.past.length).toBe(3)
  })

  it('復原後的合併不會黏到前一步', () => {
    let h = createHistory(0)
    h = pushHistory(h, 1, { label: 'a', coalesce: 'b', now: 0 })
    h = undo(h)
    h = pushHistory(h, 2, { label: 'a', coalesce: 'b', now: 10 })
    expect(h.past.length).toBe(1)
    expect(h.past[0].value).toBe(0)
  })

  it('值沒變時不新增步驟', () => {
    const h = createHistory(5)
    expect(pushHistory(h, 5, { label: 'x' })).toBe(h)
  })

  it('mapHistory 對每個快照套用轉換（刪除圖片時清掉它的狀態）', () => {
    let h = createHistory<Record<string, number>>({ a: 1, b: 1 })
    h = pushHistory(h, { a: 2, b: 1 }, { label: 'x', now: 0 })
    h = mapHistory(h, (s) => {
      const n = { ...s }
      delete n.b
      return n
    })
    expect(h.present).toEqual({ a: 2 })
    expect(h.past[0].value).toEqual({ a: 1 })
  })
})
