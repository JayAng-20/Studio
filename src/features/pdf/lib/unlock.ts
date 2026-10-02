/**
 * 移除 PDF 的密碼保護（解密）。
 * pdf-lib 無法讀取加密檔；pdf.js 能解密讀取，但它的 extractPages 在「只有單一來源文件」時
 * 會沿用原本的加密設定輸出。這裡加入一份一頁的空白 PDF 當第二個來源，讓 pdf.js 以「多來源」
 * 模式輸出未加密的檔案（表單、書籤、結構樹都會保留），再用 pdf-lib 刪掉那一頁並補回文件資訊。
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { app } from '@/config/app'
import { splitKeywords } from './ops'

export async function decryptPdf(doc: PDFDocumentProxy): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const filler = await PDFDocument.create()
  filler.addPage([10, 10])
  const fillerBytes = await filler.save()
  const info = await doc
    .getMetadata()
    .then((m) => m.info as Record<string, unknown>)
    .catch(() => ({}) as Record<string, unknown>)
  const extracted = await doc.extractPages([{ document: null }, { document: fillerBytes }])
  const out = await PDFDocument.load(extracted, { updateMetadata: false })
  out.removePage(out.getPageCount() - 1)
  const str = (k: string) => (typeof info[k] === 'string' ? (info[k] as string).trim() : '')
  if (str('Title')) out.setTitle(str('Title'))
  if (str('Author')) out.setAuthor(str('Author'))
  if (str('Subject')) out.setSubject(str('Subject'))
  if (str('Keywords')) out.setKeywords(splitKeywords(str('Keywords')))
  out.setCreator(str('Creator') || app.name)
  out.setProducer(app.name)
  out.setModificationDate(new Date())
  return out.save({ useObjectStreams: true })
}
