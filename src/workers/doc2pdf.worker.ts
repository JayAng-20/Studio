/// <reference lib="webworker" />
/**
 * 文字檔轉 PDF Worker：解析（Markdown／RTF／TXT → 文件模型）與排版、產生 PDF 都在這裡做，避免卡住畫面。
 * 字型第一次轉檔時由主執行緒傳入，之後保留在 Worker 內；取消時主執行緒直接 terminate。
 */
import { convertDocs, type Fonts } from '@/features/doc2pdf/engine/convert'
import { parseMarkdown } from '@/features/doc2pdf/engine/markdown'
import { RtfError, parseRtf } from '@/features/doc2pdf/engine/rtf'
import { parseTxt } from '@/features/doc2pdf/engine/txt'
import type { WorkerRequest, WorkerResponse } from '@/features/doc2pdf/engine/protocol'

declare const self: DedicatedWorkerGlobalScope

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer)

let fonts: Fonts | null = null

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  if (req.type === 'parse') {
    const { job } = req
    try {
      const doc =
        job.kind === 'md'
          ? parseMarkdown(job.text ?? '', job.name, job.idPrefix)
          : job.kind === 'txt'
            ? parseTxt(job.text ?? '', job.name, { raw: job.raw, idPrefix: job.idPrefix })
            : parseRtf(job.bytes ?? new Uint8Array(), job.name, job.idPrefix)
      post({ type: 'parsed', id: req.id, doc })
    } catch (err) {
      console.error(err)
      post({
        type: 'error',
        id: req.id,
        code: err instanceof RtfError ? 'notRtf' : 'parse',
        message: String((err as Error)?.message ?? err),
      })
    }
    return
  }
  if (req.fonts) fonts = req.fonts
  if (!fonts) {
    post({ type: 'error', id: req.id, code: 'noFonts', message: 'fonts missing' })
    return
  }
  try {
    let last = -1
    const r = await convertDocs(req.docs, fonts, req.options, (value, stage) => {
      // 節流：至少變化 1% 才回報
      const v = Math.round(value * 100)
      if (v !== last) {
        last = v
        post({ type: 'progress', id: req.id, stage, value })
      }
    })
    post(
      { type: 'converted', id: req.id, bytes: r.bytes, pages: r.pages, missing: r.missing, title: r.title },
      [r.bytes.buffer as ArrayBuffer],
    )
  } catch (err) {
    console.error(err)
    const memory = err instanceof RangeError
    post({ type: 'error', id: req.id, code: memory ? 'memory' : 'convert', message: String((err as Error)?.message ?? err) })
  }
}
