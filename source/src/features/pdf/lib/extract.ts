/**
 * 擷取 PDF 中的圖片：走訪每頁的繪圖指令，找出影像物件（pdf.js 已解碼），畫到畫布後存成 PNG。
 * 同一個影像物件在多頁重複使用時只取一次。
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { canvasToBlob, createCanvas, releaseCanvas } from '@/lib/image'
import { loadPdfjs } from './pdfjs'

export interface ExtractedImage {
  id: string
  page: number
  width: number
  height: number
  blob: Blob
  url: string
}

interface PdfjsImage {
  width: number
  height: number
  kind?: number
  data?: Uint8ClampedArray | Uint8Array
  bitmap?: ImageBitmap
}

function getObj(page: PDFPageProxy, id: string): Promise<PdfjsImage | null> {
  const store = (id.startsWith('g_') ? page.commonObjs : page.objs) as unknown as {
    get: (id: string, cb?: (v: unknown) => void) => unknown
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000)
    try {
      store.get(id, (v) => {
        clearTimeout(timer)
        resolve((v as PdfjsImage) ?? null)
      })
    } catch {
      clearTimeout(timer)
      resolve(null)
    }
  })
}

async function toBlob(img: PdfjsImage): Promise<Blob | null> {
  const { width: w, height: h } = img
  if (!w || !h) return null
  const c = createCanvas(w, h)
  try {
    const ctx = c.getContext('2d')!
    if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0)
    else if (img.data) {
      const out = ctx.createImageData(w, h)
      const d = out.data
      const src = img.data
      if (img.kind === 3) d.set(src.subarray(0, d.length))
      else if (img.kind === 2) {
        for (let i = 0, j = 0; j < d.length; i += 3, j += 4) {
          d[j] = src[i]
          d[j + 1] = src[i + 1]
          d[j + 2] = src[i + 2]
          d[j + 3] = 255
        }
      } else {
        // 1 bpp 灰階（每列補齊到位元組）
        const rowBytes = (w + 7) >> 3
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1
            const j = (y * w + x) * 4
            const v = bit ? 255 : 0
            d[j] = d[j + 1] = d[j + 2] = v
            d[j + 3] = 255
          }
      }
      ctx.putImageData(out, 0, 0)
    } else return null
    return await canvasToBlob(c, 'image/png')
  } finally {
    releaseCanvas(c)
  }
}

export async function extractImages(
  doc: PDFDocumentProxy,
  opts: { minSize: number; pages?: number[] },
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
  onFound?: (img: ExtractedImage) => void,
): Promise<ExtractedImage[]> {
  const { OPS } = await loadPdfjs()
  const out: ExtractedImage[] = []
  const seen = new Set<string>()
  const pages = opts.pages ?? Array.from({ length: doc.numPages }, (_, i) => i)
  for (let k = 0; k < pages.length; k++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const page = await doc.getPage(pages[k] + 1)
    try {
      const ops = await page.getOperatorList()
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i]
        let img: PdfjsImage | null = null
        let id = ''
        if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
          id = String(ops.argsArray[i][0])
          if (seen.has(id)) continue
          img = await getObj(page, id)
        } else if (fn === OPS.paintInlineImageXObject) {
          id = `inline-${pages[k]}-${i}`
          img = ops.argsArray[i][0] as PdfjsImage
        } else continue
        seen.add(id)
        if (!img || img.width < opts.minSize || img.height < opts.minSize) continue
        const blob = await toBlob(img)
        if (!blob) continue
        const item = {
          id,
          page: pages[k],
          width: img.width,
          height: img.height,
          blob,
          url: URL.createObjectURL(blob),
        }
        out.push(item)
        onFound?.(item)
      }
    } finally {
      page.cleanup()
    }
    onProgress?.((k + 1) / pages.length)
  }
  return out
}
