/**
 * OCR（tesseract.js，LSTM 引擎）：全部在本機執行。
 * - Worker、WASM 核心、語言資料（繁中、英文的 best_int 版本）都打包進站，不連到 CDN；
 * - cacheMethod: 'none'：語言資料不寫入 IndexedDB（本機伺服器模式關閉後不殘留）；
 * - 可搜尋 PDF：在原頁面上疊一層透明文字（opacity 0），可以搜尋、選取與複製。
 */
import workerUrl from 'tesseract.js/dist/worker.min.js?url'
import coreSimdUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'
import coreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PDFFont } from 'pdf-lib'
import { releaseCanvas } from '@/lib/image'
import { loadForEdit } from './ops'
import { renderToCanvas } from './pdfjs'
import { placementToDraw, normRotation, type PageGeometry } from './placement'

export type OcrLang = 'chi_tra+eng' | 'eng' | 'chi_tra'

export interface OcrWord {
  text: string
  /** 視覺座標（pt，左上原點） */
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrPage {
  index: number
  text: string
  words: OcrWord[]
  confidence: number
}

/** WebAssembly SIMD 支援（wasm-feature-detect 的同一段位元組） */
const simd = () => {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    )
  } catch {
    return false
  }
}

const CJK_GAP = /([\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef])\s+(?=[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef])/g
/** 中文字之間 OCR 會插入空白，去掉 */
export const tidyCjk = (s: string) => s.replace(CJK_GAP, '$1')

type TWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>

export async function createOcr(
  lang: OcrLang,
  onStatus: (status: string, progress: number) => void,
): Promise<TWorker> {
  const { createWorker } = await import('tesseract.js')
  const abs = (u: string) => new URL(u, document.baseURI).href
  return createWorker(lang, 1 /* OEM.LSTM_ONLY */, {
    workerPath: abs(workerUrl),
    corePath: abs(simd() ? coreSimdUrl : coreUrl),
    langPath: abs('ocr/lang'),
    gzip: true,
    cacheMethod: 'none',
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => onStatus(m.status, m.progress),
  })
}

interface TBlock {
  paragraphs?: Array<{ lines?: Array<{ words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> }> }>
}

export async function ocrPage(
  worker: TWorker,
  doc: PDFDocumentProxy,
  index: number,
  dpi: number,
  signal?: AbortSignal,
): Promise<OcrPage> {
  const page = await doc.getPage(index + 1)
  const scale = dpi / 72
  const canvas = await renderToCanvas(page, scale, { signal })
  const vp = page.getViewport({ scale: 1 })
  const k = vp.width / canvas.width
  try {
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })
    const words: OcrWord[] = []
    for (const b of (data.blocks ?? []) as TBlock[])
      for (const p of b.paragraphs ?? [])
        for (const l of p.lines ?? [])
          for (const w of l.words ?? []) {
            const text = w.text.trim()
            if (!text) continue
            words.push({ text, x0: w.bbox.x0 * k, y0: w.bbox.y0 * k, x1: w.bbox.x1 * k, y1: w.bbox.y1 * k })
          }
    return { index, text: tidyCjk(data.text ?? '').trim(), words, confidence: data.confidence ?? 0 }
  } finally {
    releaseCanvas(canvas)
    page.cleanup()
  }
}

/** 在原 PDF 上疊加透明文字層 */
export async function makeSearchable(
  bytes: Uint8Array,
  pages: OcrPage[],
  cjkFont: Uint8Array | null,
): Promise<Uint8Array> {
  const { StandardFonts, degrees } = await import('pdf-lib')
  const doc = await loadForEdit(bytes)
  let font: PDFFont
  let latinOnly = false
  if (cjkFont) {
    const fontkit = (await import('@pdf-lib/fontkit')).default
    doc.registerFontkit(fontkit)
    font = await doc.embedFont(cjkFont, { subset: true, features: { liga: false, kern: false } })
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica)
    latinOnly = true
  }
  const all = doc.getPages()
  for (const p of pages) {
    const page = all[p.index]
    if (!page) continue
    const box = page.getCropBox()
    const g: PageGeometry = { x: box.x, y: box.y, width: box.width, height: box.height, rotation: normRotation(page.getRotation().angle) }
    for (const w of p.words) {
      let text = latinOnly ? w.text.replace(/[^\x20-\x7e]/g, '') : w.text
      if (!text) continue
      const width = w.x1 - w.x0
      const height = w.y1 - w.y0
      if (width <= 0 || height <= 0) continue
      let size = height * 0.9
      let tw: number
      try {
        tw = font.widthOfTextAtSize(text, size)
      } catch {
        text = text.replace(/[^\x20-\x7e]/g, '')
        if (!text) continue
        tw = font.widthOfTextAtSize(text, size)
      }
      if (tw > 0) size = Math.min(size * (width / tw), height * 1.6)
      const d = placementToDraw(g, { cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, angle: 0 }, { w: width, h: height })
      page.drawText(text, {
        x: d.x,
        y: d.y + height * 0.15,
        size,
        font,
        opacity: 0,
        rotate: degrees(d.rotate),
      })
    }
  }
  return doc.save({ useObjectStreams: true })
}
