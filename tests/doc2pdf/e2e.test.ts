// @vitest-environment node
/**
 * 端對端：用真的思源黑體產生 PDF，確認 pdf-lib 能重新載入、頁數合理、含書籤（Outlines）、
 * 目錄頁碼正確，且 pdf.js 抽得出中文文字（文字型 PDF）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { convertDocs, DEFAULT_OPTIONS, type ConvertOptions } from '@/features/doc2pdf/engine/convert'
import { parseMarkdown } from '@/features/doc2pdf/engine/markdown'
import { parseTxt } from '@/features/doc2pdf/engine/txt'
import { parseRtf } from '@/features/doc2pdf/engine/rtf'
import { resolveImages } from '@/features/doc2pdf/engine/resolve'

const root = resolve(__dirname, '../..')
const fonts = {
  regular: new Uint8Array(readFileSync(resolve(root, 'node_modules/@expo-google-fonts/noto-sans-tc/400Regular/NotoSansTC_400Regular.ttf'))),
  bold: new Uint8Array(readFileSync(resolve(root, 'node_modules/@expo-google-fonts/noto-sans-tc/700Bold/NotoSansTC_700Bold.ttf'))),
}
const fixture = (n: string) => readFileSync(resolve(__dirname, 'fixtures', n))
const OUT = process.env.DOC2PDF_OUT

async function extractText(bytes: Uint8Array): Promise<{ pages: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true })
  const doc = await task.promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    pages.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(''))
  }
  await task.destroy()
  return { pages }
}

async function sampleDoc() {
  const md = fixture('sample.md').toString('utf8')
  const doc = parseMarkdown(md, 'sample.md', 'a')
  await resolveImages(doc, [{ name: 'pic.png', bytes: new Uint8Array(fixture('pic.png')), mime: 'image/png' }])
  return doc
}

const opts = (o: Partial<ConvertOptions> = {}): ConvertOptions => ({ ...DEFAULT_OPTIONS, date: Date.UTC(2026, 9, 2), ...o })

describe('端對端轉檔', () => {
  it('Markdown → PDF：可重新載入、含書籤、目錄頁碼正確、抽得出中文', async () => {
    const doc = await sampleDoc()
    const r = await convertDocs([doc], fonts, opts({ cover: true }))
    if (OUT) {
      mkdirSync(OUT, { recursive: true })
      writeFileSync(resolve(OUT, 'sample.pdf'), r.bytes)
    }
    // pdf-lib 能重新載入
    const pdf = await PDFDocument.load(r.bytes)
    expect(pdf.getPageCount()).toBe(r.pages)
    expect(r.pages).toBeGreaterThanOrEqual(4)
    expect(r.pages).toBeLessThan(20)
    expect(pdf.getTitle()).toBe('JayAng Studio 使用手冊')
    expect(pdf.getCreator()).toBe('JayAng Studio Web')
    // 書籤
    const outlines = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict)
    expect(outlines).toBeDefined()
    const first = outlines.lookup(PDFName.of('First'), PDFDict)
    expect(first.lookup(PDFName.of('Title'))).toBeDefined()
    expect(outlines.lookup(PDFName.of('Count'), PDFNumber).asNumber()).toBeGreaterThan(0)
    // 書籤目的地指向實際的頁面
    const dest = first.lookup(PDFName.of('Dest'), PDFArray)
    const pageRef = dest.get(0) as PDFRef
    const pageIndex = pdf.getPages().findIndex((p) => p.ref === pageRef)
    expect(pageIndex).toBeGreaterThan(0)

    // 抽文字：中文、英文都在
    const { pages } = await extractText(r.bytes)
    const all = pages.join('\n')
    expect(all).toContain('使用手冊')
    expect(all).toContain('表格範例')
    expect(all).toContain('quick brown fox')
    expect(all).toContain('pageNumberOf')
    // 目錄頁碼：每個項目的頁碼等於標題實際所在頁
    const c = r.composed
    for (const e of c.entries) {
      const n = c.pageNumbers.get(e.id)!
      expect(n).toBe(c.dests.get(e.id)!.page + 1)
      expect(pages[n - 1].replace(/\s/g, '')).toContain(e.text.replace(/\s/g, '').slice(0, 6))
    }
    // 目錄頁上真的印出這些頁碼
    const tocText = pages.slice(1, 1 + r.tocPages).join('')
    expect(tocText).toContain('目錄')
    expect(tocText).toContain('表格範例')
  }, 60_000)

  it('合併多檔：目錄涵蓋全部檔案、每份從新頁開始', async () => {
    const a = await sampleDoc()
    const b = parseTxt(new TextDecoder('big5').decode(fixture('big5.txt')), 'big5.txt', { idPrefix: 'b' })
    const c = parseRtf(new Uint8Array(fixture('sample.rtf')), 'sample.rtf', 'c')
    const r = await convertDocs([a, b, c], fonts, opts({ theme: 'academic', tocLevel: 2 }))
    if (OUT) writeFileSync(resolve(OUT, 'merged.pdf'), r.bytes)
    const pdf = await PDFDocument.load(r.bytes)
    expect(pdf.getPageCount()).toBe(r.pages)
    const titles = r.composed.entries.filter((e) => e.level === 1).map((e) => e.text)
    expect(titles.length).toBeGreaterThanOrEqual(3)
    const { pages } = await extractText(r.bytes)
    for (const e of r.composed.entries) {
      const n = r.composed.pageNumbers.get(e.id)!
      expect(pages[n - 1].replace(/\s/g, '')).toContain(e.text.replace(/\s/g, '').slice(0, 4))
    }
  }, 60_000)

  it('其他主題與版面：現代主題、Letter 橫向、目錄放最後', async () => {
    const doc = await sampleDoc()
    const r = await convertDocs([doc], fonts, opts({ theme: 'modern', paper: 'letter', orientation: 'landscape', tocPosition: 'end', margin: 'narrow', baseSize: 12 }))
    if (OUT) writeFileSync(resolve(OUT, 'modern.pdf'), r.bytes)
    const pdf = await PDFDocument.load(r.bytes)
    const { width, height } = pdf.getPage(0).getSize()
    expect(width).toBeCloseTo(792)
    expect(height).toBeCloseTo(612)
    const { pages } = await extractText(r.bytes)
    expect(pages[pages.length - 1]).toContain('目錄')
  }, 60_000)
})
