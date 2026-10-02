/** 把「影格計畫」變成可餵給編碼器的 RGBA 影格（seek → 繪製 → 文字 → 去背） */
import type { FrameFeed } from './encoder'
import { drawSource, drawTexts, chromaKeyImage, type Geometry } from './render'
import { outputStartTimes } from './timeline'
import { VideoGrabber, decodeImages } from './source'
import type { ChromaKey, PlanItem, TextLayer } from './settings'
import type { Source } from './store'
import { buildImageTimeline, buildVideoTimeline } from './timeline'
import type { GifSettings } from './settings'

/** 依參數自動產生影格計畫 */
export function autoPlan(
  source: Source | null,
  range: [number, number],
  s: Pick<GifSettings, 'fps' | 'speed' | 'reverse' | 'pingpong'>,
): PlanItem[] {
  if (!source) return []
  if (source.kind === 'video') {
    return buildVideoTimeline({
      start: range[0],
      end: range[1],
      fps: s.fps,
      speed: s.speed,
      reverse: s.reverse,
      pingpong: s.pingpong,
    }).map((f, i) => ({ id: `a${i}`, src: f.t, delayCs: f.delayCs }))
  }
  return buildImageTimeline(source.items.length, s.fps, s.speed, s.reverse, s.pingpong).map(
    (f, i) => ({ id: `a${i}`, src: f.index, delayCs: f.delayCs }),
  )
}

/** 同時 seek 的 <video> 數 */
const PARALLEL_SEEKS = 3

export interface FeedOptions {
  source: Source
  plan: PlanItem[]
  geom: Geometry
  texts: TextLayer[]
  chroma: ChromaKey
  /** 重用既有的取樣器（預估時用），不重用時由 feed 自己建立並在 dispose 釋放 */
  grabber?: VideoGrabber
  bitmaps?: Array<ImageBitmap | null>
  /** 每畫好一格就回呼（給「正在寫入的影格」預覽用） */
  onRendered?: (i: number, canvas: HTMLCanvasElement) => void
}

export interface DisposableFeed extends FrameFeed {
  dispose(): void
}

export async function createFeed(o: FeedOptions, signal?: AbortSignal): Promise<DisposableFeed> {
  const { geom } = o
  const canvas = document.createElement('canvas')
  canvas.width = geom.outW
  canvas.height = geom.outH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 2d unavailable')
  const starts = outputStartTimes(o.plan.map((p) => p.delayCs))

  // 影片：多個 <video> 平行 seek（瀏覽器會在不同解碼器上同時處理），並預先擷取後面幾格
  let grabbers: VideoGrabber[] = []
  let ownGrabbers = false
  let bitmaps: Array<ImageBitmap | null> = []
  let ownBitmaps = false
  if (o.source.kind === 'video') {
    if (o.grabber) grabbers = [o.grabber]
    else {
      const n = Math.max(1, Math.min(PARALLEL_SEEKS, new Set(o.plan.map((p) => p.src)).size))
      for (let k = 0; k < n; k++) grabbers.push(new VideoGrabber(o.source.url, o.source.duration))
      ownGrabbers = true
    }
  } else {
    if (o.bitmaps) bitmaps = o.bitmaps
    else {
      bitmaps = (await decodeImages(
        o.source.items.map((i) => i.file),
        signal,
      )).bitmaps
      ownBitmaps = true
    }
  }

  // 同一個來源時間（例如來回播放）只擷取一次；用完即釋放
  const uses = new Map<number, number>()
  for (const p of o.plan) uses.set(p.src, (uses.get(p.src) ?? 0) + 1)
  const cache = new Map<number, Promise<ImageData>>()
  let rr = 0
  const fetchSource = (t: number, sig: AbortSignal): Promise<ImageData> => {
    let p = cache.get(t)
    if (!p) {
      const g = grabbers[rr++ % grabbers.length]
      p = g.seek(t, sig).then((v) => {
        // 同步繪製並讀回，不會與其他影格交錯
        drawSource(ctx, v, v.videoWidth, v.videoHeight, geom)
        return ctx.getImageData(0, 0, geom.outW, geom.outH)
      })
      p.catch(() => undefined)
      cache.set(t, p)
    }
    return p
  }

  const dispose = () => {
    if (ownGrabbers) grabbers.forEach((g) => g.dispose())
    if (ownBitmaps) bitmaps.forEach((b) => b?.close())
    cache.clear()
    canvas.width = 0
    canvas.height = 0
  }

  return {
    count: o.plan.length,
    dispose,
    async frame(i, sig) {
      const item = o.plan[i]
      if (o.source.kind === 'video' && grabbers.length) {
        // 預先排入後面幾格
        for (let j = i + 1; j < Math.min(o.plan.length, i + 1 + grabbers.length * 2); j++)
          fetchSource(o.plan[j].src, sig)
        const base = await fetchSource(item.src, sig)
        const left = (uses.get(item.src) ?? 1) - 1
        uses.set(item.src, left)
        if (left <= 0) cache.delete(item.src)
        ctx.putImageData(base, 0, 0)
      } else {
        const b = bitmaps[item.src]
        ctx.clearRect(0, 0, geom.outW, geom.outH)
        if (b) drawSource(ctx, b, b.width, b.height, geom)
      }
      drawTexts(ctx, o.texts, starts[i] ?? 0, geom.outW, geom.outH)
      const img = ctx.getImageData(0, 0, geom.outW, geom.outH)
      if (o.chroma.enabled) chromaKeyImage(img, o.chroma.color, o.chroma.tolerance)
      if (o.onRendered) {
        if (o.chroma.enabled) ctx.putImageData(img, 0, 0)
        o.onRendered(i, canvas)
      }
      return { rgba: img.data, delayCs: item.delayCs }
    },
  }
}
