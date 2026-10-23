// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  addMarker,
  adjacentMarker,
  audioBitrate,
  baseMime,
  clampBubble,
  clampMarkers,
  createStopwatch,
  DEFAULT_PREFS,
  estimateBytesPerMinute,
  extensionFor,
  formatBitrate,
  formatClock,
  formatDuration,
  isFullRange,
  levelFromSamples,
  listFormats,
  markerFraction,
  markersToText,
  needsDurationFix,
  normalizeRange,
  parsePrefs,
  pickFormat,
  recordingName,
  removeMarker,
  sizeLevel,
  SIZE_LIMIT_BYTES,
  SIZE_WARN_BYTES,
  trimMarkers,
  videoBitrate,
  type Marker,
} from '@/features/recorder/core'

const chromeLike = new Set([
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=av01,opus',
])
const chromiumNoH264 = new Set([
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=av1,opus',
])
const safariLike = new Set(['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'])
const firefoxLike = new Set(['video/webm;codecs=vp8,opus', 'video/webm'])

describe('listFormats', () => {
  it('Chrome：四種格式各取第一個支援的 MIME', () => {
    const f = listFormats((m) => chromeLike.has(m))
    expect(f.map((x) => x.id)).toEqual(['mp4', 'webm-vp9', 'webm-vp8', 'webm-av1'])
    expect(f[0].mime).toBe('video/mp4;codecs=avc1.640028,mp4a.40.2')
    expect(f[0].h264).toBe(true)
    expect(f[3].mime).toBe('video/webm;codecs=av01,opus')
  })
  it('沒有 H.264 時 MP4 退回一般 video/mp4，AV1 用替代寫法', () => {
    const f = listFormats((m) => chromiumNoH264.has(m))
    expect(f.find((x) => x.id === 'mp4')).toMatchObject({ mime: 'video/mp4', h264: false })
    expect(f.find((x) => x.id === 'webm-av1')?.mime).toBe('video/webm;codecs=av1,opus')
  })
  it('Safari 只有 MP4，Firefox 只有 VP8', () => {
    expect(listFormats((m) => safariLike.has(m)).map((x) => x.id)).toEqual(['mp4'])
    expect(listFormats((m) => firefoxLike.has(m)).map((x) => x.id)).toEqual(['webm-vp8'])
  })
  it('isTypeSupported 丟例外或完全不支援時回傳空陣列', () => {
    expect(
      listFormats(() => {
        throw new Error('x')
      }),
    ).toEqual([])
    expect(listFormats(() => false)).toEqual([])
  })
})

describe('pickFormat', () => {
  it('預設優先 H.264 MP4', () => {
    expect(pickFormat(listFormats((m) => chromeLike.has(m)))?.id).toBe('mp4')
  })
  it('沒有 H.264 時優先 VP9', () => {
    expect(pickFormat(listFormats((m) => chromiumNoH264.has(m)))?.id).toBe('webm-vp9')
  })
  it('偏好格式可用就沿用，不可用就退回預設', () => {
    const f = listFormats((m) => chromeLike.has(m))
    expect(pickFormat(f, 'webm-av1')?.id).toBe('webm-av1')
    expect(
      pickFormat(
        listFormats((m) => firefoxLike.has(m)),
        'mp4',
      )?.id,
    ).toBe('webm-vp8')
  })
  it('沒有任何格式時回傳 null', () => {
    expect(pickFormat([])).toBeNull()
  })
})

describe('MIME 工具', () => {
  it('baseMime／extensionFor／needsDurationFix', () => {
    expect(baseMime('video/webm;codecs=vp9,opus')).toBe('video/webm')
    expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4')
    expect(extensionFor('video/x-matroska;codecs=avc1')).toBe('webm')
    expect(needsDurationFix('video/webm;codecs=vp8')).toBe(true)
    expect(needsDurationFix('video/mp4')).toBe(false)
  })
})

describe('位元率對應', () => {
  it('1080p30 等於基準值，品質越高位元率越高', () => {
    const s = { width: 1920, height: 1080 }
    expect(videoBitrate('standard', 30, s)).toBe(4_000_000)
    expect(videoBitrate('high', 30, s)).toBe(8_000_000)
    expect(videoBitrate('ultra', 30, s)).toBe(16_000_000)
  })
  it('60 fps 乘 1.5', () => {
    expect(videoBitrate('high', 60, { width: 1920, height: 1080 })).toBe(12_000_000)
  })
  it('解析度越高位元率越高，但有上下限', () => {
    const k4 = videoBitrate('high', 30, { width: 3840, height: 2160 })
    const p720 = videoBitrate('high', 30, { width: 1280, height: 720 })
    expect(k4).toBeGreaterThan(8_000_000)
    expect(p720).toBeLessThan(8_000_000)
    expect(videoBitrate('high', 30, { width: 100, height: 100 })).toBe(2_800_000)
    expect(videoBitrate('high', 30, { width: 20000, height: 20000 })).toBe(24_000_000)
  })
  it('未知尺寸時以 1080p 計算', () => {
    expect(videoBitrate('standard', 30)).toBe(4_000_000)
    expect(videoBitrate('standard', 30, { width: 0, height: 0 })).toBe(4_000_000)
  })
  it('音訊位元率與每分鐘大小', () => {
    expect(audioBitrate('standard')).toBe(128_000)
    expect(audioBitrate('ultra')).toBe(192_000)
    expect(estimateBytesPerMinute(8_000_000, 0)).toBe(60_000_000)
  })
  it('formatBitrate', () => {
    expect(formatBitrate(4_000_000)).toBe('4 Mbps')
    expect(formatBitrate(8_500_000)).toBe('8.5 Mbps')
    expect(formatBitrate(128_000)).toBe('128 kbps')
  })
})

describe('計時格式', () => {
  it('formatClock：00:12.4 格式', () => {
    expect(formatClock(0)).toBe('00:00.0')
    expect(formatClock(12_400)).toBe('00:12.4')
    expect(formatClock(12_499)).toBe('00:12.4')
    expect(formatClock(65_000)).toBe('01:05.0')
    expect(formatClock(3_723_400)).toBe('1:02:03.4')
    expect(formatClock(-5)).toBe('00:00.0')
    expect(formatClock(Number.NaN)).toBe('00:00.0')
  })
  it('formatDuration', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3723)).toBe('1:02:03')
    expect(formatDuration(0.4)).toBe('0:00')
  })
})

describe('碼錶', () => {
  it('暫停期間不計時', () => {
    let now = 1000
    const sw = createStopwatch(() => now)
    expect(sw.state).toBe('idle')
    sw.start()
    now = 3000
    expect(sw.elapsed()).toBe(2000)
    sw.pause()
    now = 10_000
    expect(sw.elapsed()).toBe(2000)
    expect(sw.state).toBe('paused')
    sw.resume()
    now = 10_500
    expect(sw.elapsed()).toBe(2500)
    sw.pause()
    sw.pause()
    expect(sw.elapsed()).toBe(2500)
  })
  it('未暫停時 resume 無作用', () => {
    let now = 0
    const sw = createStopwatch(() => now)
    sw.start()
    now = 100
    sw.resume()
    now = 200
    expect(sw.elapsed()).toBe(200)
  })
})

describe('標記', () => {
  it('加入後依時間排序、四捨五入到 0.1 秒', () => {
    let list: Marker[] = []
    list = addMarker(list, 5.04, 'a')
    list = addMarker(list, 2.26, 'b')
    expect(list).toEqual([
      { id: 'b', t: 2.3 },
      { id: 'a', t: 5 },
    ])
  })
  it('與既有標記相隔不到 0.5 秒時忽略', () => {
    const list = addMarker([], 5, 'a')
    expect(addMarker(list, 5.3, 'b')).toBe(list)
    expect(addMarker(list, 5.6, 'b')).toHaveLength(2)
  })
  it('無效時間忽略', () => {
    expect(addMarker([], -1, 'a')).toEqual([])
    expect(addMarker([], Number.NaN, 'a')).toEqual([])
  })
  it('移除', () => {
    const list = addMarker(addMarker([], 1, 'a'), 3, 'b')
    expect(removeMarker(list, 'a')).toEqual([{ id: 'b', t: 3 }])
  })
  it('裁切後只保留區間內並平移', () => {
    const list: Marker[] = [
      { id: 'a', t: 1 },
      { id: 'b', t: 4.5 },
      { id: 'c', t: 9 },
    ]
    expect(trimMarkers(list, 2, 8)).toEqual([{ id: 'b', t: 2.5 }])
    expect(trimMarkers(list, 0, 9)).toHaveLength(3)
  })
  it('限制在影片長度內', () => {
    expect(clampMarkers([{ id: 'a', t: 10.4 }], 10.2)).toEqual([{ id: 'a', t: 10.2 }])
    expect(clampMarkers([{ id: 'a', t: 10.4 }], 0)).toEqual([{ id: 'a', t: 10.4 }])
  })
  it('時間軸位置', () => {
    expect(markerFraction(5, 10)).toBe(0.5)
    expect(markerFraction(12, 10)).toBe(1)
    expect(markerFraction(1, 0)).toBe(0)
  })
  it('上一個／下一個標記', () => {
    const list: Marker[] = [
      { id: 'a', t: 2 },
      { id: 'b', t: 5 },
      { id: 'c', t: 8 },
    ]
    expect(adjacentMarker(list, 5, 1)?.id).toBe('c')
    expect(adjacentMarker(list, 5, -1)?.id).toBe('a')
    expect(adjacentMarker(list, 0, -1)).toBeNull()
    expect(adjacentMarker(list, 8, 1)).toBeNull()
  })
  it('轉成文字', () => {
    const list: Marker[] = [
      { id: 'a', t: 12.4 },
      { id: 'b', t: 65 },
    ]
    expect(markersToText(list, (i) => `標記 ${i}`)).toBe('00:12.4 標記 1\n01:05.0 標記 2')
  })
})

describe('容量門檻', () => {
  it('ok → warn → limit', () => {
    expect(sizeLevel(0)).toBe('ok')
    expect(sizeLevel(SIZE_WARN_BYTES - 1)).toBe('ok')
    expect(sizeLevel(SIZE_WARN_BYTES)).toBe('warn')
    expect(sizeLevel(SIZE_LIMIT_BYTES)).toBe('limit')
    expect(SIZE_WARN_BYTES).toBe(1.5 * 1024 ** 3)
  })
})

describe('音量', () => {
  it('靜音為 0、滿刻度為 1、中間單調遞增', () => {
    expect(levelFromSamples(new Float32Array(128))).toBe(0)
    expect(levelFromSamples(new Float32Array(128).fill(1))).toBe(1)
    const quiet = levelFromSamples(new Float32Array(128).fill(0.01))
    const loud = levelFromSamples(new Float32Array(128).fill(0.3))
    expect(quiet).toBeGreaterThan(0)
    expect(loud).toBeGreaterThan(quiet)
    expect(levelFromSamples([])).toBe(0)
  })
})

describe('偏好設定', () => {
  it('非物件時回傳預設值（且不共用參考）', () => {
    const p = parsePrefs(null)
    expect(p).toEqual(DEFAULT_PREFS)
    expect(p.bubble).not.toBe(DEFAULT_PREFS.bubble)
  })
  it('型別錯誤的欄位用預設值，數值會被限制', () => {
    const p = parsePrefs({
      mode: 'camera',
      fps: 60,
      quality: 'ultra',
      format: 'webm-av1',
      mic: 'yes',
      bubble: { x: 3, y: -1, size: 9, mirror: false },
    })
    expect(p.mode).toBe('camera')
    expect(p.fps).toBe(60)
    expect(p.quality).toBe('ultra')
    expect(p.format).toBe('webm-av1')
    expect(p.mic).toBe(DEFAULT_PREFS.mic)
    expect(p.bubble).toEqual({ x: 1, y: 0, size: 0.45, mirror: false })
  })
  it('未知的格式與影格率退回預設', () => {
    const p = parsePrefs({ format: 'avi', fps: 24, quality: 'max' })
    expect(p.format).toBeNull()
    expect(p.fps).toBe(30)
    expect(p.quality).toBe('high')
  })
  it('clampBubble：整個圓留在畫面內', () => {
    const b = clampBubble({ x: 1, y: 1, size: 0.2, mirror: true }, 16 / 9)
    // 短邊為高：半徑 0.1（以高為 1），寬方向 0.1 / (16/9)
    expect(b.y).toBeCloseTo(0.9)
    expect(b.x).toBeCloseTo(1 - 0.1 / (16 / 9))
    const c = clampBubble({ x: 0.5, y: 0.5, size: 0.2, mirror: true }, 16 / 9)
    expect(c.x).toBe(0.5)
  })
})

describe('檔名與裁切範圍', () => {
  it('recordingName', () => {
    const d = new Date(2026, 9, 2, 14, 3, 9)
    expect(recordingName('螢幕錄影', d, 'webm')).toBe('螢幕錄影 2026-10-02 14.03.09.webm')
  })
  it('normalizeRange：排序、限制、最短長度', () => {
    expect(normalizeRange([5, 2], 10)).toEqual([2, 5])
    expect(normalizeRange([-1, 20], 10)).toEqual([0, 10])
    expect(normalizeRange([9.9, 10], 10)).toEqual([9.5, 10])
    expect(normalizeRange([3, 3.1], 10)).toEqual([3, 3.5])
  })
  it('isFullRange', () => {
    expect(isFullRange([0, 10], 10)).toBe(true)
    expect(isFullRange([0.5, 10], 10)).toBe(false)
  })
})

describe('音量條頻帶', () => {
  it('長度正確、數值在 0 到 1 之間', async () => {
    const { bandLevels } = await import('@/features/recorder/core')
    const freq = new Uint8Array(512).fill(255)
    const bands = bandLevels(freq, 12)
    expect(bands).toHaveLength(12)
    expect(bands.every((b) => b >= 0 && b <= 1)).toBe(true)
    expect(bands.every((b) => b === 1)).toBe(true)
    expect(bandLevels(new Uint8Array(512), 5)).toEqual([0, 0, 0, 0, 0])
    expect(bandLevels(new Uint8Array(0), 3)).toEqual([0, 0, 0])
    expect(bandLevels(freq, 0)).toEqual([])
  })
})

describe('媒體錯誤分類', () => {
  it('螢幕擷取：取消與系統拒絕分開', async () => {
    const { classifyMediaError } = await import('@/features/recorder/core')
    const err = (name: string, message = '') => Object.assign(new Error(message), { name })
    expect(classifyMediaError(err('NotAllowedError', 'Permission denied'), 'display')).toBe(
      'canceled',
    )
    expect(
      classifyMediaError(err('NotAllowedError', 'Permission denied by system'), 'display'),
    ).toBe('systemDenied')
    expect(classifyMediaError(err('NotAllowedError'), 'user')).toBe('denied')
    expect(classifyMediaError(err('NotFoundError'), 'user')).toBe('notFound')
    expect(classifyMediaError(err('NotReadableError'), 'user')).toBe('inUse')
    expect(classifyMediaError(err('TypeError'), 'display')).toBe('unsupported')
    expect(classifyMediaError('???', 'user')).toBe('generic')
  })
})
