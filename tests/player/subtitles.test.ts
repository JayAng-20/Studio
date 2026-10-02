// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  activeCues,
  cueToLines,
  decodeEntities,
  formatVttTimestamp,
  parseSubtitle,
  parseTimestamp,
  parseVtt,
  srtToVtt,
} from '@/features/player/logic/subtitles'

describe('parseTimestamp', () => {
  it.each([
    ['00:00:01,000', 1],
    ['00:01:02,345', 62.345],
    ['01:02:03.004', 3723.004],
    ['02:03.5', 123.5],
    ['0:00:01,5', 1.5],
    ['0:00:01,05', 1.05],
    ['00:00:07', 7],
    ['10:00:00,000', 36000],
  ])('%s → %d', (s, v) => expect(parseTimestamp(s)).toBeCloseTo(v, 6))
  it.each(['', 'abc', '00:61:00,000', '00:00:75,000', '1,000'])('無效：%s', (s) =>
    expect(parseTimestamp(s)).toBeNull(),
  )
})

describe('formatVttTimestamp', () => {
  it('補齊小時與毫秒', () => {
    expect(formatVttTimestamp(0)).toBe('00:00:00.000')
    expect(formatVttTimestamp(62.345)).toBe('00:01:02.345')
    expect(formatVttTimestamp(3723.004)).toBe('01:02:03.004')
    expect(formatVttTimestamp(-3)).toBe('00:00:00.000')
  })
  it('四捨五入到毫秒', () => expect(formatVttTimestamp(1.0006)).toBe('00:00:01.001'))
})

describe('srtToVtt', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:04,000',
    '第一句字幕',
    '',
    '2',
    '00:00:05,500 --> 00:00:07,250',
    '多行字幕第一行',
    '<i>第二行斜體</i>',
    '',
  ].join('\n')

  it('加上 WEBVTT 標頭、逗號改句點、移除編號', () => {
    const vtt = srtToVtt(srt)
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('00:00:01.000 --> 00:00:04.000\n第一句字幕')
    expect(vtt).toContain('00:00:05.500 --> 00:00:07.250\n多行字幕第一行\n<i>第二行斜體</i>')
    expect(vtt).not.toMatch(/^1$/m)
    expect(vtt).not.toMatch(/^2$/m)
    expect(vtt).not.toContain(',')
  })

  it('處理 CRLF 與 BOM', () => {
    const crlf = String.fromCharCode(0xfeff) + srt.replace(/\n/g, '\r\n')
    expect(srtToVtt(crlf)).toBe(srtToVtt(srt))
    expect(srtToVtt(crlf)).not.toContain('\r')
    expect(srtToVtt(crlf).charCodeAt(0)).not.toBe(0xfeff)
  })

  it('處理只有 CR 的換行', () => {
    expect(srtToVtt(srt.replace(/\n/g, '\r'))).toBe(srtToVtt(srt))
  })

  it('補齊不完整的時間格式', () => {
    const vtt = srtToVtt('1\n0:0:1,5 --> 0:0:2,25\n文字')
    expect(vtt).toContain('00:00:01.500 --> 00:00:02.250')
  })

  it('移除 <font> 與 ASS 覆寫碼、保留文字', () => {
    const vtt = srtToVtt('1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<font color="#ff0">黃色</font>')
    expect(vtt).toContain('\n黃色')
    expect(vtt).not.toContain('font')
    expect(vtt).not.toContain('{')
  })

  it('略過沒有時間行或沒有文字的區塊，以及多個空行', () => {
    const vtt = srtToVtt('垃圾\n\n\n\n1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:04,000\n有字')
    expect(parseVtt(vtt)).toEqual([{ start: 3, end: 4, text: '有字' }])
  })

  it('沒有編號也能轉換', () => {
    const vtt = srtToVtt('00:00:01,000 --> 00:00:02,000\nA')
    expect(parseVtt(vtt)).toEqual([{ start: 1, end: 2, text: 'A' }])
  })

  it('空輸入只輸出標頭', () => expect(srtToVtt('')).toBe('WEBVTT\n\n'))

  it('轉出的 VTT 可被解析回相同的 cue', () => {
    const cues = parseVtt(srtToVtt(srt))
    expect(cues).toHaveLength(2)
    expect(cues[1]).toEqual({ start: 5.5, end: 7.25, text: '多行字幕第一行\n<i>第二行斜體</i>' })
  })
})

describe('parseVtt', () => {
  it('略過 NOTE／STYLE、支援 cue id 與設定、省略小時', () => {
    const vtt = [
      'WEBVTT - 標題',
      '',
      'NOTE 這是註解',
      '',
      'STYLE',
      '::cue { color: red }',
      '',
      'intro',
      '00:01.000 --> 00:02.500 align:start line:0',
      'Hello',
      '',
      '00:00:00.000 --> 00:00:01.000',
      '先出現',
    ].join('\n')
    const cues = parseVtt(vtt)
    expect(cues.map((c) => c.text)).toEqual(['先出現', 'Hello'])
    expect(cues[1]).toMatchObject({ start: 1, end: 2.5 })
  })
  it('parseSubtitle 依副檔名或內容選擇格式', () => {
    expect(parseSubtitle('1\n00:00:01,000 --> 00:00:02,000\nA', 'a.srt')).toHaveLength(1)
    expect(parseSubtitle('WEBVTT\n\n00:01.000 --> 00:02.000\nB', 'b.txt')).toHaveLength(1)
  })
})

describe('activeCues', () => {
  const cues = parseVtt(
    'WEBVTT\n\n00:01.000 --> 00:03.000\nA\n\n00:02.000 --> 00:04.000\nB\n\n00:05.000 --> 00:06.000\nC',
  )
  it('依時間回傳顯示中的 cue（含重疊）', () => {
    expect(activeCues(cues, 0.5)).toEqual([])
    expect(activeCues(cues, 1.5).map((c) => c.text)).toEqual(['A'])
    expect(activeCues(cues, 2.5).map((c) => c.text)).toEqual(['A', 'B'])
    expect(activeCues(cues, 3).map((c) => c.text)).toEqual(['B'])
    expect(activeCues(cues, 6)).toEqual([])
  })
  it('延遲：正值讓字幕晚出現', () => {
    expect(activeCues(cues, 1.5, 1).map((c) => c.text)).toEqual([])
    expect(activeCues(cues, 5.2, 0.5).map((c) => c.text)).toEqual([])
    expect(activeCues(cues, 5.6, 0.5).map((c) => c.text)).toEqual(['C'])
    expect(activeCues(cues, 4.6, -0.5).map((c) => c.text)).toEqual(['C'])
  })
})

describe('cueToLines', () => {
  it('切出斜體／粗體片段並解碼實體', () => {
    const lines = cueToLines('a <i>b <b>c</b></i> &amp; d\n<v Bob>第二行')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual([
      { text: 'a ' },
      { text: 'b ', italic: true },
      { text: 'c', italic: true, bold: true },
      { text: ' & d' },
    ])
    expect(lines[1]).toEqual([{ text: '第二行' }])
  })
  it('不讓 HTML 進入輸出（只當文字）', () => {
    const lines = cueToLines('<script>alert(1)</script>')
    expect(lines[0].map((s) => s.text).join('')).toBe('alert(1)')
  })
  it('decodeEntities', () => expect(decodeEntities('&lt;&#65;&#x42;&nbsp;')).toBe('<AB '))
})
