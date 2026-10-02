// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  fileTime,
  formatDelta,
  formatPrecise,
  ffmpegTime,
  parseTimecode,
} from '@/features/player/logic/timecode'
import { formatTime } from '@/lib/format'

describe('parseTimecode', () => {
  it.each([
    ['75', 75],
    ['75.5', 75.5],
    ['1:15', 75],
    ['01:15.5', 75.5],
    ['1:02:03', 3723],
    ['1:02:03,25', 3723.25],
    [' 12:34 ', 754],
  ])('%s → %d', (s, v) => expect(parseTimecode(s)).toBeCloseTo(v, 6))
  it.each(['', 'abc', '1:75', '1:2:3:4', '-5'])('無效：%s', (s) =>
    expect(parseTimecode(s)).toBeNull(),
  )
})

describe('格式化', () => {
  it('formatTime（共用）：12:34 與小時', () => {
    expect(formatTime(754)).toBe('12:34')
    expect(formatTime(3723)).toBe('1:02:03')
    expect(formatTime(NaN)).toBe('00:00')
  })
  it('formatPrecise 顯示到百分之一秒', () => {
    expect(formatPrecise(0)).toBe('00:00.00')
    expect(formatPrecise(62.345)).toBe('01:02.35')
    expect(formatPrecise(3723.5)).toBe('1:02:03.50')
    expect(formatPrecise(-1)).toBe('00:00.00')
  })
  it('formatDelta 帶正負號', () => {
    expect(formatDelta(10)).toBe('+10')
    expect(formatDelta(-10)).toBe('−10')
    expect(formatDelta(65)).toBe('+1:05')
  })
  it('ffmpegTime', () => {
    expect(ffmpegTime(1.23456)).toBe('1.235')
    expect(ffmpegTime(-2)).toBe('0.000')
  })
  it('fileTime 可用於檔名', () => {
    expect(fileTime(754.9)).toBe('12-34')
    expect(fileTime(3723)).toBe('01-02-03')
  })
})
