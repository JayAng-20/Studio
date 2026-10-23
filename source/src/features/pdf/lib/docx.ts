/**
 * PDF 轉 Word（.docx）：從 pdf.js 的文字內容重建段落。
 * 1. 依基線把文字片段組成行（同一行內依 x 排序，間距大時補空白）；
 * 2. 行距明顯變大、字級改變或縮排改變時斷成新段落；
 * 3. 字級明顯大於內文中位數的段落當成標題（標題 1／2）；
 * 4. 以 fflate 打包成最小但完整的 OOXML（Word、Pages、Google 文件、LibreOffice 都能開）。
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface Para {
  text: string
  size: number
  heading: 0 | 1 | 2
  /** 這段之前要換頁 */
  pageBreak?: boolean
}

interface Item {
  str: string
  x: number
  y: number
  w: number
  size: number
}

interface Line {
  y: number
  x: number
  size: number
  text: string
}

const CJK = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/

function joinItems(items: Item[]): string {
  let out = ''
  let prevEnd = -Infinity
  for (const it of items) {
    const gap = it.x - prevEnd
    const last = out.slice(-1)
    if (out && gap > it.size * 0.25 && last !== ' ' && !(CJK.test(last) && CJK.test(it.str[0] ?? '')))
      out += ' '
    out += it.str
    prevEnd = it.x + it.w
  }
  return out
}

/** 一頁的文字 → 行 */
export function linesFromItems(items: Item[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Array<{ y: number; size: number; items: Item[] }> = []
  for (const it of sorted) {
    const l = lines.find((x) => Math.abs(x.y - it.y) < Math.max(2, Math.min(x.size, it.size) * 0.5))
    if (l) {
      l.items.push(it)
      l.size = Math.max(l.size, it.size)
    } else lines.push({ y: it.y, size: it.size, items: [it] })
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const its = l.items.sort((a, b) => a.x - b.x)
      return { y: l.y, x: its[0].x, size: l.size, text: joinItems(its).trim() }
    })
    .filter((l) => l.text)
}

/** 行 → 段落 */
export function parasFromLines(lines: Line[], body: number): Para[] {
  const paras: Para[] = []
  let cur: { lines: Line[] } | null = null
  const flush = () => {
    if (!cur) return
    const size = Math.max(...cur.lines.map((l) => l.size))
    let text = ''
    for (const l of cur.lines) {
      const last = text.slice(-1)
      if (!text) text = l.text
      else if (last === '-' && /[a-z]$/i.test(text.slice(-2, -1))) text = text.slice(0, -1) + l.text
      else if (CJK.test(last) || CJK.test(l.text[0])) text += l.text
      else text += ' ' + l.text
    }
    const ratio = size / body
    paras.push({ text, size, heading: ratio >= 1.6 ? 1 : ratio >= 1.25 && text.length < 120 ? 2 : 0 })
    cur = null
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const prev = lines[i - 1]
    if (cur && prev) {
      const gap = prev.y - l.y
      const sizeChange = Math.abs(l.size - prev.size) > Math.max(1, prev.size * 0.15)
      const bigGap = gap > Math.max(prev.size, l.size) * 1.75
      const indent = l.x - prev.x > l.size * 1.2
      const bullet = /^([•●▪◦\-–*]|\d+[.)、]|[一二三四五六七八九十]+、)\s*/.test(l.text)
      if (sizeChange || bigGap || indent || bullet) flush()
    }
    cur ??= { lines: [] }
    cur.lines.push(l)
  }
  flush()
  return paras
}

export async function pdfToParas(
  doc: PDFDocumentProxy,
  pages: number[],
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<Para[]> {
  const perPage: Line[][] = []
  const sizes: number[] = []
  for (let k = 0; k < pages.length; k++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const page = await doc.getPage(pages[k] + 1)
    const tc = await page.getTextContent()
    const items: Item[] = []
    for (const raw of tc.items) {
      const it = raw as { str?: string; transform?: number[]; width?: number; height?: number }
      if (!it.str || !it.transform || !it.str.trim()) continue
      const size = it.height || Math.hypot(it.transform[2], it.transform[3]) || 10
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, size })
      for (let i = 0; i < it.str.length; i++) sizes.push(size)
    }
    page.cleanup()
    perPage.push(linesFromItems(items))
    onProgress?.((k + 1) / pages.length)
  }
  sizes.sort((a, b) => a - b)
  const body = sizes[Math.floor(sizes.length / 2)] || 11
  const out: Para[] = []
  perPage.forEach((lines, i) => {
    const ps = parasFromLines(lines, body)
    if (i > 0 && ps.length) ps[0].pageBreak = true
    out.push(...ps)
  })
  return out
}

const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

export function buildDocumentXml(paras: Para[], keepBreaks: boolean): string {
  const body = paras
    .map((p) => {
      const style = p.heading ? `<w:pStyle w:val="Heading${p.heading}"/>` : ''
      const br = keepBreaks && p.pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : ''
      return `<w:p><w:pPr>${style}</w:pPr>${br}<w:r><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft JhengHei" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-TW"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`

export async function buildDocx(paras: Para[], opts: { keepBreaks: boolean; title?: string }): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate')
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const files = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'word/document.xml': strToU8(buildDocumentXml(paras, opts.keepBreaks)),
    'word/styles.xml': strToU8(STYLES),
    'docProps/core.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opts.title ?? '')}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,
    ),
  }
  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped as Uint8Array<ArrayBuffer>], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}
