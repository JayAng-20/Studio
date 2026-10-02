/** GIF 製作的 React hooks：影格計畫、輸出幾何、膠卷縮圖、圖片解碼、即時預估 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useGifStore, type Source, type VideoSource } from './store'
import { autoPlan, createFeed } from './feed'
import { outputSize, type Geometry } from './render'
import { VideoGrabber, decodeImages } from './source'
import { WorkerPool, sampleStats, type EncodeConfig } from './encoder'
import { headerBytes, projectSize, type SampleStats } from './estimate'
import type { PlanItem } from './settings'
import { totalDuration } from './timeline'

/** 目前使用的影格計畫（自訂優先） */
export function usePlan(): { plan: PlanItem[]; custom: boolean } {
  const source = useGifStore((s) => s.source)
  const range = useGifStore((s) => s.range)
  const fps = useGifStore((s) => s.settings.fps)
  const speed = useGifStore((s) => s.settings.speed)
  const reverse = useGifStore((s) => s.settings.reverse)
  const pingpong = useGifStore((s) => s.settings.pingpong)
  const custom = useGifStore((s) => s.customPlan)
  const auto = useMemo(
    () => autoPlan(source, range, { fps, speed, reverse, pingpong }),
    [source, range, fps, speed, reverse, pingpong],
  )
  return { plan: custom ?? auto, custom: !!custom }
}

/** 基準畫面尺寸：影片尺寸，或圖片模式第一張圖的尺寸 */
export function baseSize(source: Source | null): { w: number; h: number } {
  if (!source) return { w: 16, h: 9 }
  if (source.kind === 'video') return { w: source.width, h: source.height }
  const first = source.items[0]
  return first ? { w: first.width, h: first.height } : { w: 16, h: 9 }
}

export function useGeometry(): Geometry {
  const source = useGifStore((s) => s.source)
  const crop = useGifStore((s) => s.crop)
  const width = useGifStore((s) => s.settings.width)
  const fit = useGifStore((s) => s.settings.fit)
  const background = useGifStore((s) => s.settings.background)
  return useMemo(() => {
    const b = baseSize(source)
    const o = outputSize(b.w, b.h, crop, width)
    return {
      baseW: b.w,
      baseH: b.h,
      crop,
      outW: o.w,
      outH: o.h,
      fit,
      background: source?.kind === 'images' ? background : null,
    }
  }, [source, crop, width, fit, background])
}

export interface Thumb {
  t: number
  url: string
  /** 與前一張間隔很短（一起到齊），進場時需要交錯延遲 */
  burst?: boolean
}

/**
 * 膠卷縮圖：隱藏的 <video> 依序 seek、畫到小畫布，逐張回報（不卡 UI，可取消）。
 * 每張之間讓出主執行緒一次。
 */
export function useFilmstrip(video: VideoSource | null, count: number, thumbH = 56) {
  const [thumbs, setThumbs] = useState<Thumb[]>([])
  const [prevKey, setPrevKey] = useState('')
  const key = video ? `${video.url}|${count}` : ''
  if (key !== prevKey) {
    setPrevKey(key)
    setThumbs([])
  }
  useEffect(() => {
    if (!video || count <= 0) return
    const ac = new AbortController()
    const urls: string[] = []
    let grabber = new VideoGrabber(video.url, video.duration)
    const h = thumbH * Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round((h * video.width) / video.height))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ;(async () => {
      let last = performance.now()
      for (let i = 0; i < count; i++) {
        if (ac.signal.aborted) return
        const t = ((i + 0.5) / count) * video.duration
        // 機器忙碌（例如同時在編碼）時 seek 可能逾時：換一個新的 <video> 重試，仍失敗就略過這張
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const v = await grabber.seek(t, ac.signal)
            ctx?.drawImage(v, 0, 0, w, h)
            const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.72))
            if (!blob || ac.signal.aborted) return
            const url = URL.createObjectURL(blob)
            urls.push(url)
            const now = performance.now()
            const burst = now - last < 16
            last = now
            setThumbs((prev) => {
              const next = [...prev]
              next[i] = { t, url, burst }
              return next
            })
            break
          } catch (e) {
            if ((e as Error)?.name === 'AbortError' || ac.signal.aborted) return
            grabber.dispose()
            grabber = new VideoGrabber(video.url, video.duration)
            if (attempt === 2) console.warn('[gif] 略過一張膠卷縮圖', e)
          }
        }
        // 讓出主執行緒，避免連續 seek 卡住互動
        await new Promise((r) => setTimeout(r, 0))
      }
    })()
    return () => {
      ac.abort()
      grabber.dispose()
      canvas.width = 0
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [video, count, thumbH])
  return thumbs
}

/** 圖片模式的解碼結果（預覽用），依 items 順序對應 */
export function useImageBitmaps(source: Source | null) {
  const [map, setMap] = useState<Map<string, ImageBitmap>>(() => new Map())
  const items = source?.kind === 'images' ? source.items : null
  const cache = useRef(new Map<string, ImageBitmap>())
  useEffect(() => {
    const c = cache.current
    if (!items) return
    const ac = new AbortController()
    const keep = new Set(items.map((i) => i.id))
    // 釋放已移除的圖片
    for (const [id, b] of c) {
      if (!keep.has(id)) {
        b.close()
        c.delete(id)
      }
    }
    const missing = items.filter((i) => !c.has(i.id))
    ;(async () => {
      if (missing.length) {
        try {
          const { bitmaps } = await decodeImages(
            missing.map((m) => m.file),
            ac.signal,
          )
          if (ac.signal.aborted) {
            bitmaps.forEach((b) => b?.close())
            return
          }
          missing.forEach((m, i) => {
            const b = bitmaps[i]
            if (b) c.set(m.id, b)
          })
        } catch (e) {
          if ((e as Error)?.name !== 'AbortError') console.error(e)
          return
        }
      }
      setMap(new Map(c))
    })()
    return () => ac.abort()
  }, [items])
  useEffect(() => {
    const c = cache.current
    return () => {
      c.forEach((b) => b.close())
      c.clear()
    }
  }, [])
  return items ? items.map((i) => map.get(i.id) ?? null) : []
}

export interface EstimateState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  stats: SampleStats | null
  bytes: number
}

/**
 * 即時預估：參數改變後（防抖）取樣三組相鄰影格，在 Worker 實際編碼，推估總大小。
 */
export function useEstimate(plan: PlanItem[], geom: Geometry, enabled: boolean): EstimateState {
  const source = useGifStore((s) => s.source)
  const settings = useGifStore((s) => s.settings)
  const texts = useGifStore((s) => s.texts)
  const chroma = useGifStore((s) => s.chroma)
  const [state, setState] = useState<EstimateState & { key: string }>({
    status: 'idle',
    stats: null,
    bytes: 0,
    key: '',
  })
  const pool = useRef<WorkerPool | null>(null)
  const grabber = useRef<{ url: string; g: VideoGrabber } | null>(null)

  // 卸載時釋放
  useEffect(
    () => () => {
      pool.current?.terminate()
      pool.current = null
      grabber.current?.g.dispose()
      grabber.current = null
    },
    [],
  )

  const cfgKey = JSON.stringify({
    format: settings.format,
    colors: settings.colors,
    dither: settings.dither,
    palette: settings.palette,
    optimize: settings.optimize,
    tolerance: settings.tolerance,
    q: settings.webpQuality,
    l: settings.webpLossless,
    w: geom.outW,
    h: geom.outH,
    crop: geom.crop,
    fit: geom.fit,
    bg: geom.background,
    texts,
    chroma,
  })
  // 只取樣三組，計畫的細節只影響挑哪幾格
  const sampleIdx = useMemo(() => {
    const n = plan.length
    if (n === 0) return []
    if (n === 1) return [[0, 0]]
    const picks = Array.from(new Set([0, Math.floor((n - 1) / 2), Math.max(0, n - 2)]))
    return picks.map((i) => [i, Math.min(n - 1, i + 1)])
  }, [plan])
  const samplePlan = useMemo(
    () => sampleIdx.flat().map((i) => plan[i]),
    [sampleIdx, plan],
  )
  const sampleKey = JSON.stringify(samplePlan.map((p) => [p.src, p.delayCs]))

  const fullKey = `${cfgKey}|${sampleKey}|${source ? (source.kind === 'video' ? source.url : source.items.length) : ''}`
  useEffect(() => {
    if (!enabled || !source || !samplePlan.length) return
    const ac = new AbortController()
    let feedDispose: (() => void) | null = null
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, status: 'loading' }))
      try {
        if (!pool.current || pool.current.dead) pool.current = new WorkerPool(2)
        if (source.kind === 'video') {
          if (grabber.current?.url !== source.url) {
            grabber.current?.g.dispose()
            grabber.current = { url: source.url, g: new VideoGrabber(source.url, source.duration) }
          }
        }
        const s = useGifStore.getState()
        const feed = await createFeed(
          {
            source,
            plan: samplePlan,
            geom,
            texts: s.texts,
            chroma: s.chroma,
            grabber: source.kind === 'video' ? grabber.current!.g : undefined,
          },
          ac.signal,
        )
        feedDispose = feed.dispose
        const frames: Uint8ClampedArray[] = []
        for (let i = 0; i < feed.count; i++) frames.push((await feed.frame(i, ac.signal)).rgba)
        feed.dispose()
        feedDispose = null
        const pairs: Array<[Uint8ClampedArray, Uint8ClampedArray]> = []
        for (let i = 0; i + 1 < frames.length; i += 2) pairs.push([frames[i], frames[i + 1]])
        const cfg: EncodeConfig = {
          format: s.settings.format,
          width: geom.outW,
          height: geom.outH,
          colors: s.settings.colors,
          dither: s.settings.dither,
          palette: s.settings.palette,
          optimize: s.settings.optimize,
          tolerance: s.settings.tolerance,
          transparent: s.chroma.enabled,
          loop: s.settings.loop,
          webpQuality: s.settings.webpQuality,
          webpLossless: s.settings.webpLossless,
        }
        const r = await sampleStats(pool.current, cfg, pairs, ac.signal)
        if (ac.signal.aborted) return
        const stats: SampleStats = { ...r, width: geom.outW, height: geom.outH }
        setState({ status: 'ready', stats, bytes: 0, key: fullKey })
      } catch (e) {
        if (ac.signal.aborted || (e as Error)?.name === 'AbortError') return
        console.error('[gif] 預估', e)
        setState((s) => ({ ...s, status: 'error', key: fullKey }))
      }
    }, 450)
    return () => {
      clearTimeout(timer)
      ac.abort()
      feedDispose?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以 cfgKey／sampleKey 代表內容變化
  }, [enabled, source, cfgKey, sampleKey, fullKey])

  const format = settings.format
  const global = settings.palette === 'global'
  const bytes = state.stats
    ? projectSize(plan.length, state.stats, format === 'gif' ? 0 : headerBytes(format, global))
    : 0
  // 參數已變但新的預估尚未完成：沿用舊數字但標示為計算中
  const status = state.key === fullKey ? state.status : state.stats ? 'loading' : 'idle'
  return { status, stats: state.stats, bytes }
}

/** 輸出總長（毫秒） */
export const planDurationMs = (plan: PlanItem[]) => Math.round(totalDuration(plan.map((p) => p.delayCs)) * 1000)
