/**
 * pdf.js 載入與渲染基礎建設。
 * - 使用 legacy build：pdf.js 6 的一般版本用到 Map#getOrInsertComputed、Math.sumPrecise 等
 *   很新的 API（Chrome 141、Safari 16.4 都沒有），legacy build 內含 core-js polyfill，主執行緒與 worker 都適用。
 * - worker、CMap（中日韓字型對照）、標準字型、WASM 解碼器全部由 Vite 打包進站，不走 CDN。
 * - 渲染排隊（同時最多 2 頁）、縮圖低解析度＋LRU 快取、及時 page.cleanup() 與釋放 canvas。
 */
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { createCanvas, releaseCanvas, canvasToBlob } from '@/lib/image'

type PdfjsModule = typeof import('pdfjs-dist')

let modPromise: Promise<PdfjsModule> | null = null

/** 動態載入 pdf.js（第一次使用時才下載） */
export function loadPdfjs(): Promise<PdfjsModule> {
  modPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
    const mod = m as unknown as PdfjsModule
    mod.GlobalWorkerOptions.workerSrc = workerUrl
    return mod
  })
  return modPromise
}

/* ---------- 打包進站的二進位資料（CMap、標準字型、WASM） ---------- */

const ROOT = '/node_modules/pdfjs-dist'
const cmapUrls = import.meta.glob<string>('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
  query: '?url',
  import: 'default',
})
const fontUrls = import.meta.glob<string>('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
  query: '?url',
  import: 'default',
})
const wasmUrls = import.meta.glob<string>('/node_modules/pdfjs-dist/wasm/*.wasm', {
  query: '?url',
  import: 'default',
})

/** 取代 pdf.js 預設的 DOMBinaryDataFactory：依檔名找到打包後的網址再讀取 */
class BundledDataFactory {
  constructor(_opts: unknown) {}
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const [table, dir] =
      kind === 'cMapUrl'
        ? [cmapUrls, 'cmaps']
        : kind === 'standardFontDataUrl'
          ? [fontUrls, 'standard_fonts']
          : [wasmUrls, 'wasm']
    const load = table[`${ROOT}/${dir}/${filename}`]
    if (!load) throw new Error(`pdf.js 資源不存在：${dir}/${filename}`)
    const res = await fetch(await load())
    if (!res.ok) throw new Error(`pdf.js 資源載入失敗：${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

/** pdf.js 密碼回應代碼（與 PasswordResponses 相同） */
export const PASSWORD_NEED = 1
export const PASSWORD_INCORRECT = 2

export type PasswordAsk = (reason: number) => Promise<string | null>

export class PasswordCanceledError extends Error {
  constructor() {
    super('password-canceled')
    this.name = 'PasswordCanceledError'
  }
}

export interface OpenResult {
  doc: PDFDocumentProxy
  /** 最後成功使用的密碼（沒有密碼時為 undefined） */
  password?: string
}

/**
 * 開啟 PDF。需要密碼時呼叫 ask(reason)；使用者取消（回傳 null）時丟出 PasswordCanceledError。
 * 注意：pdf.js 會把資料轉移給 worker，所以這裡一律傳複本，呼叫端的位元組仍可使用。
 */
export async function openPdf(
  bytes: Uint8Array,
  opts: { password?: string; ask?: PasswordAsk } = {},
): Promise<OpenResult> {
  const pdfjs = await loadPdfjs()
  let lastPassword = opts.password
  let canceled = false
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password: opts.password,
    BinaryDataFactory: BundledDataFactory,
    useWorkerFetch: false,
    cMapUrl: 'bundled/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'bundled/standard_fonts/',
    wasmUrl: 'bundled/wasm/',
    enableXfa: false,
    verbosity: 0,
  })
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    if (!opts.ask) {
      canceled = true
      void task.destroy()
      return
    }
    opts.ask(reason).then(
      (pw) => {
        if (pw === null) {
          canceled = true
          void task.destroy()
        } else {
          lastPassword = pw
          update(pw)
        }
      },
      () => {
        canceled = true
        void task.destroy()
      },
    )
  }
  try {
    const doc = await task.promise
    return { doc, password: lastPassword }
  } catch (e) {
    if (canceled) throw new PasswordCanceledError()
    throw e
  }
}

/** 文件資訊旗標：加密、表單、簽章 */
export interface DocFlags {
  encrypted: boolean
  hasForm: boolean
  hasXfa: boolean
  hasSignatures: boolean
  title?: string
}

export async function docFlags(doc: PDFDocumentProxy): Promise<DocFlags> {
  try {
    const { info } = await doc.getMetadata()
    const i = info as Record<string, unknown>
    return {
      encrypted: !!i.EncryptFilterName,
      hasForm: !!i.IsAcroFormPresent,
      hasXfa: !!i.IsXFAPresent,
      hasSignatures: !!i.IsSignaturesPresent,
      title: typeof i.Title === 'string' && i.Title.trim() ? i.Title.trim() : undefined,
    }
  } catch (e) {
    console.error(e)
    return { encrypted: false, hasForm: false, hasXfa: false, hasSignatures: false }
  }
}

/* ---------- 渲染排隊 ---------- */

type Job = { run: () => Promise<void>; priority: number; signal?: AbortSignal }
const queue: Job[] = []
let active = 0
const CONCURRENCY = 2

function pump() {
  while (active < CONCURRENCY && queue.length) {
    queue.sort((a, b) => b.priority - a.priority)
    const job = queue.shift()!
    if (job.signal?.aborted) continue
    active++
    job.run().finally(() => {
      active--
      pump()
    })
  }
}

/** 排入渲染佇列（priority 大者先跑；中止的工作會被略過） */
export function schedule<T>(
  fn: () => Promise<T>,
  opts: { priority?: number; signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    queue.push({
      priority: opts.priority ?? 0,
      signal: opts.signal,
      run: async () => {
        try {
          if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
          resolve(await fn())
        } catch (e) {
          reject(e)
        } finally {
          opts.signal?.removeEventListener('abort', onAbort)
        }
      },
    })
    pump()
  })
}

/** 畫布像素上限（避免行動裝置記憶體不足；pdf.js viewer 也用 2^25） */
export const MAX_CANVAS_PIXELS =
  typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1 ? 2 ** 24 : 2 ** 25

/** 依像素上限限制縮放倍率 */
export function clampScale(w: number, h: number, scale: number): number {
  const area = w * h * scale * scale
  return area > MAX_CANVAS_PIXELS ? Math.sqrt(MAX_CANVAS_PIXELS / (w * h)) : scale
}

/**
 * 把一頁渲染到新的 canvas（白色背景）。呼叫端用完要 releaseCanvas。
 * scale 以 PDF 單位（1/72 英吋）為 1；rotation 為額外旋轉（順時針）。
 */
export async function renderToCanvas(
  page: PDFPageProxy,
  scale: number,
  opts: { signal?: AbortSignal; rotation?: number } = {},
): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1, rotation: page.rotate + (opts.rotation ?? 0) })
  const s = clampScale(base.width, base.height, scale)
  const viewport = page.getViewport({ scale: s, rotation: page.rotate + (opts.rotation ?? 0) })
  const canvas = createCanvas(viewport.width, viewport.height)
  let task: RenderTask | null = null
  const onAbort = () => task?.cancel()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    task = page.render({ canvas, viewport, background: '#ffffff' })
    await task.promise
    return canvas
  } catch (e) {
    releaseCanvas(canvas)
    if ((e as Error)?.name === 'RenderingCancelledException')
      throw new DOMException('Aborted', 'AbortError')
    throw e
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/* ---------- 縮圖 LRU 快取 ---------- */

const THUMB_CAPACITY = 360
const thumbCache = new Map<string, string>()
const thumbPending = new Map<string, Promise<string>>()

function remember(key: string, url: string) {
  thumbCache.set(key, url)
  while (thumbCache.size > THUMB_CAPACITY) {
    const [oldKey, oldUrl] = thumbCache.entries().next().value as [string, string]
    thumbCache.delete(oldKey)
    URL.revokeObjectURL(oldUrl)
  }
}

/** 已快取的縮圖（同步取得，避免閃爍） */
export function peekThumb(key: string): string | undefined {
  const url = thumbCache.get(key)
  if (url) {
    // 重新插入，標記為最近使用
    thumbCache.delete(key)
    thumbCache.set(key, url)
  }
  return url
}

export const thumbKey = (docKey: string, pageIndex: number, width: number) =>
  `${docKey}|${pageIndex}|${width}`

/**
 * 取得某頁縮圖（低解析度 JPEG 物件網址），會快取；同一張同時只渲染一次。
 * width 為 CSS 寬度，會乘上裝置像素比（最多 2）。
 */
export function getThumb(
  docKey: string,
  doc: PDFDocumentProxy,
  pageIndex: number,
  width: number,
  opts: { signal?: AbortSignal; priority?: number } = {},
): Promise<string> {
  const key = thumbKey(docKey, pageIndex, width)
  const hit = peekThumb(key)
  if (hit) return Promise.resolve(hit)
  const pending = thumbPending.get(key)
  if (pending) return pending
  const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)
  const p = schedule(
    async () => {
      const page = await doc.getPage(pageIndex + 1)
      try {
        const vp = page.getViewport({ scale: 1 })
        const canvas = await renderToCanvas(page, (width * dpr) / vp.width)
        try {
          const blob = await canvasToBlob(canvas, 'image/jpeg', 0.82)
          const url = URL.createObjectURL(blob)
          remember(key, url)
          return url
        } finally {
          releaseCanvas(canvas)
        }
      } finally {
        page.cleanup()
      }
    },
    { priority: opts.priority ?? 0, signal: opts.signal },
  ).finally(() => thumbPending.delete(key))
  thumbPending.set(key, p)
  return p
}

/** 移除某份文件的所有縮圖快取 */
export function dropThumbs(docKey: string) {
  for (const [k, url] of thumbCache) {
    if (k.startsWith(`${docKey}|`)) {
      thumbCache.delete(k)
      URL.revokeObjectURL(url)
    }
  }
}

/** 頁面尺寸（PDF 單位，已套用頁面本身的 /Rotate） */
export async function pageSizes(
  doc: PDFDocumentProxy,
  signal?: AbortSignal,
): Promise<Array<{ w: number; h: number }>> {
  const out: Array<{ w: number; h: number }> = []
  for (let i = 1; i <= doc.numPages; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    out.push({ w: vp.width, h: vp.height })
  }
  return out
}

/** 擷取文字：依 hasEOL 換行，片段之間依位置補空白 */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent()
  let out = ''
  for (const item of content.items) {
    if (!('str' in item)) continue
    out += item.str
    if (item.hasEOL) out += '\n'
  }
  return out.replace(/[ \t]+\n/g, '\n').trim()
}

/** 關閉文件並釋放 worker 端資源（pdf.js 6 起改由 loadingTask 關閉） */
export function destroyDoc(doc: PDFDocumentProxy): Promise<void> {
  return doc.loadingTask.destroy().catch(() => {})
}
