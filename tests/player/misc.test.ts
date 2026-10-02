// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SPEEDS, estimateFrameDuration, frameStep, stepSpeed } from '@/features/player/logic/speed'
import { MEDIA_ERR, diagnose, likelyUnsupported } from '@/features/player/logic/formats'
import { id3TagSize, parseId3 } from '@/features/player/logic/id3'
import { computePeaks } from '@/features/player/logic/waveform'
import { upsertSaved } from '@/features/player/logic/savedPlaylists'

describe('速度', () => {
  it('[ ] 在清單中切換並停在兩端', () => {
    expect(stepSpeed(1, 1)).toBe(1.25)
    expect(stepSpeed(1, -1)).toBe(0.75)
    expect(stepSpeed(4, 1)).toBe(4)
    expect(stepSpeed(0.25, -1)).toBe(0.25)
    expect(stepSpeed(1.1, 1)).toBe(1.25)
    expect(stepSpeed(1.1, -1)).toBe(1)
    expect(SPEEDS).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4])
  })
})

describe('逐格', () => {
  it('樣本不足時預設 1/30', () => expect(estimateFrameDuration([0.04])).toBeCloseTo(1 / 30))
  it('取中位數（忽略離群值）', () => {
    const d = estimateFrameDuration([0.04, 0.04, 0.04, 0.08, 0.04, 0.0001, 0.04])
    expect(d).toBeCloseTo(0.04)
  })
  it('前進與後退一格', () => {
    const f = 1 / 25
    const t1 = frameStep(1, f, 1, 10)
    expect(Math.round(t1 / f)).toBe(26)
    const t0 = frameStep(t1, f, -1, 10)
    expect(Math.round(t0 / f)).toBe(25)
    expect(frameStep(0, f, -1, 10)).toBeGreaterThanOrEqual(0)
  })
})

describe('不支援格式診斷', () => {
  const none = () => ''
  it('MKV／AVI／HEVC／杜比', () => {
    expect(diagnose({ name: 'a.mkv', type: '', errorCode: 4, canPlayType: none }).reason).toBe(
      'mkv',
    )
    expect(diagnose({ name: 'a.AVI', type: '', errorCode: 4, canPlayType: none }).reason).toBe(
      'avi',
    )
    expect(
      diagnose({ name: 'IMG_0001.MOV', type: 'video/quicktime', errorCode: 4, canPlayType: none })
        .reason,
    ).toBe('hevc')
    expect(diagnose({ name: 'a.ac3', type: '', errorCode: 4, canPlayType: none }).reason).toBe(
      'dolby',
    )
    expect(
      diagnose({ name: 'a.mp4', type: 'video/mp4', errorCode: 4, canPlayType: none }).reason,
    ).toBe('apac')
  })
  it('沒有畫面時判定為 HEVC', () => {
    const d = diagnose({
      name: 'clip.mp4',
      type: 'video/mp4',
      errorCode: null,
      canPlayType: none,
      noVideoTrack: true,
    })
    expect(d.reason).toBe('hevc')
    expect(d.tips).toContain('iphoneCompat')
  })
  it('網址的網路錯誤', () => {
    expect(
      diagnose({
        name: 'https://x/a.m3u8',
        type: '',
        errorCode: MEDIA_ERR.network,
        canPlayType: none,
        isUrl: true,
        isHls: true,
      }).reason,
    ).toBe('hls')
  })
  it('附上 canPlayType 結果', () => {
    const d = diagnose({
      name: 'a.mkv',
      type: 'video/x-matroska',
      errorCode: 4,
      canPlayType: (m) => (m.includes('webm') ? 'maybe' : ''),
    })
    expect(d.probe[0]).toEqual({ mime: 'video/x-matroska', result: '' })
    expect(d.probe.some((p) => p.result === 'maybe')).toBe(true)
  })
  it('likelyUnsupported', () => {
    expect(likelyUnsupported('a.wmv')).toBe(true)
    expect(likelyUnsupported('a.mp4')).toBe(false)
  })
})

describe('ID3', () => {
  /** 組一個 ID3v2.3 標籤 */
  function buildId3(): Uint8Array {
    const enc = new TextEncoder()
    const frame = (id: string, body: number[]) => {
      const size = body.length
      return [
        ...enc.encode(id),
        (size >>> 24) & 255,
        (size >>> 16) & 255,
        (size >>> 8) & 255,
        size & 255,
        0,
        0,
        ...body,
      ]
    }
    const title = frame('TIT2', [3, ...enc.encode('晨光')])
    const artist = frame('TPE1', [0, ...enc.encode('Band')])
    const png = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]
    const apic = frame('APIC', [0, ...enc.encode('image/png'), 0, 3, 0, ...png])
    const body = [...title, ...artist, ...apic]
    const n = body.length
    const ss = [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]
    return new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, ...ss, ...body, 0xff, 0xfb])
  }
  it('解析標題、演出者、封面', () => {
    const bytes = buildId3()
    expect(id3TagSize(bytes)).toBe(bytes.length - 2)
    const tags = parseId3(bytes)!
    expect(tags.title).toBe('晨光')
    expect(tags.artist).toBe('Band')
    expect(tags.picture?.mime).toBe('image/png')
    expect(Array.from(tags.picture!.data)).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  })
  it('不是 ID3', () => expect(parseId3(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull())
})

describe('波形峰值', () => {
  it('正規化到 0–1', () => {
    const ch = new Float32Array(1000)
    for (let i = 0; i < 1000; i++) ch[i] = i < 500 ? 0.25 : -0.5
    const p = computePeaks([ch], 10)
    expect(p).toHaveLength(10)
    expect(p[0]).toBeCloseTo(0.5)
    expect(p[9]).toBeCloseTo(1)
  })
})

describe('播放清單儲存', () => {
  it('同名覆寫、新的在前', () => {
    const a = { id: '1', name: '晚上', names: ['a'], savedAt: 1 }
    const b = { id: '2', name: '早上', names: ['b'], savedAt: 2 }
    const c = { id: '3', name: '晚上', names: ['c'], savedAt: 3 }
    expect(upsertSaved(upsertSaved([a], b), c).map((p) => p.id)).toEqual(['3', '2'])
  })
})
