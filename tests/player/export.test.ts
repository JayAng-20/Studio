// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clipPlan, parseLogTime } from '@/features/player/export'

describe('A–B 區間匯出參數', () => {
  it('預設 -c copy，保留原副檔名，-ss 在 -i 之前', () => {
    const p = clipPlan('movie.webm', 2, 8, false)
    expect(p.outExt).toBe('webm')
    const args = p.args(p.inName, 'out.webm')
    expect(args).toContain('copy')
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args[args.indexOf('-ss') + 1]).toBe('2.000')
    expect(args[args.indexOf('-t') + 1]).toBe('6.000')
  })
  it('精準剪裁：影片重新編碼成 MP4（H.264＋AAC）', () => {
    const p = clipPlan('clip.mov', 1.5, 4, true)
    expect(p.outExt).toBe('mp4')
    const args = p.args(p.inName, 'o.mp4')
    expect(args).toContain('libx264')
    expect(args).toContain('aac')
    expect(args).not.toContain('copy')
  })
  it('精準剪裁：音訊依格式選編碼器', () => {
    expect(clipPlan('a.mp3', 0, 1, true).outExt).toBe('mp3')
    expect(clipPlan('a.wav', 0, 1, true).outExt).toBe('wav')
    expect(clipPlan('a.flac', 0, 1, true).outExt).toBe('m4a')
  })
  it('從 log 解析進度時間', () => {
    expect(parseLogTime('frame=  12 fps=0.0 q=-1.0 size=0kB time=00:00:03.52 bitrate=')).toBeCloseTo(3.52)
    expect(parseLogTime('time=01:02:03.00')).toBe(3723)
    expect(parseLogTime('no time here')).toBeNull()
  })
})
