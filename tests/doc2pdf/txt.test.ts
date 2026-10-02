// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTxt } from '@/features/doc2pdf/engine/txt'
import { commonHanRatio, decodeWith, detectAndDecode } from '@/features/doc2pdf/engine/encoding'
import {
  collectHeadings,
  runsText,
  type Block,
  type ListBlock,
  type TableBlock,
} from '@/features/doc2pdf/engine/model'

const txt = (s: string) => parseTxt(s, 'note.txt')
const heads = (s: string) => collectHeadings(txt(s)).map((h) => [h.text, h.level])
const text = (b: Block) => ('runs' in b ? runsText(b.runs) : '')
const LONG =
  '這是一段比較長的內文，用來讓文件看起來像真正的文章，所以標題的啟發式才會啟用，而且這段文字還要再長一點點才夠。'

describe('TXT 標題辨識', () => {
  it('Markdown 式 # 標題直接使用層級', () => {
    expect(heads('# 一\n\n內文\n\n## 二\n\n### 三')).toEqual([
      ['一', 1],
      ['二', 2],
      ['三', 3],
    ])
  })

  it('setext 底線：=== 為第一層、--- 為第二層', () => {
    expect(heads('Title\n=====\n\n' + LONG + '\n\nSection\n-------\n\n' + LONG)).toEqual([
      ['Title', 1],
      ['Section', 2],
    ])
  })

  it('中文章節：第一部／第一章／第1節依階層分配', () => {
    expect(
      heads(
        `第一部\u3000起\n\n${LONG}\n\n第一章\u3000開始\n\n${LONG}\n\n第1節 細節\n\n${LONG}\n\n第二章 繼續\n\n${LONG}`,
      ),
    ).toEqual([
      ['第一部\u3000起', 1],
      ['第一章\u3000開始', 2],
      ['第1節 細節', 3],
      ['第二章 繼續', 2],
    ])
  })

  it('「一、」與「（一）」、「1.1」「1.1.1」編號標題', () => {
    expect(heads(`一、背景\n\n${LONG}\n\n（一）說明\n\n${LONG}\n\n二、方法\n\n${LONG}`)).toEqual([
      ['一、背景', 1],
      ['（一）說明', 2],
      ['二、方法', 1],
    ])
    expect(
      heads(
        `1. Introduction\n\n${LONG}\n\n1.1 Scope\n\n${LONG}\n\n1.1.1 Detail\n\n${LONG}\n\n2. Methods\n\n${LONG}`,
      ),
    ).toEqual([
      ['1. Introduction', 1],
      ['1.1 Scope', 2],
      ['1.1.1 Detail', 3],
      ['2. Methods', 1],
    ])
  })

  it('全大寫短行與第一行的文件標題', () => {
    expect(heads(`My Report\n\n${LONG}\n\nRESULTS AND DISCUSSION\n\n${LONG}`)).toEqual([
      ['My Report', 1],
      ['RESULTS AND DISCUSSION', 2],
    ])
  })

  it('前後空行包夾、沒有句末標點的短行是標題；有句號的短句不是', () => {
    const r = heads(`${LONG}\n\n研究動機\n\n${LONG}\n\n這是一句短話。\n\n${LONG}`)
    expect(r).toEqual([['研究動機', 1]])
  })

  it('全部都是短行的文件（例如詩或清單）不把短行當標題', () => {
    expect(heads('床前明月光\n\n疑是地上霜\n\n舉頭望明月\n\n低頭思故鄉')).toEqual([])
  })
})

describe('TXT 清單、表格、程式碼、段落', () => {
  it('清單：各種符號、巢狀、任務清單、編號起始值', () => {
    const doc = txt('購物：\n- 牛奶\n  - 全脂\n• 麵包\n* [x] 雞蛋\n\n3) 第三\n4) 第四')
    const lists = doc.blocks.filter((b): b is ListBlock => b.type === 'list')
    expect(lists).toHaveLength(2)
    expect(lists[0].items).toHaveLength(3)
    expect(lists[0].items[0].blocks[1]?.type).toBe('list')
    expect(lists[0].items[2].task).toBe(true)
    expect(lists[1].ordered).toBe(true)
    expect(lists[1].start).toBe(3)
  })

  it('連續的「1. 2. 3.」是清單不是標題', () => {
    const doc = txt(`${LONG}\n\n1. 第一步\n2. 第二步\n3. 第三步`)
    expect(collectHeadings(doc)).toHaveLength(0)
    expect(doc.blocks.find((b) => b.type === 'list')).toBeDefined()
  })

  it('表格：| 分隔（含對齊列）', () => {
    const doc = txt('| 名稱 | 數量 |\n|:--|--:|\n| 蘋果 | 3 |\n| 香蕉 | 12 |')
    const t = doc.blocks[0] as TableBlock
    expect(t.type).toBe('table')
    expect(t.headerRows).toBe(1)
    expect(t.align).toEqual(['left', 'right'])
    expect(t.rows).toHaveLength(3)
  })

  it('表格：Tab 分隔，數字欄自動靠右', () => {
    const doc = txt('品項\t單價\t數量\n蘋果\t30\t2\n香蕉\t15\t6')
    const t = doc.blocks[0] as TableBlock
    expect(t.type).toBe('table')
    expect(t.rows.map((r) => r.map((c) => runsText(c.runs)))).toEqual([
      ['品項', '單價', '數量'],
      ['蘋果', '30', '2'],
      ['香蕉', '15', '6'],
    ])
    expect(t.align).toEqual([null, 'right', 'right'])
  })

  it('表格：以兩個以上空白對齊（中文字算兩格）', () => {
    const doc = txt('假別      天數    給薪\n特休假    7       全薪\n病假      30      半薪')
    const t = doc.blocks[0] as TableBlock
    expect(t.type).toBe('table')
    expect(t.rows[2].map((c) => runsText(c.runs))).toEqual(['病假', '30', '半薪'])
  })

  it('兩個空白分句的散文不會被當成表格', () => {
    const doc = txt(
      'This is a sentence.  Another sentence follows here.\nAnd one more line.  With two spaces again here.',
    )
    expect(doc.blocks.every((b) => b.type !== 'table')).toBe(true)
  })

  it('縮排 4 格且像程式碼的區塊是程式碼；小說式全文縮排不是', () => {
    const code = txt(`${LONG}\n\n    function a() {\n      return 1;\n    }\n\n${LONG}`)
    expect(code.blocks.some((b) => b.type === 'code')).toBe(true)
    const novel = txt('    第一段的文字，很長很長。\n    第二段的文字，也很長。\n    第三段。')
    expect(novel.blocks.some((b) => b.type === 'code')).toBe(false)
    expect(novel.blocks.filter((b) => b.type === 'paragraph')).toHaveLength(3)
    expect(novel.blocks[0].type === 'paragraph' && novel.blocks[0].indent).toBe(true)
  })

  it('硬換行的段落接起來（中文不加空白、英文加空白）', () => {
    const line = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十'
    const doc = txt(
      `${line}\n${line}\n最後。\n\nThe quick brown fox jumps over the lazy\ndog and runs away quickly from here.`,
    )
    expect(text(doc.blocks[0])).toBe(`${line}${line}最後。`)
    expect(text(doc.blocks[1])).toBe(
      'The quick brown fox jumps over the lazy dog and runs away quickly from here.',
    )
  })

  it('網址與電子郵件變成連結', () => {
    const doc = txt('請見 https://example.com/a 或寫信到 hi@example.com。')
    const p = doc.blocks[0]
    if (p.type !== 'paragraph') throw new Error()
    expect(p.runs.find((r) => r.link === 'https://example.com/a')).toBeDefined()
    expect(p.runs.find((r) => r.link === 'mailto:hi@example.com')).toBeDefined()
  })

  it('保持原樣：整份等寬、不辨識結構', () => {
    const doc = parseTxt('# 不是標題\n  - 不是清單', 'a.txt', { raw: true })
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0].type === 'code' && doc.blocks[0].plain).toBe(true)
  })

  it('範例檔（Big5）：標題、清單、表格', () => {
    const doc = txt(
      new TextDecoder('big5').decode(readFileSync(resolve(__dirname, 'fixtures/big5.txt'))),
    )
    const hs = collectHeadings(doc)
    expect(hs[0]).toMatchObject({ text: '員工手冊', level: 1 })
    expect(hs.map((h) => h.text)).toContain('第一章\u3000總則')
    expect(hs.map((h) => h.text)).toContain('1.1 密碼原則')
    expect(doc.blocks.some((b) => b.type === 'table')).toBe(true)
    expect(doc.blocks.some((b) => b.type === 'list')).toBe(true)
  })
})

describe('編碼偵測', () => {
  const sample = '繁體中文的文字檔，這是測試。'
  it('BOM：UTF‑8、UTF‑16LE、UTF‑16BE', () => {
    const u8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(sample)])
    expect(detectAndDecode(u8)).toMatchObject({ encoding: 'utf-8', text: sample, bom: true })
    const le = new Uint8Array(2 + sample.length * 2)
    le[0] = 0xff
    le[1] = 0xfe
    const be = new Uint8Array(2 + sample.length * 2)
    be[0] = 0xfe
    be[1] = 0xff
    for (let i = 0; i < sample.length; i++) {
      const c = sample.charCodeAt(i)
      le[2 + i * 2] = c & 255
      le[3 + i * 2] = c >> 8
      be[2 + i * 2] = c >> 8
      be[3 + i * 2] = c & 255
    }
    expect(detectAndDecode(le)).toMatchObject({ encoding: 'utf-16le', text: sample })
    expect(detectAndDecode(be)).toMatchObject({ encoding: 'utf-16be', text: sample })
  })

  it('沒有 BOM 的 UTF‑8', () => {
    expect(detectAndDecode(new TextEncoder().encode(sample))).toMatchObject({
      encoding: 'utf-8',
      text: sample,
    })
  })

  it('Big5 檔案（UTF‑8 解碼失敗 → Big5）', () => {
    const bytes = new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/big5.txt')))
    const r = detectAndDecode(bytes)
    expect(r.encoding).toBe('big5')
    expect(r.text).toContain('員工手冊')
  })

  it('GB18030 檔案：Big5 雖能解但常用字比例低，改用 GB18030', () => {
    // 「简体中文的文件，这是测试。我们的数据」以 GBK 編碼
    const gbk = [
      0xbc, 0xf2, 0xcc, 0xe5, 0xd6, 0xd0, 0xce, 0xc4, 0xb5, 0xc4, 0xce, 0xc4, 0xbc, 0xfe, 0xa3,
      0xac, 0xd5, 0xe2, 0xca, 0xc7, 0xb2, 0xe2, 0xca, 0xd4, 0xa1, 0xa3, 0xce, 0xd2, 0xc3, 0xc7,
      0xb5, 0xc4, 0xca, 0xfd, 0xbe, 0xdd,
    ]
    const bytes = new Uint8Array(gbk)
    const r = detectAndDecode(bytes)
    expect(r.encoding).toBe('gb18030')
    expect(r.text).toBe('简体中文的文件，这是测试。我们的数据')
  })

  it('手動切換編碼', () => {
    const bytes = new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/big5.txt')))
    const wrong = decodeWith(bytes, 'utf-8')
    expect(wrong.lossy).toBe(true)
    expect(decodeWith(bytes, 'big5').text).toContain('員工手冊')
  })

  it('常用字比例', () => {
    expect(commonHanRatio('我們的國家')).toBeGreaterThan(0.5)
    expect(commonHanRatio('abc')).toBe(1)
  })
})
