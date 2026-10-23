/**
 * 長圖輸出（瀏覽器端）：逐頁用 pdf.js 渲染，過高的頁面切成多個水平條帶，
 * 取得像素後交給 Worker 的串流 PNG 編碼器。不使用一張巨大的 canvas，所以高度可以到數十萬像素。
 * 同時畫一張縮小的預覽圖（給結果卡顯示，避免瀏覽器解碼整張巨圖）。
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { canvasToBlob, createCanvas, releaseCanvas } from '@/lib/image'
import type { PngWorkerRequest, PngWorkerResponse } from '@/workers/pdf-png'
import type { LongLayout } from './longImage'

type Rgba = [number, number, number, number]
/** 從聯集的每個成員移除 id */
type Msg = PngWorkerRequest extends infer T ? (T extends unknown ? Omit<T, 'id'> : never) : never

/** 每個條帶最多的像素數（約 32 MB 的 RGBA），各瀏覽器的 canvas 都能安全處理 */
const BAND_PIXELS = 8_000_000
const BAND_MAX_ROWS = 4096
/** 預覽圖寬度與高度上限 */
const PREVIEW_W = 320
const PREVIEW_MAX_H = 24000

export function hexToRgba(hex: string, alpha = 255): Rgba {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1], 16) : 0xffffff
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha]
}

/** 與 Worker 溝通：一次只有一個未完成的請求（背壓） */
class PngWorkerClient {
  private worker = new Worker(new URL('../../../workers/pdf-png.ts', import.meta.url), {
    type: 'module',
  })
  private seq = 0
  private waiting = new Map<
    number,
    { resolve: (r: PngWorkerResponse) => void; reject: (e: unknown) => void }
  >()
  constructor() {
    this.worker.onmessage = (e: MessageEvent<PngWorkerResponse>) => {
      const w = this.waiting.get(e.data.id)
      if (!w) return
      this.waiting.delete(e.data.id)
      if (e.data.ok) w.resolve(e.data)
      else w.reject(new Error(e.data.error))
    }
    this.worker.onerror = (e) => {
      this.waiting.forEach((w) => w.reject(new Error(e.message || 'worker error')))
      this.waiting.clear()
    }
  }
  send(msg: Msg, transfer: Transferable[] = []): Promise<PngWorkerResponse> {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.worker.postMessage({ ...msg, id } as PngWorkerRequest, transfer)
    })
  }
  terminate() {
    this.worker.terminate()
    this.waiting.forEach((w) => w.reject(new DOMException('Aborted', 'AbortError')))
    this.waiting.clear()
  }
}

export interface LongRenderOptions {
  scale: number
  /** 背景（null＝透明） */
  background: string | null
  lineColor: string
  signal?: AbortSignal
  /** 已完成的列數／總列數 */
  onProgress?: (done: number, total: number) => void
}

export async function renderLongPng(
  doc: PDFDocumentProxy,
  layout: LongLayout,
  o: LongRenderOptions,
): Promise<{ blob: Blob; preview: Blob }> {
  const abort = () => {
    if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  }
  const alpha = o.background === null
  const bg: Rgba = alpha ? [0, 0, 0, 0] : hexToRgba(o.background!)
  const line = hexToRgba(o.lineColor)
  const client = new PngWorkerClient()
  const onAbort = () => client.terminate()
  o.signal?.addEventListener('abort', onAbort, { once: true })

  // 預覽：等比縮小，過高時再縮
  const pk = Math.min(PREVIEW_W / layout.width, PREVIEW_MAX_H / layout.height)
  const preview = createCanvas(Math.max(1, layout.width * pk), Math.max(1, layout.height * pk))
  const pctx = preview.getContext('2d')!
  if (!alpha) {
    pctx.fillStyle = o.background!
    pctx.fillRect(0, 0, preview.width, preview.height)
  }
  pctx.fillStyle = o.lineColor
  for (const l of layout.lines) pctx.fillRect(0, l.y * pk, preview.width, Math.max(1, l.h * pk))

  let done = 0
  const total = layout.height
  /** 尚未回覆的請求（最多一個） */
  let inflight: Promise<void> | null = null
  let failure: unknown = null
  const settle = async () => {
    if (inflight) await inflight
    if (failure) throw failure
  }
  const post = async (msg: Msg, transfer: Transferable[], rows: number) => {
    await settle()
    abort()
    inflight = client.send(msg, transfer).then(
      () => {
        done += rows
        o.onProgress?.(done, total)
      },
      (e) => {
        failure = e
      },
    )
  }
  /** 在 y 之前補上背景列與分隔線 */
  let cursor = 0
  const fillTo = async (y: number) => {
    while (cursor < y) {
      const l = layout.lines.find((x) => x.y >= cursor && x.y < y)
      if (l && l.y === cursor) {
        await post({ type: 'fill', rows: l.h, color: line }, [], l.h)
        cursor += l.h
        continue
      }
      const end = l ? l.y : y
      await post({ type: 'fill', rows: end - cursor, color: bg }, [], end - cursor)
      cursor = end
    }
  }

  try {
    await client.send({ type: 'init', width: layout.width, height: layout.height, alpha, bg })
    for (const p of layout.pages) {
      abort()
      await fillTo(p.y)
      const page = await doc.getPage(p.page)
      try {
        const base = page.getViewport({ scale: 1 })
        const sx = p.w / base.width
        const sy = p.h / base.height
        const bandRows = Math.max(1, Math.min(BAND_MAX_ROWS, Math.floor(BAND_PIXELS / p.w), p.h))
        for (let top = 0; top < p.h; top += bandRows) {
          abort()
          const rows = Math.min(bandRows, p.h - top)
          const canvas = createCanvas(p.w, rows)
          try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!
            const viewport = page.getViewport({ scale: sx, offsetY: -top })
            // 寬高的縮放可能因四捨五入有極小差異，用 transform 補正
            const task = page.render({
              canvas,
              viewport,
              background: '#ffffff',
              transform: Math.abs(sy - sx) > 1e-6 ? [1, 0, 0, sy / sx, 0, 0] : undefined,
            })
            const cancel = () => task.cancel()
            o.signal?.addEventListener('abort', cancel, { once: true })
            try {
              await task.promise
            } finally {
              o.signal?.removeEventListener('abort', cancel)
            }
            pctx.drawImage(canvas, p.x * pk, (p.y + top) * pk, p.w * pk, rows * pk)
            const data = ctx.getImageData(0, 0, p.w, rows).data
            const buf = data.buffer as ArrayBuffer
            await post({ type: 'band', data: buf, w: p.w, rows, x: p.x }, [buf], rows)
          } finally {
            releaseCanvas(canvas)
          }
          cursor = p.y + top + rows
        }
      } finally {
        page.cleanup()
      }
    }
    await fillTo(layout.height)
    await settle()
    abort()
    const res = await client.send({ type: 'finish' })
    if (!res.ok || !res.parts) throw new Error('PNG 編碼失敗')
    const blob = new Blob(res.parts, { type: 'image/png' })
    const previewBlob = await canvasToBlob(preview, alpha ? 'image/png' : 'image/jpeg', 0.85)
    return { blob, preview: previewBlob }
  } catch (e) {
    if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    throw e
  } finally {
    o.signal?.removeEventListener('abort', onAbort)
    client.terminate()
    releaseCanvas(preview)
  }
}
