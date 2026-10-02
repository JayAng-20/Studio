/**
 * 主執行緒的編碼流程：產生影格（seek／繪製）→ 交給 Worker 池量化／壓縮 → 依序組裝。
 * 可取消（AbortSignal）；取消或出錯時一律終止所有 Worker。
 */
import type { WorkerRequest, WorkerResponse } from './protocol'
import { samplePixels, type DitherMode, type Palette } from './dither'
import {
  alignEven,
  buildAnimatedWebp,
  buildApng,
  changedRect,
  cropRgba,
  type ApngFrame,
  type WebpFrame,
} from './containers'
import { repeatField } from './timeline'
import type { OutputFormat, PaletteMode } from './settings'

const abortError = () => new DOMException('aborted', 'AbortError')

type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never
type Ok<T extends string> = Extract<WorkerResponse, { ok: true; type: T }>

/** Worker 池：worker 0 保留給組裝器，其餘做量化／壓縮 */
export class WorkerPool {
  private workers: Worker[] = []
  private load: number[] = []
  private seq = 0
  private waiting = new Map<
    number,
    { resolve: (r: WorkerResponse) => void; reject: (e: unknown) => void; w: number }
  >()
  private isDead = false

  constructor(size: number) {
    for (let i = 0; i < Math.max(2, size); i++) {
      const w = new Worker(new URL('../../workers/gif.worker.ts', import.meta.url), {
        type: 'module',
        name: `gif-${i}`,
      })
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const p = this.waiting.get(e.data.id)
        if (!p) return
        this.waiting.delete(e.data.id)
        this.load[p.w]--
        if (e.data.ok) p.resolve(e.data)
        else p.reject(new Error(e.data.error))
      }
      w.onerror = (e) => {
        console.error(e)
        this.failAll(new Error('worker crashed'))
      }
      this.workers.push(w)
      this.load.push(0)
    }
  }

  get dead() {
    return this.isDead
  }

  get size() {
    return this.workers.length - 1
  }

  /** 送出請求；worker 未指定時挑負載最低的運算 worker */
  call<T extends string>(
    req: Req,
    transfer: Transferable[] = [],
    worker?: number,
  ): Promise<Ok<T>> {
    if (this.isDead) return Promise.reject(abortError())
    const id = ++this.seq
    let w = worker ?? -1
    if (w < 0) {
      w = 1
      for (let i = 2; i < this.workers.length; i++) if (this.load[i] < this.load[w]) w = i
    }
    this.load[w]++
    return new Promise<Ok<T>>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (r: WorkerResponse) => void, reject, w })
      this.workers[w].postMessage({ ...req, id } as WorkerRequest, transfer)
    })
  }

  inFlight() {
    return this.waiting.size
  }

  private failAll(e: unknown) {
    this.waiting.forEach((p) => p.reject(e))
    this.waiting.clear()
    this.load.fill(0)
  }

  terminate() {
    if (this.isDead) return
    this.isDead = true
    this.workers.forEach((w) => w.terminate())
    this.failAll(abortError())
  }
}

export const poolSize = () =>
  Math.max(1, Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) - 1 || 2))

export interface EncodeConfig {
  format: OutputFormat
  width: number
  height: number
  colors: number
  dither: DitherMode
  palette: PaletteMode
  optimize: boolean
  tolerance: number
  /** 真透明（色鍵去背） */
  transparent: boolean
  loop: 'infinite' | number
  webpQuality: number
  webpLossless: boolean
}

export interface FeedFrame {
  rgba: Uint8ClampedArray
  delayCs: number
}

export interface FrameFeed {
  count: number
  frame(i: number, signal: AbortSignal): Promise<FeedFrame>
}

export type EncodePhase = 'extract' | 'palette' | 'encode' | 'finalize'

export interface EncodeProgress {
  phase: EncodePhase
  /** 0–1 整體進度 */
  value: number
  /** 正在處理的影格（0 起算） */
  frame: number
  total: number
}

export interface EncodeOutput {
  bytes: Uint8Array
  /** 每個輸入影格實際寫入的位元組（合併的影格為 0） */
  frameSizes: number[]
  /** 實際寫入的影格數（相同影格會合併） */
  frames: number
}

function check(signal: AbortSignal) {
  if (signal.aborted) throw abortError()
}

/** 依格式編碼一串影格 */
export async function encodeSequence(
  pool: WorkerPool,
  cfg: EncodeConfig,
  feed: FrameFeed,
  signal: AbortSignal,
  onProgress?: (p: EncodeProgress) => void,
): Promise<EncodeOutput> {
  const onAbort = () => pool.terminate()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    check(signal)
    if (cfg.format === 'gif') return await encodeGif(pool, cfg, feed, signal, onProgress)
    return await encodeFull(pool, cfg, feed, signal, onProgress)
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

async function encodeGif(
  pool: WorkerPool,
  cfg: EncodeConfig,
  feed: FrameFeed,
  signal: AbortSignal,
  onProgress?: (p: EncodeProgress) => void,
): Promise<EncodeOutput> {
  const n = feed.count
  const reserve = cfg.transparent || cfg.optimize
  const global = cfg.palette === 'global'
  const maxInFlight = Math.max(2, pool.size * 2)
  let extracted = 0
  let encoded = 0
  // 全域調色盤：擷取佔 50%、量化與組裝佔 50%；每格調色盤：擷取與編碼同時進行
  const report = (phase: EncodePhase, frame: number) => {
    const value = global
      ? phase === 'extract'
        ? (extracted / n) * 0.5
        : phase === 'palette'
          ? 0.5
          : 0.52 + (encoded / n) * 0.47
      : (extracted + encoded) / (2 * n)
    onProgress?.({ phase, value: Math.min(0.99, value), frame, total: n })
  }

  let palette: Palette | null = null
  let buffered: FeedFrame[] | null = null
  if (global) {
    buffered = []
    for (let i = 0; i < n; i++) {
      check(signal)
      buffered.push(await feed.frame(i, signal))
      extracted++
      report('extract', i)
    }
    report('palette', 0)
    const samples = samplePixels(
      buffered.map((f) => f.rgba),
      600_000,
    )
    const r = await pool.call<'palette'>(
      { type: 'palette', samples: samples.buffer as ArrayBuffer, colors: cfg.colors, reserve },
      [samples.buffer],
    )
    palette = r.palette
  }

  await pool.call<'gif-begin'>(
    {
      type: 'gif-begin',
      width: cfg.width,
      height: cfg.height,
      repeat: repeatField(cfg.loop),
      global: palette,
      diff: cfg.optimize && !cfg.transparent,
      tolerance: cfg.tolerance,
      transparent: cfg.transparent,
    },
    [],
    0,
  )

  let chain: Promise<unknown> = Promise.resolve()
  const done: Promise<unknown>[] = []
  for (let i = 0; i < n; i++) {
    check(signal)
    // 背壓：太多影格在路上時先等前面的組裝完
    if (i >= maxInFlight) await done[i - maxInFlight]
    const f = buffered ? buffered[i] : await feed.frame(i, signal)
    if (buffered) buffered[i] = undefined as unknown as FeedFrame
    if (!global) {
      extracted++
      report('extract', i)
    }
    const buf = f.rgba.buffer as ArrayBuffer
    const q = pool.call<'quantize'>(
      {
        type: 'quantize',
        rgba: buf,
        width: cfg.width,
        height: cfg.height,
        colors: cfg.colors,
        dither: cfg.dither,
        palette,
        reserve,
      },
      [buf],
    )
    // 前面的影格失敗或取消時，這一格可能永遠不會被 await，先吃掉拒絕避免未處理的例外
    q.catch(() => undefined)
    const delayCs = f.delayCs
    chain = chain.then(async () => {
      const r = await q
      check(signal)
      await pool.call<'gif-frame'>(
        {
          type: 'gif-frame',
          index: r.index,
          palette: r.palette,
          transparentIndex: r.transparentIndex,
          delayCs,
        },
        [r.index],
        0,
      )
      encoded++
      report('encode', i)
    })
    done.push(chain)
    // 避免未處理的拒絕在迴圈中途冒出
    chain.catch(() => undefined)
  }
  await chain
  check(signal)
  onProgress?.({ phase: 'finalize', value: 0.995, frame: n - 1, total: n })
  const end = await pool.call<'gif-end'>({ type: 'gif-end' }, [], 0)
  return { bytes: new Uint8Array(end.bytes), frameSizes: end.frameSizes, frames: end.frames }
}

/** APNG／WebP：全彩、只寫變化的子矩形 */
async function encodeFull(
  pool: WorkerPool,
  cfg: EncodeConfig,
  feed: FrameFeed,
  signal: AbortSignal,
  onProgress?: (p: EncodeProgress) => void,
): Promise<EncodeOutput> {
  const n = feed.count
  const W = cfg.width
  const H = cfg.height
  const apng = cfg.format === 'apng'
  const colorType: 2 | 6 = cfg.transparent ? 6 : 2
  const maxInFlight = Math.max(2, pool.size * 2)
  type Slot = {
    x: number
    y: number
    w: number
    h: number
    delayCs: number
    order: number
    data?: Uint8Array
    hasAlpha?: boolean
  }
  const slots: Slot[] = []
  const frameSizes: number[] = new Array(n).fill(0)
  const jobs: Promise<void>[] = []
  let prev: Uint8ClampedArray | null = null
  let extracted = 0
  let encoded = 0
  const report = (phase: EncodePhase, frame: number) =>
    onProgress?.({
      phase,
      value: Math.min(0.99, (extracted + encoded) / (2 * n)),
      frame,
      total: n,
    })

  for (let i = 0; i < n; i++) {
    check(signal)
    if (jobs.length >= maxInFlight) await jobs[jobs.length - maxInFlight]
    const f = await feed.frame(i, signal)
    extracted++
    let rect = { x: 0, y: 0, w: W, h: H }
    // 真透明時每格整張重畫（覆蓋模式才不會殘留前一格）
    if (prev && !cfg.transparent) {
      const r = changedRect(prev, f.rgba, W, H)
      if (!r) {
        // 與前一格完全相同：延長前一格
        slots[slots.length - 1].delayCs += f.delayCs
        encoded++
        report('encode', i)
        continue
      }
      rect = apng ? r : alignEven(r, W, H)
    }
    const full = rect.w === W && rect.h === H
    const pixels = full ? f.rgba.slice() : cropRgba(f.rgba, W, rect)
    prev = f.rgba
    const slot: Slot = { ...rect, delayCs: f.delayCs, order: i }
    slots.push(slot)
    report('extract', i)
    const buf = pixels.buffer as ArrayBuffer
    const job = apng
      ? pool
          .call<'deflate'>(
            { type: 'deflate', rgba: buf, width: rect.w, height: rect.h, colorType },
            [buf],
          )
          .then((r) => {
            slot.data = new Uint8Array(r.data)
          })
      : pool
          .call<'webp'>(
            {
              type: 'webp',
              rgba: buf,
              width: rect.w,
              height: rect.h,
              quality: cfg.webpQuality,
              lossless: cfg.webpLossless,
            },
            [buf],
          )
          .then((r) => {
            slot.data = new Uint8Array(r.chunks)
            slot.hasAlpha = r.hasAlpha
          })
    const tracked = job.then(() => {
      encoded++
      report('encode', i)
    })
    tracked.catch(() => undefined)
    jobs.push(tracked)
  }
  await Promise.all(jobs)
  check(signal)
  onProgress?.({ phase: 'finalize', value: 0.995, frame: n - 1, total: n })
  const plays = cfg.loop === 'infinite' ? 0 : Math.max(1, Math.round(cfg.loop))
  let bytes: Uint8Array
  if (apng) {
    const frames: ApngFrame[] = slots.map((s) => ({
      x: s.x,
      y: s.y,
      width: s.w,
      height: s.h,
      delayNum: s.delayCs,
      delayDen: 100,
      data: s.data!,
    }))
    slots.forEach((s) => (frameSizes[s.order] = s.data!.length + 26 + 12 + 4))
    bytes = buildApng(W, H, plays, frames, colorType)
  } else {
    const frames: WebpFrame[] = slots.map((s) => ({
      x: s.x,
      y: s.y,
      width: s.w,
      height: s.h,
      durationMs: s.delayCs * 10,
      payload: { chunks: s.data!, hasAlpha: !!s.hasAlpha },
    }))
    slots.forEach((s) => (frameSizes[s.order] = s.data!.length + 24))
    bytes = buildAnimatedWebp(W, H, plays, frames)
  }
  return { bytes, frameSizes, frames: slots.length }
}

/**
 * 大小預估：每組樣本是兩張相鄰影格，實際編碼後取
 * 第一格（完整畫面＋檔頭）與第二格（差異）的平均大小。
 */
export async function sampleStats(
  pool: WorkerPool,
  cfg: EncodeConfig,
  pairs: Array<[Uint8ClampedArray, Uint8ClampedArray]>,
  signal: AbortSignal,
): Promise<{ fullAvg: number; deltaAvg: number }> {
  let full = 0
  let delta = 0
  for (const pair of pairs) {
    check(signal)
    const feed: FrameFeed = {
      count: 2,
      frame: async (i) => ({ rgba: pair[i].slice(), delayCs: 10 }),
    }
    // 樣本只有兩格，用每格調色盤估算會比全域略大，這裡維持使用者的設定
    const out = await encodeSequence(pool, cfg, feed, signal)
    full += out.frameSizes[0]
    delta += out.frameSizes[1]
  }
  const k = Math.max(1, pairs.length)
  return { fullAvg: full / k, deltaAvg: delta / k }
}
