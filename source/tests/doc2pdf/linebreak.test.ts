// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LineBreaker, PAD, type LineBox, type TextStyle } from '@/features/doc2pdf/engine/linebreak'
import { NO_LINE_END, NO_LINE_START } from '@/features/doc2pdf/engine/text'
import { layoutMono } from '@/features/doc2pdf/engine/mono'
import { fakeMeasurer } from './helpers'

const style: TextStyle = { family: 'sans', bold: false, italic: false, size: 10, color: [0, 0, 0] }
const code: TextStyle = { ...style, family: 'mono', codeBg: [0.9, 0.9, 0.9] }

function breakText(text: string, width: number, justify = false) {
  const lb = new LineBreaker(fakeMeasurer, [style, code])
  return lb.break([{ text, style: 0 }], { width, justify })
}
const lineText = (l: LineBox) => l.pieces.map((p) => p.text).join('')

describe('斷行：中日韓逐字可斷', () => {
  it('每行不超過寬度，且所有字都保留', () => {
    const text = '檔案不上傳全部在你的瀏覽器裡完成所有的排版都在本機進行'
    const { lines } = breakText(text, 100) // 每行 10 個字
    expect(lines.map(lineText).join('')).toBe(text)
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(100.01)
    expect(lineText(lines[0])).toHaveLength(10)
  })
})

describe('避頭尾', () => {
  it('句讀與收尾括號不出現在行首', () => {
    // 第 10 個字後面緊接著「，」：逗號要黏到前一個字，一起移到下一行
    const text =
      '一二三四五六七八九十，十一十二十三。（括號）「引號」『書名』《篇名》〈章〉！？；：、'
    for (const w of [60, 70, 80, 90, 100, 110, 130]) {
      const { lines } = breakText(text, w)
      for (const l of lines.slice(1)) expect(NO_LINE_START.has(lineText(l)[0])).toBe(false)
      for (const l of lines.slice(0, -1)) {
        const t = lineText(l)
        expect(NO_LINE_END.has(t[t.length - 1])).toBe(false)
      }
      expect(lines.map(lineText).join('')).toBe(text)
    }
  })

  it('剛好在寬度邊界時，句號會帶著前一個字換行', () => {
    const { lines } = breakText('一二三四五六七八九十。', 100)
    expect(lineText(lines[0])).toBe('一二三四五六七八九')
    expect(lineText(lines[1])).toBe('十。')
  })

  it('開頭括號不留在行尾', () => {
    const { lines } = breakText('一二三四五六七八九「十一」', 100)
    expect(lineText(lines[0]).endsWith('「')).toBe(false)
    expect(lineText(lines[1]).startsWith('「十')).toBe(true)
  })
})

describe('拉丁文與混排', () => {
  it('英文以單字斷行，不會切斷單字', () => {
    const { lines } = breakText('The quick brown fox jumps over the lazy dog', 60)
    const words = lines.map((l) => lineText(l).trim().split(' ')).flat()
    expect(words).toEqual('The quick brown fox jumps over the lazy dog'.split(' '))
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(60.01)
  })

  it('中英混排：英文單字完整、中英之間可斷', () => {
    const { lines } = breakText('使用PDF工具轉換Markdown文件很方便', 60)
    const all = lines.map(lineText)
    expect(all.join('')).toBe('使用PDF工具轉換Markdown文件很方便')
    expect(all.some((t) => t.includes('Markdown'))).toBe(true)
  })

  it('超過一行寬的長字（網址）逐字切開，優先在 / 之後', () => {
    const url = 'https://example.com/a/very/long/path/name/index.html'
    const { lines } = breakText(url, 60)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.map(lineText).join('')).toBe(url)
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(60.01)
    expect(lines.slice(0, -1).some((l) => lineText(l).endsWith('/'))).toBe(true)
  })

  it('硬換行保留；行首空白省略', () => {
    const { lines } = breakText('第一行\n  第二行', 200)
    expect(lines.map(lineText)).toEqual(['第一行', '第二行'])
    expect(lines[0].hard).toBe(true)
  })

  it('左右對齊：非最後一行撐滿寬度', () => {
    const text = '這是一段需要左右對齊的中文文字，用來確認每一行都會被撐滿到指定寬度。'
    const { lines } = breakText(text, 95, true)
    for (const l of lines.slice(0, -1)) expect(l.width).toBeCloseTo(95, 1)
    expect(lines[lines.length - 1].width).toBeLessThan(95)
  })

  it('行內程式碼（前後留白）不會被拆成留白與文字兩段', () => {
    const lb = new LineBreaker(fakeMeasurer, [style, code])
    const { lines } = lb.break(
      [
        { text: '一二三四五六七八', style: 0 },
        { text: `${PAD}行內程式碼${PAD}`, style: 1 },
      ],
      { width: 100 },
    )
    // 開頭的留白黏著第一個字、結尾的留白黏著最後一個字：不會有一行以孤立的留白結尾或開頭
    for (const l of lines) {
      const t = l.pieces.map((p) => p.text).join('')
      expect(t.endsWith(PAD) && t.length === 1).toBe(false)
      expect(t.endsWith(PAD) && !t.slice(0, -1).length).toBe(false)
    }
    const first = lines[0].pieces.map((p) => p.text).join('')
    expect(first.endsWith(PAD)).toBe(false)
    expect(lines.map((l) => l.pieces.map((p) => p.text).join('')).join('')).toBe(
      `一二三四五六七八${PAD}行內程式碼${PAD}`,
    )
  })

  it('沒有字型能顯示的字（表情符號）以 □ 代替並計數', () => {
    const r = breakText('笑臉😀', 200)
    expect(lineText(r.lines[0])).toBe('笑臉□')
    expect(r.missing).toBe(1)
  })
})

describe('等寬排版', () => {
  it('中文字佔兩格、英數一格，長行換行後續行縮排', () => {
    const { lines } = layoutMono(
      '    const 名稱 = "很長很長很長很長很長很長很長很長很長很長"',
      fakeMeasurer,
      {
        size: 10,
        width: 150, // 30 格（0.5 em × 10pt = 5pt 一格）
        style: 0,
      },
    )
    expect(lines.length).toBeGreaterThan(1)
    // 續行從原本的縮排（4 格）開始
    expect(lines[1].pieces[0].x).toBeCloseTo(4 * 5)
    for (const l of lines)
      for (const p of l.pieces) expect(p.x + p.width).toBeLessThanOrEqual(150.01)
  })

  it('Tab 依 tab stop 展開', () => {
    const { lines } = layoutMono('a\tb', fakeMeasurer, {
      size: 10,
      width: 500,
      style: 0,
      tabSize: 4,
    })
    expect(lines[0].pieces.map((p) => p.text).join('')).toBe('a   b')
  })
})
