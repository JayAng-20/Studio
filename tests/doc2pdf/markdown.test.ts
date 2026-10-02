// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '@/features/doc2pdf/engine/markdown'
import { collectHeadings, runsText, type Block, type ListBlock, type ParagraphBlock, type TableBlock } from '@/features/doc2pdf/engine/model'

const md = (s: string) => parseMarkdown(s, 'test.md')
const types = (bs: Block[]) => bs.map((b) => b.type)

describe('Markdown → 文件模型', () => {
  it('標題 H1–H6、id 與 slug、文件標題取第一個 H1', () => {
    const doc = md('# 主標題\n\n## 第二節 Intro\n\n### 3\n\n#### 4\n\n##### 5\n\n###### 6\n\n## 第二節 Intro')
    const hs = collectHeadings(doc)
    expect(hs.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6, 2])
    expect(doc.title).toBe('主標題')
    const blocks = doc.blocks.filter((b) => b.type === 'heading')
    expect(blocks[1].type === 'heading' && blocks[1].slug).toBe('第二節-intro')
    expect(blocks[6].type === 'heading' && blocks[6].slug).toBe('第二節-intro-1')
    expect(new Set(hs.map((h) => h.id)).size).toBe(hs.length)
  })

  it('沒有 H1 時標題用檔名', () => {
    expect(md('## 只有二級').title).toBe('test')
  })

  it('行內樣式：粗體、斜體、刪除線、行內程式碼、連結、HTML 標籤', () => {
    const doc = md('**粗** *斜* ~~刪~~ `code` [連結](https://a.com) <u>底線</u> <b>B</b>&amp;')
    const p = doc.blocks[0]
    expect(p.type).toBe('paragraph')
    if (p.type !== 'paragraph') return
    const find = (t: string) => p.runs.find((r) => r.text === t)!
    expect(find('粗').b).toBe(true)
    expect(find('斜').i).toBe(true)
    expect(find('刪').s).toBe(true)
    expect(find('code').code).toBe(true)
    expect(find('連結').link).toBe('https://a.com')
    expect(find('底線').u).toBe(true)
    expect(find('B').b).toBe(true)
    expect(runsText(p.runs)).toContain('&')
    expect(runsText(p.runs)).not.toContain('<')
  })

  it('軟換行：中文之間接起來、英文之間變空白；硬換行保留', () => {
    const doc = md('第一行\n第二行\nEnglish\nwords  \n硬換行後')
    const p = doc.blocks[0]
    if (p.type !== 'paragraph') throw new Error()
    expect(runsText(p.runs)).toBe('第一行第二行 English words\n硬換行後')
  })

  it('表格：欄位對齊、表頭、行內樣式', () => {
    const doc = md('| 左 | 中 | 右 | 無 |\n|:---|:---:|---:|---|\n| a | **b** | 1 | x |\n| c | d | 2 |')
    const t = doc.blocks[0] as TableBlock
    expect(t.type).toBe('table')
    expect(t.align).toEqual(['left', 'center', 'right', null])
    expect(t.headerRows).toBe(1)
    expect(t.rows).toHaveLength(3)
    expect(t.rows[1][1].runs[0].b).toBe(true)
    // 欄數不足的列補齊
    expect(t.rows[2]).toHaveLength(4)
  })

  it('巢狀清單與有序清單起始編號', () => {
    const doc = md('3. 三\n4. 四\n   - 子項\n     - 孫項\n5. 五')
    const l = doc.blocks[0] as ListBlock
    expect(l.ordered).toBe(true)
    expect(l.start).toBe(3)
    expect(l.items).toHaveLength(3)
    const sub = l.items[1].blocks.find((b) => b.type === 'list') as ListBlock
    expect(sub.ordered).toBe(false)
    const subsub = sub.items[0].blocks.find((b) => b.type === 'list') as ListBlock
    expect(runsText((subsub.items[0].blocks[0] as ParagraphBlock).runs)).toBe('孫項')
  })

  it('任務清單 [ ] [x]', () => {
    const doc = md('- [ ] 未完成\n- [x] 已完成\n- 一般')
    const l = doc.blocks[0] as ListBlock
    expect(l.items.map((i) => i.task)).toEqual([false, true, null])
    expect(runsText((l.items[0].blocks[0] as ParagraphBlock).runs)).toBe('未完成')
  })

  it('程式碼、引用、水平線、HTML 區塊去標籤、分頁符號', () => {
    const doc = md('```js\nconst a = 1\n```\n\n> 引用\n\n---\n\n<div>區塊 <b>HTML</b></div>\n\n<!-- pagebreak -->\n\n後')
    expect(types(doc.blocks)).toEqual(['code', 'quote', 'hr', 'paragraph', 'pageBreak', 'paragraph'])
    const c = doc.blocks[0]
    expect(c.type === 'code' && c.lang).toBe('js')
    expect(c.type === 'code' && c.text).toBe('const a = 1')
    const h = doc.blocks[3]
    expect(h.type === 'paragraph' && runsText(h.runs)).toBe('區塊 HTML')
  })

  it('段落中的圖片獨立成區塊（保留前後文字順序）', () => {
    const doc = md('前文 ![替代](a.png "標題") 後文')
    expect(types(doc.blocks)).toEqual(['paragraph', 'image', 'paragraph'])
    const img = doc.blocks[1]
    expect(img.type === 'image' && img.src).toBe('a.png')
    expect(img.type === 'image' && img.alt).toBe('替代')
    expect(img.type === 'image' && img.title).toBe('標題')
  })
})
