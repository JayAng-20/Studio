// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { encryptPdf, permissionBits, ALL_PERMISSIONS } from '@/features/pdf/lib/encrypt'
import {
  bookletOrder,
  cropPages,
  layoutPages,
  nupOrder,
  optimizePdf,
  resizePages,
  sanitizePdf,
  writeAttachments,
  writeBookmarks,
} from '@/features/pdf/lib/acrobat'

async function sample(pages = 5) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.setTitle('Secret title')
  doc.setAuthor('Someone')
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([400, 600])
    p.drawText(`Page ${i + 1} hello world`, { x: 40, y: 500, size: 20, font })
  }
  doc.getPage(1).setRotation({ type: 'degrees' as never, angle: 90 } as never)
  return doc.save()
}
const out = (name: string, b: Uint8Array) => {
  if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/${name}`, b)
}

describe('acrobat 功能', () => {
  it('權限旗標符合規範（全部允許＝-4 以外的保留位元皆為 1）', () => {
    expect(permissionBits(ALL_PERMISSIONS)).toBe(-4)
    const none = permissionBits({
      print: false,
      printHigh: false,
      modify: false,
      copy: false,
      annotate: false,
      fillForms: false,
      assemble: false,
      accessibility: false,
    })
    expect(none).toBe(-3904)
  })

  it('AES-256 加密後有 /Encrypt，且原文不再以明文出現', async () => {
    const enc = await encryptPdf(await sample(), {
      userPassword: 'user密碼',
      ownerPassword: 'owner',
      permissions: { ...ALL_PERMISSIONS, copy: false },
    })
    out('encrypted.pdf', enc)
    const text = new TextDecoder('latin1').decode(enc)
    expect(text).toContain('/Encrypt')
    expect(text).toContain('/AESV3')
    expect(text).not.toContain('Secret title')
    const re = await PDFDocument.load(enc, { ignoreEncryption: true })
    expect(re.isEncrypted).toBe(true)
  })

  it('裁切、頁面尺寸、多頁合一、小冊子', async () => {
    const src = await sample(5)
    const cropped = await cropPages(src, () => ({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }))
    const c = await PDFDocument.load(cropped)
    expect(Math.round(c.getPage(0).getCropBox().width)).toBe(200)
    out('cropped.pdf', cropped)
    const resized = await resizePages(src, { paper: 'a4', orientation: 'auto', margin: 20, mode: 'fit' })
    const r = await PDFDocument.load(resized)
    expect(r.getPageCount()).toBe(5)
    expect(Math.round(r.getPage(0).getWidth())).toBe(595)
    expect(Math.round(r.getPage(1).getWidth())).toBe(842) // 橫向頁面自動轉向
    out('resized.pdf', resized)
    const nup = await layoutPages(src, { mode: 'nup', n: 4, paper: 'a4', order: 'z', rtl: false, margin: 18, gap: 8, border: true })
    expect((await PDFDocument.load(nup)).getPageCount()).toBe(2)
    out('nup.pdf', nup)
    const booklet = await layoutPages(src, { mode: 'booklet', n: 2, paper: 'a4', order: 'z', rtl: false, margin: 0, gap: 0, border: false })
    expect((await PDFDocument.load(booklet)).getPageCount()).toBe(4)
    out('booklet.pdf', booklet)
  })

  it('拼版順序', () => {
    expect(bookletOrder(4)).toEqual([
      [3, 0],
      [1, 2],
    ])
    expect(bookletOrder(5)[0]).toEqual([-1, 0])
    expect(nupOrder(5, 4, 'z', false)).toEqual([
      [0, 1, 2, 3],
      [4, -1, -1, -1],
    ])
    expect(nupOrder(4, 4, 'n', false)[0]).toEqual([0, 2, 1, 3])
  })

  it('書籤、附件、清除隱藏資訊、最佳化', async () => {
    const src = await sample(3)
    const bm = await writeBookmarks(src, [
      { id: 'a', title: '第一章', page: 0, level: 0 },
      { id: 'b', title: '1.1 小節', page: 1, level: 1 },
      { id: 'c', title: 'Chapter 2', page: 2, level: 0 },
    ])
    const { PDFName } = await import('pdf-lib')
    expect((await PDFDocument.load(bm)).catalog.has(PDFName.of('Outlines'))).toBe(true)
    out('bookmarks.pdf', bm)
    const att = await writeAttachments(bm, [{ name: 'note.txt', data: new TextEncoder().encode('hi') }])
    out('attach.pdf', att)
    const { bytes, report } = await sanitizePdf(att, {
      metadata: true,
      javascript: true,
      attachments: true,
      annotations: true,
      links: true,
      forms: true,
      bookmarks: true,
      thumbnails: true,
      layers: true,
    })
    expect(report.attachments).toBe(1)
    expect(report.bookmarks).toBe(1)
    const clean = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(clean.getTitle()).toBeUndefined()
    const { PDFDict } = await import('pdf-lib')
    const names = clean.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
    expect(names?.has(PDFName.of('EmbeddedFiles')) ?? false).toBe(false)
    out('sanitized.pdf', bytes)
    const opt = await optimizePdf(src)
    expect(opt.report.after).toBeGreaterThan(0)
  })
})
