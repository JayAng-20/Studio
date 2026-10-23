/**
 * 匯出引擎：優先在 Worker（OffscreenCanvas）執行；不支援或 Worker 啟動失敗時退回主執行緒。
 */
import { createCanvas, decodeImage } from '@/lib/image'
import { caps } from '@/lib/capabilities'
import { runExport, type ExportJob, type ExportResult } from './lib/export'

type Pending = {
  resolve: (r: ExportResult) => void
  reject: (e: unknown) => void
  job: ExportJob
  signal?: AbortSignal
}

const canUseWorker = () =>
  typeof Worker === 'function' &&
  caps.offscreenCanvas() &&
  typeof OffscreenCanvas.prototype.convertToBlob === 'function'

/** 主執行緒退路的解碼快取（最近兩張） */
const mainCache = new Map<string, ImageBitmap>()
async function mainDecode(key: string, blob: Blob) {
  const hit = mainCache.get(key)
  if (hit) return hit
  const bmp = await decodeImage(blob)
  mainCache.set(key, bmp)
  while (mainCache.size > 2) {
    const [k, v] = mainCache.entries().next().value as [string, ImageBitmap]
    v.close()
    mainCache.delete(k)
  }
  return bmp
}

function runOnMain(job: ExportJob, signal?: AbortSignal) {
  return runExport(job, {
    make: (w, h) => createCanvas(w, h),
    decode: mainDecode,
    decodeOnce: (b) => decodeImage(b),
    signal,
  })
}

export class ExportEngine {
  private worker: Worker | null = null
  private broken = !canUseWorker()
  private seq = 0
  private pending = new Map<number, Pending>()

  private ensure(): Worker | null {
    if (this.broken) return null
    if (this.worker) return this.worker
    try {
      const w = new Worker(new URL('../../workers/tools-render.ts', import.meta.url), {
        type: 'module',
      })
      w.onmessage = (e: MessageEvent) => this.onMessage(e.data)
      w.onerror = (e) => {
        console.error(e)
        this.fail()
      }
      this.worker = w
      return w
    } catch (e) {
      console.error(e)
      this.broken = true
      return null
    }
  }

  /** Worker 壞掉：之後都改在主執行緒，進行中的工作也改到主執行緒重跑 */
  private fail() {
    this.broken = true
    this.worker?.terminate()
    this.worker = null
    const list = [...this.pending.values()]
    this.pending.clear()
    for (const p of list) runOnMain(p.job, p.signal).then(p.resolve, p.reject)
  }

  private onMessage(
    d:
      | { id: number; ok: true; result: ExportResult }
      | { id: number; ok: false; name: string; message: string },
  ) {
    const p = this.pending.get(d.id)
    if (!p) return
    this.pending.delete(d.id)
    if (d.ok) p.resolve(d.result)
    else {
      if (d.name === 'AbortError') p.reject(new DOMException('Aborted', 'AbortError'))
      else {
        const err = new Error(d.message)
        err.name = d.name
        p.reject(err)
      }
    }
  }

  run(job: ExportJob, signal?: AbortSignal): Promise<ExportResult> {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    const w = this.ensure()
    if (!w) return runOnMain(job, signal)
    const id = ++this.seq
    return new Promise<ExportResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, job, signal })
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.has(id)) return
          this.pending.delete(id)
          this.worker?.postMessage({ cancel: id })
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
      w.postMessage({ id, job })
    })
  }

  /** 文件移除時清掉 Worker 裡的解碼快取 */
  drop(key: string) {
    this.worker?.postMessage({ drop: key })
    const hit = mainCache.get(key)
    if (hit) {
      hit.close()
      mainCache.delete(key)
    }
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    for (const p of this.pending.values()) p.reject(new DOMException('Aborted', 'AbortError'))
    this.pending.clear()
  }
}

/** 估算與單張下載共用的常駐引擎 */
let shared: ExportEngine | null = null
export const sharedEngine = () => (shared ??= new ExportEngine())

/** 批次：依核心數開數個引擎平行處理，結束後全部關閉 */
export async function runPool<T>(
  items: T[],
  worker: (item: T, engine: ExportEngine, index: number) => Promise<void>,
  signal?: AbortSignal,
) {
  const size = Math.max(1, Math.min(items.length, caps.hardwareConcurrency(), 4))
  const engines = Array.from({ length: size }, () => new ExportEngine())
  let next = 0
  try {
    await Promise.all(
      engines.map(async (engine) => {
        while (next < items.length) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
          const i = next++
          await worker(items[i], engine, i)
        }
      }),
    )
  } finally {
    engines.forEach((e) => e.dispose())
  }
}
