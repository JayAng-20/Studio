/**
 * Worker 池：數量依 hardwareConcurrency（上限 4）。
 * - 依「預估記憶體」排程：大圖不會同時處理太多張，避免分頁崩潰。
 * - 取消：還沒開始的直接移出佇列；已開始的 terminate 該 Worker（WASM 編碼無法中途停止）。
 * - 閒置一段時間後關閉 Worker，釋放記憶體（含已載入的 WASM）。
 * - 不支援 OffscreenCanvas 時，退回主執行緒逐一處理（同一套流程）。
 */
import { caps } from '@/lib/capabilities'
import { clamp } from '@/lib/format'
import { uid } from '@/lib/files'
import {
  EngineError,
  type CodecId,
  type ConvertJob,
  type ConvertResult,
  type ThumbJob,
  type ThumbResult,
  type WorkerRequest,
  type WorkerResponse,
} from '../types'

export type CodecListener = (codec: CodecId, loaded: number, total: number, done?: boolean) => void

interface RunOpts {
  signal?: AbortSignal
  onProgress?: (p: number) => void
  /** 預估需要的位元組（用於排程） */
  mem?: number
}

interface Pending {
  id: string
  req: WorkerRequest
  transfer: Transferable[]
  priority: number
  mem: number
  resolve: (v: ConvertResult | ThumbResult) => void
  reject: (e: unknown) => void
  onProgress?: (p: number) => void
  signal?: AbortSignal
  onAbort?: () => void
  slot?: Slot
}

interface Slot {
  worker: Worker
  job: Pending | null
  idle?: ReturnType<typeof setTimeout>
}

const IDLE_MS = 45_000

const abortError = () => new DOMException('Aborted', 'AbortError')

/** 這個環境能不能在 Worker 中使用 OffscreenCanvas 2D */
export function workersSupported(): boolean {
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return false
    const c = new OffscreenCanvas(1, 1)
    return !!c.getContext('2d') && typeof c.convertToBlob === 'function'
  } catch {
    return false
  }
}

/** 記憶體預算：裝置記憶體的 1/4，介於 384 MB 與 1.5 GB 之間 */
function memoryBudget(): number {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  return clamp(gb * 1024 ** 3 * 0.25, 384 * 1024 ** 2, 1.5 * 1024 ** 3)
}

export class ConvertPool {
  private slots: Slot[] = []
  private queue: Pending[] = []
  private memInUse = 0
  private inlineBusy = false
  private listeners = new Set<CodecListener>()
  readonly size: number
  readonly budget: number
  readonly useWorkers: boolean

  constructor() {
    this.useWorkers = workersSupported()
    this.size = this.useWorkers ? clamp(caps.hardwareConcurrency(), 1, 4) : 1
    this.budget = memoryBudget()
  }

  onCodec(fn: CodecListener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  convert(job: ConvertJob, opts: RunOpts = {}): Promise<ConvertResult> {
    const transfer: Transferable[] = job.bitmap ? [job.bitmap] : []
    return this.submit({ type: 'convert', job }, transfer, 1, opts) as Promise<ConvertResult>
  }

  thumb(job: Omit<ThumbJob, 'id'>, opts: RunOpts = {}): Promise<ThumbResult> {
    const full: ThumbJob = { ...job, id: uid('thumb') }
    const transfer: Transferable[] = full.bitmap ? [full.bitmap] : []
    return this.submit({ type: 'thumb', job: full }, transfer, 0, opts) as Promise<ThumbResult>
  }

  /** 正在執行與排隊中的工作數 */
  get load() {
    return this.queue.length + this.slots.filter((s) => s.job).length + (this.inlineBusy ? 1 : 0)
  }

  private submit(req: WorkerRequest, transfer: Transferable[], priority: number, opts: RunOpts) {
    return new Promise<ConvertResult | ThumbResult>((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(abortError())
        return
      }
      const p: Pending = {
        id: req.job.id,
        req,
        transfer,
        priority,
        mem: Math.max(0, opts.mem ?? 0),
        resolve,
        reject,
        onProgress: opts.onProgress,
        signal: opts.signal,
      }
      if (opts.signal) {
        p.onAbort = () => this.cancel(p)
        opts.signal.addEventListener('abort', p.onAbort, { once: true })
      }
      this.queue.push(p)
      this.pump()
    })
  }

  private finish(p: Pending) {
    if (p.signal && p.onAbort) p.signal.removeEventListener('abort', p.onAbort)
    this.memInUse = Math.max(0, this.memInUse - p.mem)
  }

  private cancel(p: Pending) {
    const qi = this.queue.indexOf(p)
    if (qi >= 0) {
      this.queue.splice(qi, 1)
      ;(p.req.job.bitmap as ImageBitmap | undefined)?.close()
      this.finish(p)
      p.reject(abortError())
      return
    }
    if (p.slot) {
      // WASM 編碼無法中途停止：直接關閉這個 Worker
      const slot = p.slot
      slot.worker.terminate()
      this.slots = this.slots.filter((s) => s !== slot)
      this.finish(p)
      p.reject(abortError())
      this.pump()
    }
  }

  private next(): Pending | null {
    if (!this.queue.length) return null
    // 優先度高（數字小）者先，同優先度先進先出
    let best = 0
    for (let i = 1; i < this.queue.length; i++)
      if (this.queue[i].priority < this.queue[best].priority) best = i
    const cand = this.queue[best]
    const running = this.slots.some((s) => s.job) || this.inlineBusy
    // 記憶體不夠時等其他工作完成（但至少要能跑一個）
    if (running && this.memInUse + cand.mem > this.budget) return null
    this.queue.splice(best, 1)
    return cand
  }

  private pump() {
    if (!this.useWorkers) {
      if (this.inlineBusy) return
      const p = this.next()
      if (!p) return
      this.inlineBusy = true
      this.memInUse += p.mem
      void this.runInline(p).finally(() => {
        this.inlineBusy = false
        this.pump()
      })
      return
    }
    for (;;) {
      let slot = this.slots.find((s) => !s.job)
      if (!slot && this.slots.length >= this.size) return
      const p = this.next()
      if (!p) return
      slot ??= this.spawn()
      if (slot.idle) clearTimeout(slot.idle)
      slot.job = p
      p.slot = slot
      this.memInUse += p.mem
      try {
        slot.worker.postMessage(p.req, p.transfer)
      } catch (e) {
        console.error(e)
        slot.job = null
        this.finish(p)
        p.reject(new EngineError('memory', String(e)))
      }
    }
  }

  private spawn(): Slot {
    const worker = new Worker(new URL('../../../workers/convert.worker.ts', import.meta.url), {
      type: 'module',
      name: 'convert',
    })
    const slot: Slot = { worker, job: null }
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(slot, e.data)
    worker.onerror = (e) => {
      // Worker 崩潰（多半是記憶體不足）：該工作失敗，換一個新的 Worker
      console.error(e)
      e.preventDefault()
      const p = slot.job
      worker.terminate()
      this.slots = this.slots.filter((s) => s !== slot)
      if (p) {
        this.finish(p)
        p.reject(new EngineError('crash', e.message))
      }
      this.pump()
    }
    this.slots.push(slot)
    return slot
  }

  private onMessage(slot: Slot, msg: WorkerResponse) {
    if (msg.type === 'codec') {
      this.listeners.forEach((fn) => fn(msg.codec, msg.loaded, msg.total, msg.done))
      return
    }
    const p = slot.job
    if (!p || p.id !== msg.id) return
    if (msg.type === 'progress') {
      p.onProgress?.(msg.value)
      return
    }
    slot.job = null
    this.finish(p)
    if (msg.type === 'error') p.reject(new EngineError(msg.code, msg.message))
    else p.resolve(msg.result)
    // 閒置一段時間後關閉
    slot.idle = setTimeout(() => {
      if (slot.job) return
      slot.worker.terminate()
      this.slots = this.slots.filter((s) => s !== slot)
    }, IDLE_MS)
    this.pump()
  }

  /** 主執行緒備援（不支援 OffscreenCanvas 的瀏覽器） */
  private async runInline(p: Pending) {
    try {
      const { convertImage, makeThumb, setCodecProgress } = await import('./pipeline')
      setCodecProgress((c, l, t, d) => this.listeners.forEach((fn) => fn(c, l, t, d)))
      if (p.signal?.aborted) throw abortError()
      const result =
        p.req.type === 'convert'
          ? await convertImage(p.req.job, (v) => p.onProgress?.(v))
          : await makeThumb(p.req.job)
      if (p.signal?.aborted) throw abortError()
      this.finish(p)
      p.resolve(result)
    } catch (e) {
      this.finish(p)
      p.reject(e)
    }
  }

  dispose() {
    this.queue.forEach((p) => p.reject(abortError()))
    this.queue = []
    this.slots.forEach((s) => s.worker.terminate())
    this.slots = []
  }
}

let pool: ConvertPool | null = null
export const getPool = () => (pool ??= new ConvertPool())
