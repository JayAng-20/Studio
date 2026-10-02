/**
 * Worker 用戶端：解析與轉檔都丟到 Worker。
 * - 解析用一個常駐 Worker（切換編碼、模式時反覆使用）。
 * - 轉檔用另一個 Worker；取消時直接 terminate，下次再建立（字型重新傳入）。
 */
import type { ConvertOptions } from '../engine/convert'
import type { DocModel } from '../engine/model'
import type { ParseJob, WorkerRequest, WorkerResponse } from '../engine/protocol'

export class EngineError extends Error {
  code: string
  constructor(code: string, message = code) {
    super(message)
    this.code = code
  }
}

const abortError = () => new DOMException('Aborted', 'AbortError')

class WorkerHandle {
  worker: Worker
  fontsSent = false
  private seq = 0
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: unknown) => void; onProgress?: (r: WorkerResponse) => void }>()
  dead = false
  constructor() {
    this.worker = new Worker(new URL('../../../workers/doc2pdf.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      const p = this.pending.get(msg.id)
      if (!p) return
      if (msg.type === 'progress') {
        p.onProgress?.(msg)
        return
      }
      this.pending.delete(msg.id)
      if (msg.type === 'error') p.reject(new EngineError(msg.code, msg.message))
      else p.resolve(msg)
    }
    this.worker.onerror = (e) => {
      console.error(e)
      this.failAll(new EngineError('worker', e.message))
    }
  }
  request(build: (id: number) => WorkerRequest, onProgress?: (r: WorkerResponse) => void, transfer: Transferable[] = []) {
    const id = ++this.seq
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress })
      this.worker.postMessage(build(id), transfer)
    })
  }
  failAll(e: unknown) {
    for (const p of this.pending.values()) p.reject(e)
    this.pending.clear()
  }
  terminate() {
    this.dead = true
    this.worker.terminate()
    this.failAll(abortError())
  }
}

let parser: WorkerHandle | null = null
let converter: WorkerHandle | null = null
let users = 0

/** 元件掛載時登記；全部卸載後結束 Worker */
export function retainEngine() {
  users++
  return () => {
    users--
    if (users <= 0) {
      parser?.terminate()
      converter?.terminate()
      parser = converter = null
      users = 0
    }
  }
}

export async function parseSource(job: ParseJob): Promise<DocModel> {
  if (!parser || parser.dead) parser = new WorkerHandle()
  const r = await parser.request((id) => ({ type: 'parse', id, job }))
  if (r.type !== 'parsed') throw new EngineError('parse')
  return r.doc
}

export interface ConvertOutput {
  bytes: Uint8Array
  pages: number
  missing: number
  title: string
}

export async function convertInWorker(
  docs: DocModel[],
  options: ConvertOptions,
  fonts: { regular: Uint8Array; bold: Uint8Array },
  onProgress: (stage: 'layout' | 'render', value: number) => void,
  signal: AbortSignal,
): Promise<ConvertOutput> {
  if (signal.aborted) throw abortError()
  if (!converter || converter.dead) converter = new WorkerHandle()
  const w = converter
  const onAbort = () => {
    w.terminate()
    if (converter === w) converter = null
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const sendFonts = !w.fontsSent
    w.fontsSent = true
    const r = await w.request(
      (id) => ({ type: 'convert', id, docs, options, fonts: sendFonts ? fonts : undefined }),
      (m) => m.type === 'progress' && onProgress(m.stage, m.value),
    )
    if (r.type !== 'converted') throw new EngineError('convert')
    return { bytes: r.bytes, pages: r.pages, missing: r.missing, title: r.title }
  } catch (e) {
    if (signal.aborted) throw abortError()
    // Worker 掛掉（例如記憶體不足）：下次重建
    if (e instanceof EngineError && (e.code === 'worker' || e.code === 'memory')) {
      w.terminate()
      if (converter === w) converter = null
    }
    throw e
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
