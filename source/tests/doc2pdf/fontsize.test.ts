// @vitest-environment node
/**
 * 字級上限提高到 20 pt：確認設定值真的用在排版上，而且大字級時內容仍完整輸出。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  convertDocs,
  DEFAULT_OPTIONS,
  type ConvertOptions,
} from '@/features/doc2pdf/engine/convert'
import { parseMarkdown } from '@/features/doc2pdf/engine/markdown'
import { resolveImages } from '@/features/doc2pdf/engine/resolve'

const root = resolve(__dirname, '../..')
const fonts = {
  regular: new Uint8Array(
    readFileSync(
      resolve(
        root,
        'node_modules/@expo-google-fonts/noto-sans-tc/400Regular/NotoSansTC_400Regular.ttf',
      ),
    ),
  ),
  bold: new Uint8Array(
    readFileSync(
      resolve(root, 'node_modules/@expo-google-fonts/noto-sans-tc/700Bold/NotoSansTC_700Bold.ttf'),
    ),
  ),
}
const fixture = (n: string) => readFileSync(resolve(__dirname, 'fixtures', n))

const opts = (o: Partial<ConvertOptions>): ConvertOptions => ({
  ...DEFAULT_OPTIONS,
  date: Date.UTC(2026, 9, 2),
  ...o,
})

/** 每個含中文的文字項目之字級（pdf.js 的 transform[3] 即為字級） */
async function cjkFontSizes(bytes: Uint8Array): Promise<number[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
  })
  const doc = await task.promise
  const sizes: number[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    for (const it of tc.items) {
      if (!('str' in it) || !/[一-鿿]/.test(it.str)) continue
      sizes.push(Math.round(Math.abs(it.transform[3]) * 100) / 100)
    }
  }
  await task.destroy()
  return sizes
}

describe('文字轉 PDF 字級上限 20 pt', () => {
  it('設為 20 pt 時，正文以 20 pt 排版', async () => {
    const doc = parseMarkdown(
      '# 標題\n\n這是一段正文，用來確認字級是否真的變成二十點。\n',
      'size.md',
      'a',
    )
    await resolveImages(doc, [])
    const r = await convertDocs(
      [doc],
      fonts,
      opts({ baseSize: 20, toc: false, header: false, footer: false, bookmarks: false }),
    )
    const sizes = await cjkFontSizes(r.bytes)
    expect(sizes).toContain(20)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(20)
  }, 60_000)

  it('20 pt 的完整範例仍能輸出，且內容都在', async () => {
    const md = fixture('sample.md').toString('utf8')
    const doc = parseMarkdown(md, 'sample.md', 'a')
    await resolveImages(doc, [
      { name: 'pic.png', bytes: new Uint8Array(fixture('pic.png')), mime: 'image/png' },
    ])
    const r = await convertDocs([doc], fonts, opts({ baseSize: 20 }))
    expect(r.pages).toBeGreaterThanOrEqual(4)
    const sizes = await cjkFontSizes(r.bytes)
    expect(sizes).toContain(20)
  }, 60_000)
})
