/**
 * 圖片互轉的狀態（模組層級：離開頁面再回來，批次與結果仍在）。
 * 長時間作業一律透過呼叫端傳入的 useTask() run 函式登記到任務中心。
 */
import { create } from 'zustand'
import { probeFile, type ProbeResult } from './lib/probe'
import { computeOutputSize, fitPixels, type Size } from './lib/resize'
import { buildOutputName } from './lib/naming'
import { getPool } from './engine/pool'
import { decodeHeic, onHeicProgress, rasterizeSvg } from './engine/mainDecode'
import { loadOptions, optionsKey, saveOptions, type StoredOptions } from './options'
import {
  EngineError,
  FORMATS,
  type CodecId,
  type ConvertOptions,
  type EncoderId,
  type ErrorCode,
  type ExifOutcome,
  type WarningCode,
} from './types'
import { useSettings } from '@/stores/settings'
import { useRecents } from '@/stores/recents'
import { isAbortError, type TaskContext, type TaskResult } from '@/stores/tasks'
import { createDeduper } from '@/lib/filename'
import { fileKey, uid } from '@/lib/files'
import { t } from '@/i18n'

export type ItemStatus = 'idle' | 'queued' | 'running' | 'done' | 'error'

export interface ItemResult {
  blob: Blob
  url: string
  name: string
  size: number
  width: number
  height: number
  encoder: EncoderId
  quality?: number
  exif: ExifOutcome
  warnings: WarningCode[]
  /** 產生這個結果時的選項簽章 */
  key: string
  format: ConvertOptions['format']
  /** 動畫格數（逐格轉換時） */
  frames?: number
  at: number
}

export interface ConvertItem {
  id: string
  file: File
  name: string
  size: number
  probe: ProbeResult | null
  thumb?: { url: string; width: number; height: number }
  thumbState: 'pending' | 'ready' | 'error'
  status: ItemStatus
  progress: number
  error?: ErrorCode
  result?: ItemResult
}

export interface LoadState {
  state: 'idle' | 'loading' | 'ready' | 'error'
  loaded: number
  total: number
}

type RunTask = <T extends TaskResult[] | void>(
  name: string,
  fn: (ctx: TaskContext) => Promise<T>,
  opts?: { signal?: AbortSignal },
) => Promise<T>

interface ConvertState {
  items: ConvertItem[]
  options: StoredOptions
  running: boolean
  /** 最近一次批次的結果是否已下載或傳送（離開頁面提示用） */
  delivered: boolean
  heic: LoadState
  codecs: Partial<Record<CodecId, LoadState>>
  /** 最後一次加入檔案的時間（讓新卡片做進場動畫） */
  lastAddAt: number
  addFiles: (files: File[]) => { added: number; skipped: number }
  remove: (id: string) => void
  clear: () => void
  reorder: (items: ConvertItem[]) => void
  setOptions: (patch: Partial<StoredOptions>) => void
  convert: (run: RunTask, ids?: string[]) => Promise<void>
  /** 取消目前的批次 */
  cancel: () => void
  markDelivered: () => void
}

/** 目前批次的取消控制 */
let batch: AbortController | null = null

/** 每個項目的取消控制（移除項目時中斷它的工作） */
const controllers = new Map<string, AbortController>()
/** 每個項目最後一次收到真實進度的時間 */
const lastTick = new Map<string, number>()

const settingsQuality = () => useSettings.getState().imageQuality

/** 模板：使用者沒自訂時跟隨設定頁的檔名規則 */
export function effectiveTemplate(o: StoredOptions): string {
  return o.template ?? useSettings.getState().filenamePattern ?? '{name}_{action}'
}

export function fullOptions(o: StoredOptions): ConvertOptions {
  return { ...o, template: effectiveTemplate(o) }
}

/** 像素上限：一般 1 億像素；記憶體 2 GB 以下的裝置降為 5000 萬 */
export function maxPixels(): number {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return gb !== undefined && gb <= 2 ? 50_000_000 : 100_000_000
}

const revoke = (u?: string) => u && URL.revokeObjectURL(u)

export const useConvert = create<ConvertState>((set, get) => {
  const patch = (id: string, p: Partial<ConvertItem>) =>
    set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }))
  const find = (id: string) => get().items.find((x) => x.id === id)

  /** 檔頭辨識＋縮圖（縮圖走 Worker 池，優先於轉檔） */
  const prepare = async (id: string) => {
    const item = find(id)
    if (!item) return
    let probe: ProbeResult
    try {
      probe = await probeFile(item.file)
    } catch (e) {
      console.error(e)
      probe = { format: 'unknown' }
    }
    if (!find(id)) return
    patch(id, { probe })
    try {
      const pool = getPool()
      const srcSize = probe.width && probe.height ? { width: probe.width, height: probe.height } : undefined
      let res
      if (probe.format === 'heic') {
        const bitmap = await mainDecodeQueue(() => decodeHeic(item.file))
        if (!find(id)) {
          bitmap.close()
          return
        }
        res = await pool.thumb({ bitmap, source: probe.format, maxSide: 360 })
      } else if (probe.format === 'svg') {
        const s = srcSize ? fitBox(srcSize, 720) : undefined
        const bitmap = await rasterizeSvg(item.file, s, 720)
        res = await pool.thumb({ bitmap, source: probe.format, maxSide: 360 })
      } else {
        res = await pool.thumb({ file: item.file, source: probe.format, srcSize, maxSide: 360 })
      }
      if (!find(id)) return
      const url = URL.createObjectURL(new Blob([res.buffer], { type: res.mime }))
      patch(id, {
        thumb: { url, width: res.width, height: res.height },
        thumbState: 'ready',
        probe: { ...probe, width: probe.width ?? res.srcWidth, height: probe.height ?? res.srcHeight },
      })
    } catch (e) {
      if (!find(id)) return
      console.error(e)
      const code = e instanceof EngineError ? e.code : 'decode'
      // 無法解碼的檔案直接標成錯誤，避免轉換時才失敗
      patch(id, {
        thumbState: 'error',
        ...(code === 'decode' || code === 'unsupported' || code === 'heic-load'
          ? { status: 'error' as const, error: code }
          : {}),
      })
    }
  }

  /** 轉換一個項目 */
  const convertOne = async (
    id: string,
    opts: ConvertOptions,
    key: string,
    batchSignal: AbortSignal,
    onProgress: (p: number) => void,
  ): Promise<ItemResult | null> => {
    const item = find(id)
    if (!item) return null
    const ctl = new AbortController()
    controllers.get(id)?.abort()
    controllers.set(id, ctl)
    const onBatchAbort = () => ctl.abort()
    batchSignal.addEventListener('abort', onBatchAbort, { once: true })
    patch(id, { status: 'queued', progress: 0, error: undefined })
    try {
      const probe = item.probe ?? (await probeFile(item.file))
      const srcSize = probe.width && probe.height ? { width: probe.width, height: probe.height } : undefined
      const out = srcSize ? computeOutputSize(srcSize, opts.resize) : null

      /** 一次轉換嘗試；limit 為像素上限（記憶體不足時會以較小的上限重試） */
      const attempt = async (limit: number) => {
        let bitmap: ImageBitmap | undefined
        let preScaled = false
        let release: (() => void) | null = null
        try {
          if (probe.format === 'heic' || probe.format === 'svg') {
            // 主執行緒解碼：最多同時兩張，避免記憶體暴增
            release = await mainSlots.acquire()
            if (ctl.signal.aborted) throw new DOMException('Aborted', 'AbortError')
            patch(id, { status: 'running', progress: 0.02 })
            if (probe.format === 'heic') bitmap = await decodeHeic(item.file)
            else {
              const base = srcSize ?? { width: 1024, height: 1024 }
              const target =
                opts.format === 'ico'
                  ? fitBox(base, Math.max(...opts.icoSizes, 16), true)
                  : fitPixels(computeOutputSize(base, opts.resize), limit)
              bitmap = await rasterizeSvg(item.file, srcSize ? target : undefined)
              preScaled = !!srcSize && opts.format !== 'ico'
            }
          }
          const srcPx = srcSize ? Math.min(srcSize.width * srcSize.height, limit) : 16_000_000
          const outPx = out ? Math.min(out.width * out.height, limit) : srcPx
          return await getPool().convert(
            {
              id: uid('job'),
              file: item.file,
              bitmap,
              preScaled,
              source: probe.format,
              animated: !!probe.animated,
              srcSize,
              options: opts,
              limits: { maxPixels: limit },
            },
            {
              signal: ctl.signal,
              mem: srcPx * 4 + outPx * 12,
              onProgress: (p) => {
                lastTick.set(id, performance.now())
                const cur = find(id)?.progress ?? 0
                const v = Math.max(cur, p)
                patch(id, { status: 'running', progress: v })
                onProgress(v)
              },
            },
          )
        } finally {
          release?.()
        }
      }

      const limit = maxPixels()
      let r
      try {
        r = await attempt(limit)
      } catch (e) {
        // 記憶體不足（或 Worker 因此中斷）：自動以四分之一像素重試一次，而不是直接失敗
        if (!(e instanceof EngineError) || (e.code !== 'memory' && e.code !== 'crash') || ctl.signal.aborted) throw e
        console.error(e)
        const px = srcSize ? srcSize.width * srcSize.height : limit
        const lower = Math.max(4_000_000, Math.floor(Math.min(px, limit) / 4))
        if (lower >= px) throw e
        r = await attempt(lower)
        r = { ...r, warnings: [...r.warnings.filter((w) => w !== 'downscaled-pixels'), 'memory-retry' as const] }
      }
      const warnings = [...r.warnings]
      if (
        probe.animated &&
        !warnings.includes('first-frame') &&
        !(FORMATS[opts.format].animation && opts.keepAnimation && r.frames && r.frames > 1)
      )
        warnings.push('first-frame')
      const blob = new Blob([r.buffer], { type: r.mime })
      const prev = find(id)?.result
      const result: ItemResult = {
        blob,
        url: URL.createObjectURL(blob),
        name: '',
        size: blob.size,
        width: r.width,
        height: r.height,
        encoder: r.encoder,
        quality: r.quality,
        exif: r.exif,
        warnings,
        key,
        format: opts.format,
        frames: r.frames,
        at: Date.now(),
      }
      if (!find(id)) {
        revoke(result.url)
        return null
      }
      result.name = nameFor(id, result, opts.template)
      revoke(prev?.url)
      patch(id, { status: 'done', progress: 1, result, error: undefined })
      onProgress(1)
      return result
    } catch (e) {
      if (isAbortError(e) || ctl.signal.aborted) {
        if (find(id)) patch(id, { status: find(id)?.result ? 'done' : 'idle', progress: 0 })
        throw e
      }
      console.error(e)
      const code: ErrorCode = e instanceof EngineError ? e.code : 'unknown'
      patch(id, { status: 'error', error: code, progress: 0 })
      onProgress(1)
      return null
    } finally {
      batchSignal.removeEventListener('abort', onBatchAbort)
      if (controllers.get(id) === ctl) controllers.delete(id)
    }
  }

  /** 依模板命名，並與其他結果去重 */
  const nameFor = (id: string, r: Pick<ItemResult, 'width' | 'height' | 'quality' | 'format'>, template: string) => {
    const items = get().items
    const idx = items.findIndex((x) => x.id === id)
    const dedupe = createDeduper(items.filter((x) => x.id !== id && x.result?.name).map((x) => x.result!.name))
    return dedupe(
      buildOutputName(template, {
        original: items[idx]?.name ?? 'image',
        action: t('convert.naming.action'),
        width: r.width,
        height: r.height,
        format: FORMATS[r.format].ext,
        quality: r.quality,
        index: idx + 1,
        total: items.length,
        date: new Date(),
      }),
    )
  }

  /** 模板變更或順序變更時，依清單順序重新命名所有結果 */
  const renameAll = () => {
    const { items, options } = get()
    const template = effectiveTemplate(options)
    const dedupe = createDeduper()
    let changed = false
    const next = items.map((it, i) => {
      if (!it.result) return it
      const name = dedupe(
        buildOutputName(template, {
          original: it.name,
          action: t('convert.naming.action'),
          width: it.result.width,
          height: it.result.height,
          format: FORMATS[it.result.format].ext,
          quality: it.result.quality,
          index: i + 1,
          total: items.length,
          date: new Date(it.result.at),
        }),
      )
      if (name === it.result.name) return it
      changed = true
      return { ...it, result: { ...it.result, name } }
    })
    if (changed) set({ items: next })
  }

  // 載入進度：HEIC 解碼器與進階編碼器
  onHeicProgress((state, loaded, total) => set({ heic: { state, loaded, total } }))
  getPool().onCodec((codec, loaded, total, done) =>
    set((s) => ({ codecs: { ...s.codecs, [codec]: { state: done ? 'ready' : 'loading', loaded, total } } })),
  )

  return {
    items: [],
    options: loadOptions(settingsQuality()),
    running: false,
    delivered: true,
    heic: { state: 'idle', loaded: 0, total: 0 },
    codecs: {},
    lastAddAt: 0,

    addFiles: (files) => {
      const existing = new Set(get().items.map((x) => fileKey(x.file)))
      const fresh: ConvertItem[] = []
      let skipped = 0
      for (const f of files) {
        const k = fileKey(f)
        if (existing.has(k)) {
          skipped++
          continue
        }
        existing.add(k)
        fresh.push({
          id: uid('img'),
          file: f,
          name: f.name || 'image',
          size: f.size,
          probe: null,
          thumbState: 'pending',
          status: 'idle',
          progress: 0,
        })
      }
      if (!fresh.length) return { added: 0, skipped }
      set((s) => ({ items: [...s.items, ...fresh], lastAddAt: Date.now() }))
      useRecents.getState().visit('convert', fresh[0].name)
      fresh.forEach((it) => void prepare(it.id))
      return { added: fresh.length, skipped }
    },

    remove: (id) => {
      controllers.get(id)?.abort()
      const it = find(id)
      revoke(it?.thumb?.url)
      revoke(it?.result?.url)
      set((s) => ({ items: s.items.filter((x) => x.id !== id) }))
      renameAll()
    },

    clear: () => {
      controllers.forEach((c) => c.abort())
      controllers.clear()
      get().items.forEach((it) => {
        revoke(it.thumb?.url)
        revoke(it.result?.url)
      })
      set({ items: [], delivered: true })
    },

    reorder: (items) => {
      set({ items })
      renameAll()
    },

    setOptions: (p) => {
      const options = { ...get().options, ...p }
      set({ options })
      saveOptions(options)
      if ('template' in p) renameAll()
    },

    markDelivered: () => set({ delivered: true }),

    cancel: () => batch?.abort(),

    convert: async (run, ids) => {
      if (get().running) return
      const opts = fullOptions(get().options)
      const key = optionsKey(opts)
      const targets = (ids ?? get().items.map((x) => x.id)).filter((id) => {
        const it = find(id)
        if (!it) return false
        // 已用相同設定完成的不再轉換（除非明確指定）
        if (!ids && it.status === 'done' && it.result?.key === key) return false
        if (!ids && it.status === 'error' && (it.error === 'decode' || it.error === 'unsupported')) return false
        return true
      })
      if (!targets.length) return
      set({ running: true })
      const ctl = new AbortController()
      batch = ctl
      const progress = new Map<string, number>()
      // WASM 編碼期間 Worker 無法回報進度：沒有新進度時讓進度條緩慢前進（不超過 90%），避免看起來卡住
      const creep = setInterval(() => {
        const now = performance.now()
        for (const it of get().items) {
          if (it.status !== 'running' || it.progress < 0.03 || it.progress >= 0.9) continue
          if (now - (lastTick.get(it.id) ?? now) < 600) continue
          const v = it.progress + (0.9 - it.progress) * 0.025
          patch(it.id, { progress: v })
          if (progress.has(it.id)) {
            progress.set(it.id, v)
            tickAll()
          }
        }
      }, 250)
      let tickAll = () => {}
      targets.forEach((id) => patch(id, { status: 'queued', progress: 0, error: undefined }))
      const name =
        targets.length === 1
          ? t('convert.task.one', { name: find(targets[0])?.name ?? '' })
          : t('convert.task.many', { count: targets.length, format: FORMATS[opts.format].ext.toUpperCase() })
      try {
        await run(name, async ({ signal, progress: report }) => {
          const tick = () => report([...progress.values()].reduce((a, b) => a + b, 0) / targets.length)
          tickAll = tick
          const results = await Promise.all(
            targets.map((id) =>
              convertOne(id, opts, key, signal, (p) => {
                progress.set(id, p)
                tick()
              }).catch((e) => {
                if (isAbortError(e)) return null
                throw e
              }),
            ),
          )
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          const ok = results.filter((r): r is ItemResult => !!r)
          if (!ok.length) throw new Error(t('convert.errors.allFailed'))
          set({ delivered: false })
          return ok.map((r) => ({ blob: r.blob, name: r.name }))
        }, { signal: ctl.signal })
      } catch (e) {
        if (!isAbortError(e)) console.error(e)
      } finally {
        clearInterval(creep)
        if (batch === ctl) batch = null
        set({ running: false })
        // 被取消的項目回到待轉換
        set((s) => ({
          items: s.items.map((it) =>
            it.status === 'queued' || it.status === 'running'
              ? { ...it, status: it.result ? 'done' : 'idle', progress: 0 }
              : it,
          ),
        }))
      }
    },
  }
})

/** 等比放進 max×max（只縮不放，square=true 時允許放大） */
function fitBox(s: Size, max: number, allowUp = false): Size {
  const k = Math.min(allowUp ? Infinity : 1, max / Math.max(s.width, s.height))
  return { width: Math.max(1, Math.round(s.width * k)), height: Math.max(1, Math.round(s.height * k)) }
}

/** 主執行緒解碼的同時數量限制 */
class Slots {
  private free: number
  private waiters: Array<() => void> = []
  constructor(n: number) {
    this.free = n
  }
  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.free--
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.free++
          this.waiters.shift()?.()
        })
      }
      if (this.free > 0) grant()
      else this.waiters.push(grant)
    })
  }
}
const mainSlots = new Slots(2)

/** 縮圖用的 HEIC 解碼一次一張 */
let mainChain: Promise<unknown> = Promise.resolve()
function mainDecodeQueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = mainChain.then(fn, fn)
  mainChain = p.catch(() => undefined)
  return p
}

/** 選項簽章（給元件判斷結果是否過期） */
export const currentKey = (o: StoredOptions) => optionsKey(o)

/** 項目的結果是否與目前設定相符 */
export const isFresh = (it: ConvertItem, key: string) => it.status === 'done' && it.result?.key === key
