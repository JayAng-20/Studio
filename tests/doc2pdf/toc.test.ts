// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildEntries,
  buildOutlineTree,
  composeDocuments,
  docAnchor,
  type ComposeOptions,
} from '@/features/doc2pdf/engine/compose'
import { FlowContext, paginate, type FlowItem } from '@/features/doc2pdf/engine/layout'
import { parseMarkdown } from '@/features/doc2pdf/engine/markdown'
import { PDF_LABELS } from '@/features/doc2pdf/engine/labels'
import { THEMES } from '@/features/doc2pdf/engine/themes'
import { pageSetup } from '@/features/doc2pdf/engine/convert'
import { fakeMeasurer } from './helpers'

const base = (o: Partial<ComposeOptions> = {}): ComposeOptions => ({
  page: pageSetup({ paper: 'a5', orientation: 'portrait', margin: 'normal' }),
  baseSize: 10,
  lineHeight: 1.6,
  theme: THEMES.clean,
  labels: PDF_LABELS.zh,
  title: '測試',
  header: true,
  footer: true,
  cover: { enabled: false, date: null, files: [] },
  toc: { enabled: true, position: 'front', maxLevel: 3, exclude: [], title: '目錄' },
  bookmarks: true,
  ...o,
})

/** 產生很多章節、讓目錄跨好幾頁的文件 */
function bigDoc(chapters = 40) {
  let s = '# 文件標題\n\n'
  for (let i = 1; i <= chapters; i++) {
    s += `## 第 ${i} 章\n\n${'內文段落。'.repeat(60)}\n\n### 第 ${i}.1 節\n\n${'更多內容。'.repeat(30)}\n\n`
  }
  return parseMarkdown(s, 'big.md', 'x')
}

describe('目錄：兩階段排版的頁碼修正', () => {
  it('目錄放最前面：目錄跨多頁時，每個項目的頁碼＝標題實際所在的實體頁', () => {
    const doc = bigDoc()
    const c = composeDocuments([doc], fakeMeasurer, base())
    expect(c.tocPages).toBeGreaterThan(1)
    expect(c.entries.length).toBe(80)
    for (const e of c.entries) {
      const n = c.pageNumbers.get(e.id)!
      expect(n).toBe(c.dests.get(e.id)!.page + 1)
      // 實體頁面種類是內文
      expect(c.pages[n - 1].kind).toBe('content')
    }
    // 第一個項目在目錄之後的第一頁
    expect(c.pageNumbers.get(c.entries[0].id)).toBe(c.tocPages + 1)
    expect(c.pages.length).toBe(c.tocPages + c.contentPages)
  })

  it('有封面時再往後推一頁', () => {
    const doc = bigDoc(10)
    const c = composeDocuments([doc], fakeMeasurer, base({ cover: { enabled: true, date: '2026 年 10 月 2 日', files: [] } }))
    expect(c.pages[0].kind).toBe('cover')
    expect(c.pageNumbers.get(c.entries[0].id)).toBe(1 + c.tocPages + 1)
    for (const e of c.entries) expect(c.pageNumbers.get(e.id)).toBe(c.dests.get(e.id)!.page + 1)
  })

  it('目錄放最後：頁碼不受目錄頁數影響', () => {
    const doc = bigDoc(10)
    const c = composeDocuments([doc], fakeMeasurer, base({ toc: { ...base().toc, position: 'end' } }))
    expect(c.pageNumbers.get(c.entries[0].id)).toBe(1)
    expect(c.pages[c.pages.length - 1].kind).toBe('toc')
    for (const e of c.entries) expect(c.pageNumbers.get(e.id)).toBe(c.dests.get(e.id)!.page + 1)
  })

  it('目錄層級與取消勾選的項目', () => {
    const doc = bigDoc(5)
    const all = composeDocuments([doc], fakeMeasurer, base())
    const lvl1 = composeDocuments([doc], fakeMeasurer, base({ toc: { ...base().toc, maxLevel: 1 } }))
    expect(lvl1.entries.every((e) => e.level === 1)).toBe(true)
    expect(lvl1.entries.length).toBe(5)
    const ex = composeDocuments([doc], fakeMeasurer, base({ toc: { ...base().toc, exclude: [all.entries[0].id] } }))
    expect(ex.entries.length).toBe(all.entries.length - 1)
  })

  it('目錄頁有可點擊的內部連結，目的地正確', () => {
    const doc = bigDoc(3)
    const c = composeDocuments([doc], fakeMeasurer, base())
    const links = c.pages
      .filter((p) => p.kind === 'toc')
      .flatMap((p) => p.ops)
      .filter((o) => o.t === 'link' && o.dest)
    expect(links.length).toBe(c.entries.length)
  })
})

describe('書籤樹', () => {
  it('依層級建立父子關係；層級跳號時接到最近的上層', () => {
    const tree = buildOutlineTree([
      { id: 'a', level: 1, text: 'A' },
      { id: 'a1', level: 2, text: 'A1' },
      { id: 'a1x', level: 3, text: 'A1x' },
      { id: 'a2', level: 2, text: 'A2' },
      { id: 'b', level: 1, text: 'B' },
      { id: 'b1', level: 3, text: 'B1（跳號）' },
      { id: 'c', level: 1, text: 'C', number: '3' },
    ])
    expect(tree.map((n) => n.dest)).toEqual(['a', 'b', 'c'])
    expect(tree[0].children.map((n) => n.dest)).toEqual(['a1', 'a2'])
    expect(tree[0].children[0].children.map((n) => n.dest)).toEqual(['a1x'])
    expect(tree[1].children.map((n) => n.dest)).toEqual(['b1'])
    expect(tree[2].title).toBe('3 C')
  })

  it('合併多檔：沒有以 H1 開頭的檔案補一個檔案項目，目錄涵蓋全部檔案', () => {
    const a = parseMarkdown('# 甲\n\n## 甲一', 'a.md', 'a')
    const b = parseMarkdown('## 乙一\n\n## 乙二', 'b.md', 'b')
    const entries = buildEntries([a, b], new Map())
    expect(entries.map((e) => [e.text, e.level])).toEqual([
      ['甲', 1],
      ['甲一', 2],
      ['b', 1],
      ['乙一', 2],
      ['乙二', 2],
    ])
    expect(entries[2].id).toBe(docAnchor(1))
    const c = composeDocuments([a, b], fakeMeasurer, base())
    // 第二份檔案從新的一頁開始
    expect(c.dests.get(docAnchor(1))!.page).toBeGreaterThan(c.dests.get(docAnchor(0))!.page)
    expect(c.outline.map((n) => n.title)).toEqual(['甲', 'b'])
  })

  it('單一文件：唯一的 H1 是文件標題，不列入目錄', () => {
    const doc = parseMarkdown('# 標題\n\n## 一\n\n### 一之一\n\n## 二', 'a.md')
    expect(buildEntries([doc], new Map()).map((e) => [e.text, e.level])).toEqual([
      ['一', 1],
      ['一之一', 2],
      ['二', 1],
    ])
  })
})

describe('分頁', () => {
  const fc = () => new FlowContext(fakeMeasurer, base())
  const item = (h: number, extra: Partial<FlowItem> = {}): FlowItem => ({ h, before: 0, ops: [], ...extra })

  it('標題不會單獨留在頁尾（與下一項不分開）', () => {
    const f = fc()
    const avail = f.contentHeight
    const items = [item(avail - 30), item(20, { keepNext: true }), item(20)]
    const pages = paginate(items, f)
    expect(pages).toHaveLength(2)
    expect(pages[1].placements[0].item).toBe(items[1])
  })

  it('孤行／寡行：段落頭兩行在一起', () => {
    const f = fc()
    const avail = f.contentHeight
    const lines = [item(15, { keepNext: true }), item(15), item(15), item(15, { keepNext: true }), item(15)]
    const pages = paginate([item(avail - 20), ...lines], f)
    // 只放得下一行：第一行跟著第二行到下一頁
    expect(pages[0].placements).toHaveLength(1)
  })

  it('表格跨頁時重複表頭', () => {
    const f = fc()
    const header = item(20, { table: { id: 1, header: true }, keepNext: true })
    const rows = Array.from({ length: 60 }, () => item(20, { table: { id: 1, header: false } }))
    const pages = paginate([header, ...rows], f)
    expect(pages.length).toBeGreaterThan(1)
    for (const p of pages.slice(1)) {
      expect(p.placements[0].item).toBe(header)
      expect(p.placements[0].index).toBe(-1)
    }
    // 所有資料列都恰好出現一次
    const placed = pages.flatMap((p) => p.placements.filter((x) => x.index > 0).map((x) => x.index))
    expect(placed).toEqual(rows.map((_, i) => i + 1))
  })

  it('強制分頁', () => {
    const f = fc()
    const pages = paginate([item(10), item(10, { breakBefore: true }), item(10)], f)
    expect(pages).toHaveLength(2)
  })
})
