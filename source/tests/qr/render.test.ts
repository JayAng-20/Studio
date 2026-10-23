// @vitest-environment node
import { describe, expect, it } from 'vitest'
import jsQR from 'jsqr'
import { createMatrix, QrTooLongError, isFinder, type QrMatrix } from '@/features/qr/lib/matrix'
import { buildGeometry, roundedRect } from '@/features/qr/lib/geometry'
import { buildSvgTree, serializeSvg } from '@/features/qr/lib/svg'
import { defaultStyle, sanitizeStyle } from '@/features/qr/lib/style'
import { checkContrast, contrastRatio } from '@/features/qr/lib/color'
import { batchFileStem, parseCsv, parseCsvEntries, parseLines } from '@/features/qr/lib/batch'
import { buildWifi, buildVCard, defaultValues } from '@/features/qr/lib/content'
import { parseScan } from '@/features/qr/lib/parse'

/** 把矩陣畫成 RGBA 點陣（每模組 4 px、4 模組邊距），給 jsQR 驗證來回 */
function rasterize(m: QrMatrix, px = 4, quiet = 4) {
  const side = (m.n + quiet * 2) * px
  const data = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let r = 0; r < m.n; r++)
    for (let c = 0; c < m.n; c++) {
      if (!m.data[r * m.n + c]) continue
      for (let y = 0; y < px; y++)
        for (let x = 0; x < px; x++) {
          const i = (((r + quiet) * px + y) * side + (c + quiet) * px + x) * 4
          data[i] = data[i + 1] = data[i + 2] = 0
        }
    }
  return { data, side }
}

describe('矩陣與來回解碼', () => {
  it.each([
    ['網址', 'https://example.com/path?q=1'],
    ['中文', '檔案不上傳，全部在你的瀏覽器裡完成。'],
    ['Wi‑Fi', buildWifi({ ssid: '咖啡;店', password: 'a:b', security: 'WPA', hidden: false })],
    [
      'vCard',
      buildVCard({
        ...defaultValues().vcard,
        firstName: '小明',
        lastName: '王',
        mobile: '0912345678',
      }),
    ],
  ])('%s', async (_n, text) => {
    const m = await createMatrix(text, 'M')
    const { data, side } = rasterize(m)
    const decoded = jsQR(data, side, side)
    expect(decoded?.data).toBe(text)
  })
  it('錯誤修正等級越高，版本不會變小', async () => {
    const t = 'https://example.com/some/long/path/for/testing'
    const l = await createMatrix(t, 'L')
    const h = await createMatrix(t, 'H')
    expect(h.version).toBeGreaterThanOrEqual(l.version)
  })
  it('超過容量時丟出 QrTooLongError', async () => {
    await expect(createMatrix('x'.repeat(3000), 'H')).rejects.toBeInstanceOf(QrTooLongError)
  })
  it('定位點範圍', () => {
    expect(isFinder(21, 0, 0)).toBe(true)
    expect(isFinder(21, 6, 20)).toBe(true)
    expect(isFinder(21, 20, 6)).toBe(true)
    expect(isFinder(21, 20, 20)).toBe(false)
    expect(isFinder(21, 7, 7)).toBe(false)
  })
})

describe('幾何與 SVG', () => {
  it('方形模組合併成單一路徑；定位點分開', async () => {
    const m = await createMatrix('hello', 'M')
    const geo = buildGeometry(m, defaultStyle())
    expect(geo.total).toBe(m.n + 8)
    expect(geo.modules.startsWith('M')).toBe(true)
    expect(geo.eyes).toHaveLength(3)
    // 定位點以外的深色模組數 = dots 數
    let count = 0
    for (let r = 0; r < m.n; r++)
      for (let c = 0; c < m.n; c++) if (m.data[r * m.n + c] && !isFinder(m.n, r, c)) count++
    expect(geo.dots).toHaveLength(count)
    expect(Math.max(...geo.dots.map((d) => d.dist))).toBeLessThanOrEqual(1)
  })
  it('Logo 會挖掉中央模組', async () => {
    const m = await createMatrix('https://example.com', 'H')
    const style = defaultStyle()
    const without = buildGeometry(m, style).dots.length
    const withLogo = buildGeometry(m, {
      ...style,
      logo: { src: 'data:image/png;base64,AA', width: 100, height: 50, scale: 0.25, plate: true },
    })
    expect(withLogo.dots.length).toBeLessThan(without)
    expect(withLogo.logo!.w / withLogo.logo!.h).toBeCloseTo(2)
  })
  it('SVG：漸層、透明背景、xlink 相容、屬性跳脫', async () => {
    const m = await createMatrix('svg', 'M')
    const style = {
      ...defaultStyle(),
      fg: { type: 'linear' as const, color: '#112233', color2: '#445566', angle: 90 },
      bgTransparent: true,
      logo: { src: 'data:image/png;base64,"x"', width: 10, height: 10, scale: 0.2, plate: false },
    }
    const svg = serializeSvg(buildSvgTree(buildGeometry(m, style), style, { idPrefix: 't' }))
    expect(svg.startsWith('<?xml')).toBe(true)
    expect(svg).toContain('<linearGradient id="t-fg"')
    expect(svg).toContain('fill="url(#t-fg)"')
    expect(svg).not.toContain('<rect width=')
    expect(svg).toContain('xlink:href="data:image/png;base64,&quot;x&quot;"')
    expect(svg).toContain('width="1024"')
  })
  it('圓角矩形路徑', () => {
    expect(roundedRect(0, 0, 1, 1, [0, 0, 0, 0])).toBe('M0 0H1V1H0V0Z')
    expect(roundedRect(0, 0, 2, 2, [1, 0, 0, 0])).toContain('A1 1 0 0 1 1 0')
  })
})

describe('樣式與對比', () => {
  it('對比：黑白 21:1、淺色 low、反轉 inverted', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0)
    expect(checkContrast(['#0F172A'], '#FFFFFF').issue).toBeNull()
    expect(checkContrast(['#CCCCCC'], '#FFFFFF').issue).toBe('low')
    expect(checkContrast(['#FFFFFF'], '#111111').issue).toBe('inverted')
    expect(checkContrast(['#000000', '#EEEEEE'], '#FFFFFF').issue).toBe('low')
  })
  it('sanitizeStyle：缺欄位補預設、超出範圍夾住、有 Logo 強制 H', () => {
    expect(sanitizeStyle(null)).toEqual(defaultStyle())
    const s = sanitizeStyle({
      size: 99999,
      margin: -3,
      ecc: 'L',
      shape: 'star',
      fg: { color: 'red' },
      logo: { src: 'data:image/png;base64,AA', width: 10, height: 10, scale: 0.9 },
    })
    expect(s.size).toBe(2048)
    expect(s.margin).toBe(0)
    expect(s.shape).toBe('square')
    expect(s.fg.color).toBe(defaultStyle().fg.color)
    expect(s.ecc).toBe('H')
    expect(s.logo?.scale).toBe(0.3)
    // 非 data: 的 Logo 來源一律丟棄
    expect(sanitizeStyle({ logo: { src: 'https://evil/x.png' } }).logo).toBeNull()
  })
})

describe('批次', () => {
  it('多行文字略過空行', () => {
    expect(parseLines('a\n\n  b  \r\nc')).toEqual([
      { content: 'a', name: '' },
      { content: 'b', name: '' },
      { content: 'c', name: '' },
    ])
  })
  it('CSV：引號、逗號、換行、"" 跳脫、BOM', () => {
    expect(parseCsv('﻿"a,b",c\n"line1\nline2","say ""hi"""\n')).toEqual([
      ['a,b', 'c'],
      ['line1\nline2', 'say "hi"'],
    ])
  })
  it('CSV：自動判斷分號與 tab', () => {
    expect(parseCsv('a;b\nc;d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseCsv('a\tb')).toEqual([['a', 'b']])
  })
  it('CSV：自動略過標題列、第二欄為檔名', () => {
    expect(parseCsvEntries('url,name\nhttps://a.com,首頁\nhttps://b.com,')).toEqual([
      { content: 'https://a.com', name: '首頁' },
      { content: 'https://b.com', name: '' },
    ])
  })
  it('自動檔名', () => {
    expect(batchFileStem({ content: 'https://a.com/x?y=1', name: '' }, 0, 5)).toBe(
      'qr_001_a-com-x-y-1',
    )
    expect(batchFileStem({ content: 'x', name: '自訂' }, 3, 5)).toBe('自訂')
    expect(batchFileStem({ content: '///', name: '' }, 9, 1200)).toBe('qr_0010')
  })
  it('解析回來的類型正確（整合）', () => {
    expect(
      parseScan(buildWifi({ ssid: 'A', password: 'B', security: 'WPA', hidden: false })).kind,
    ).toBe('wifi')
  })
})
