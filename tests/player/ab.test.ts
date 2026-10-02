// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  AB_MIN,
  abLength,
  dragHandle,
  emptyAB,
  isComplete,
  loopTarget,
  setA,
  setB,
} from '@/features/player/logic/ab'

describe('A–B 區間', () => {
  it('設 A 再設 B', () => {
    const a = setA(emptyAB, 10, 100)
    expect(a).toEqual({ a: 10, b: null })
    const r = setB(a, 20, 100)
    expect(r.warning).toBeNull()
    expect(r.ab).toEqual({ a: 10, b: 20 })
    expect(abLength(r.ab)).toBe(10)
    expect(isComplete(r.ab)).toBe(true)
  })
  it('沒有 A 時直接設 B，A 視為 0', () => {
    expect(setB(emptyAB, 5, 100).ab).toEqual({ a: 0, b: 5 })
  })
  it('B 在 A 之前會被拒絕並給警告', () => {
    const r = setB({ a: 30, b: null }, 20, 100)
    expect(r.warning).toBe('bBeforeA')
    expect(r.ab).toEqual({ a: 30, b: null })
  })
  it('區間太短', () => {
    expect(setB({ a: 10, b: null }, 10 + AB_MIN / 2, 100).warning).toBe('tooShort')
  })
  it('A 移到 B 之後會清除 B', () => {
    expect(setA({ a: 10, b: 20 }, 25, 100)).toEqual({ a: 25, b: null })
    expect(setA({ a: 10, b: 20 }, 15, 100)).toEqual({ a: 15, b: 20 })
  })
  it('超出長度時夾在範圍內', () => {
    expect(setA(emptyAB, -3, 100).a).toBe(0)
    expect(setB({ a: 10, b: null }, 500, 100).ab.b).toBe(100)
  })
  it('拖曳把手不會交錯', () => {
    const ab = { a: 10, b: 20 }
    expect(dragHandle(ab, 'a', 25, 100).a).toBeCloseTo(20 - AB_MIN)
    expect(dragHandle(ab, 'b', 5, 100).b).toBeCloseTo(10 + AB_MIN)
    expect(dragHandle(ab, 'b', 150, 100).b).toBe(100)
    expect(dragHandle(ab, 'a', 12, 100)).toEqual({ a: 12, b: 20 })
  })
  it('區間循環：到 B 時回到 A；關閉或不完整時不動作', () => {
    const ab = { a: 10, b: 20 }
    expect(loopTarget(ab, 19.9, true)).toBeNull()
    expect(loopTarget(ab, 20, true)).toBe(10)
    expect(loopTarget(ab, 20.3, true)).toBe(10)
    expect(loopTarget(ab, 20, false)).toBeNull()
    expect(loopTarget({ a: 10, b: null }, 20, true)).toBeNull()
    // 使用者自己跳到很後面：不拉回
    expect(loopTarget(ab, 50, true)).toBeNull()
  })
})
