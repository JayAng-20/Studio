// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRtf } from '@/features/doc2pdf/engine/rtf'
import {
  collectHeadings,
  runsText,
  type Block,
  type ListBlock,
  type TableBlock,
} from '@/features/doc2pdf/engine/model'

/** 把字串用 big5 編成 \'hh */
function big5(s: string): string {
  const table: Record<string, number[]> = {}
  // 用 TextDecoder 反查：掃過 big5 常用區
  const dec = new TextDecoder('big5')
  if (!Object.keys(cache).length) {
    for (let a = 0xa1; a <= 0xf9; a++)
      for (const b of [...range(0x40, 0x7e), ...range(0xa1, 0xfe)]) {
        const ch = dec.decode(new Uint8Array([a, b]))
        if (ch.length === 1 && !cache[ch]) cache[ch] = [a, b]
      }
  }
  Object.assign(table, cache)
  return Array.from(s)
    .map((ch) =>
      ch.charCodeAt(0) < 128 ? ch : table[ch].map((b) => `\\'${b.toString(16)}`).join(''),
    )
    .join('')
}
const cache: Record<string, number[]> = {}
function range(a: number, b: number) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i)
}

const text = (b: Block) => ('runs' in b ? runsText(b.runs) : '')

describe('RTF 解析', () => {
  it("\\'hh 依 \\ansicpg950 以 Big5 解碼（含多位元組）", () => {
    const doc = parseRtf(`{\\rtf1\\ansi\\ansicpg950 ${big5('繁體中文測試')}\\par}`, 'a.rtf')
    expect(text(doc.blocks[0])).toBe('繁體中文測試')
  })

  it('尾位元組沒有跳脫（直接寫 ASCII）也能解碼', () => {
    // 「乙」= A4 41：尾位元組是 ASCII 的 A
    const doc = parseRtf(`{\\rtf1\\ansi\\ansicpg950 \\'a4A\\par}`, 'a.rtf')
    expect(text(doc.blocks[0])).toBe('乙')
  })

  it('字型的 \\fcharset 優先於 \\ansicpg', () => {
    const doc = parseRtf(
      `{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0\\fswiss Arial;}{\\f1\\fnil\\fcharset136 PMingLiU;}}\\f0 caf\\'e9 \\f1 ${big5('中文')}\\par}`,
      'a.rtf',
    )
    expect(text(doc.blocks[0])).toBe('café 中文')
  })

  it('\\uN Unicode 與 \\ucN 略過替代字元、負數與代理對', () => {
    const doc = parseRtf(
      "{\\rtf1\\ansi\\uc1 \\u26085?\\u26412?{\\uc2 \\u35486\\'3f\\'3f}\\uc0 \\u-10179\\u-8704 end\\par}",
      'a.rtf',
    )
    // 控制字後的空白是分隔符號，不是文字
    expect(text(doc.blocks[0])).toBe('日本語😀end')
  })

  it('略過 fonttbl、colortbl、stylesheet、info 與 \\* 目的地', () => {
    const doc = parseRtf(
      '{\\rtf1{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red1\\green2\\blue3;}{\\stylesheet{\\s0 Normal;}}{\\info{\\title X}}{\\*\\generator Writer;}{\\*\\unknown junk}Hello\\par}',
      'a.rtf',
    )
    expect(doc.blocks).toHaveLength(1)
    expect(text(doc.blocks[0])).toBe('Hello')
  })

  it('粗體、斜體、底線、刪除線、\\line、\\tab、對齊', () => {
    const doc = parseRtf(
      '{\\rtf1\\pard\\qc {\\b B}\\i I\\i0 \\ul U\\ulnone \\strike S\\strike0\\line x\\tab y\\par}',
      'a.rtf',
    )
    const p = doc.blocks[0]
    expect(p.type).toBe('paragraph')
    if (p.type !== 'paragraph') return
    expect(p.align).toBe('center')
    expect(p.runs.find((r) => r.text === 'B')?.b).toBe(true)
    expect(p.runs.find((r) => r.text.startsWith('I'))?.i).toBe(true)
    expect(p.runs.find((r) => r.text.startsWith('U'))?.u).toBe(true)
    expect(p.runs.find((r) => r.text.startsWith('S'))?.s).toBe(true)
    expect(runsText(p.runs)).toContain('\nx')
  })

  it('表格：\\trowd \\cellx \\cell \\row，表頭（\\trhdr）與儲存格對齊', () => {
    const doc = parseRtf(
      '{\\rtf1\\trowd\\trhdr\\cellx1000\\cellx2000\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\trowd\\cellx1000\\cellx2000\\pard\\intbl 1\\cell\\pard\\intbl\\qr 2\\cell\\row\\pard after\\par}',
      'a.rtf',
    )
    const t = doc.blocks[0] as TableBlock
    expect(t.type).toBe('table')
    expect(t.headerRows).toBe(1)
    expect(t.rows.map((r) => r.map((c) => runsText(c.runs)))).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ])
    expect(t.rows[1][1].align).toBe('right')
    expect(text(doc.blocks[1])).toBe('after')
  })

  it('標題：\\outlinelevel、樣式名稱 heading N、較大字級＋粗體的短段落', () => {
    const doc = parseRtf(
      '{\\rtf1{\\stylesheet{\\s0 Normal;}{\\s2 heading 2;}}' +
        '\\pard\\outlinelevel0 Outline One\\par' +
        '\\pard\\s2 Styled Two\\par' +
        '\\pard\\b\\fs36 Big Bold\\b0\\fs24\\par' +
        '\\pard Normal body text that is long enough to be a paragraph, not a heading at all.\\par' +
        '\\pard Another long paragraph of body text so the bold-only rule has enough context.\\par' +
        '\\pard\\b Short bold\\b0\\par' +
        '\\pard More body text here to keep the bold ratio low in this document.\\par}',
      'a.rtf',
    )
    const hs = collectHeadings(doc)
    expect(hs.map((h) => [h.text, h.level])).toEqual([
      ['Outline One', 1],
      ['Styled Two', 2],
      ['Big Bold', 1],
      ['Short bold', 3],
    ])
  })

  it('清單：\\ls＋\\listtext，符號與編號', () => {
    const doc = parseRtf(
      "{\\rtf1{\\listtext\\'95\\tab}\\pard\\ls1 one\\par{\\listtext\\'95\\tab}\\pard\\ls1\\ilvl1 nested\\par{\\listtext 1.\\tab}\\pard\\ls2 first\\par{\\listtext 2.\\tab}\\pard\\ls2 second\\par}",
      'a.rtf',
    )
    const l = doc.blocks[0] as ListBlock
    expect(l.type).toBe('list')
    expect(l.ordered).toBe(false)
    expect(l.items[0].blocks[1]?.type).toBe('list')
    const l2 = doc.blocks[0] as ListBlock
    expect(l2.items.length).toBeGreaterThanOrEqual(1)
  })

  it('超連結欄位與 PNG 圖片', () => {
    const png =
      '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
      '1f15c4890000000d49444154789c6360000000000200015e5a3b0b0000000049454e44ae426082'
    const doc = parseRtf(
      `{\\rtf1 See {\\field{\\*\\fldinst{HYPERLINK "https://example.com"}}{\\fldrslt{\\ul site}}} now.\\par{\\pict\\pngblip\\picwgoal1440\\pichgoal1440 ${png}}\\par}`,
      'a.rtf',
    )
    const p = doc.blocks[0]
    if (p.type !== 'paragraph') throw new Error()
    expect(p.runs.find((r) => r.text === 'site')?.link).toBe('https://example.com')
    const img = doc.blocks.find((b) => b.type === 'image')
    expect(img?.type === 'image' && img.data?.format).toBe('png')
    expect(img?.type === 'image' && img.widthHint).toBe(72)
  })

  it('範例檔：Big5 中文、表格、標題、清單、連結都正確', () => {
    const doc = parseRtf(
      new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.rtf'))),
      'sample.rtf',
    )
    expect(doc.title).toBe('季度報告')
    const hs = collectHeadings(doc).map((h) => h.text)
    expect(hs).toEqual(['季度報告', '一、營收概況', '二、各區域表現', '三、後續計畫'])
    const t = doc.blocks.find((b) => b.type === 'table') as TableBlock
    expect(runsText(t.rows[0][1].runs)).toBe('營收（萬元）')
    expect(t.headerRows).toBe(1)
    const all = doc.blocks.map(text).join('\n')
    expect(all).toContain('日本語テキスト')
    expect(all).toContain('€euro')
    expect(all).not.toContain('Ignored Title')
    expect(all).not.toContain('Test RTF Writer')
    const list = doc.blocks.find((b) => b.type === 'list') as ListBlock
    expect(list.items).toHaveLength(2)
    expect(list.ordered).toBe(false)
  })

  it('不是 RTF 時丟出錯誤', () => {
    expect(() => parseRtf('hello', 'a.rtf')).toThrow()
  })
})
