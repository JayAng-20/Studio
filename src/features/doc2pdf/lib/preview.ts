/**
 * 轉檔結果預覽：用 pdf.js 把前幾頁渲染成縮圖。
 * - 用 legacy build（內含 polyfill，較舊的 Chrome／Safari 也能用）；worker 與標準字型資料由 Vite 打包，不走 CDN。
 * - 渲染完立即把 canvas 轉成 Blob URL 並釋放 canvas、呼叫 page.cleanup()。
 */
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

type PdfjsModule = typeof import('pdfjs-dist')
let mod: Promise<PdfjsModule> | null = null

function loadPdfjs(): Promise<PdfjsModule> {
  mod ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
    const p = m as unknown as PdfjsModule
    p.GlobalWorkerOptions.workerSrc = workerUrl
    return p
  })
  return mod
}

// 標準字型（Courier、Times）的字形資料：程式碼與學術主題的英文字用到
const fontUrls = import.meta.glob<string>('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
  query: '?url',
  import: 'default',
})

class BundledDataFactory {
  constructor(_opts: unknown) {
    void _opts
  }
  async fetch({ filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const load = fontUrls[`/node_modules/pdfjs-dist/standard_fonts/${filename}`]
    if (!load) throw new Error(`missing standard font ${filename}`)
    const res = await fetch(await load())
    if (!res.ok) throw new Error(`font ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

export interface PreviewDoc {
  doc: PDFDocumentProxy
  task: PDFDocumentLoadingTask
}

export async function openPreview(bytes: Uint8Array): Promise<PreviewDoc> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    BinaryDataFactory: BundledDataFactory,
    useSystemFonts: false,
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0])
  const doc = await task.promise
  return { doc, task }
}

/** 渲染一頁成圖片網址（寬度 widthPx，依裝置像素比放大） */
export async function renderPage(p: PreviewDoc, pageNo: number, widthPx: number): Promise<{ url: string; ratio: number }> {
  const page = await p.doc.getPage(pageNo)
  try {
    const vp1 = page.getViewport({ scale: 1 })
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    const scale = (widthPx * dpr) / vp1.width
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(vp.width)
    canvas.height = Math.ceil(vp.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    canvas.width = canvas.height = 0
    if (!blob) throw new Error('toBlob failed')
    return { url: URL.createObjectURL(blob), ratio: vp1.height / vp1.width }
  } finally {
    page.cleanup()
  }
}

export async function closePreview(p: PreviewDoc | null) {
  if (!p) return
  try {
    await p.task.destroy()
  } catch (e) {
    console.error(e)
  }
}
