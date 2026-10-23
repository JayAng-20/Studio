import { Pause, Play } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import { Button, Tooltip } from '@/components/ui'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useGT } from '../useGT'
import { useGifStore } from '../store'
import { usePlayhead } from '../playhead'
import { drawSource, drawTexts, chromaKeyImage, type Geometry } from '../render'
import { FULL_CROP, type PlanItem } from '../settings'
import { outputStartTimes } from '../timeline'
import { rgbToHex } from '../dither'
import { TextOverlayBoxes } from './TextOverlayBoxes'
import { CropOverlay } from './CropOverlay'

export interface PreviewApi {
  toggle: () => void
  pause: () => void
  /** 影片模式：跳到來源時間 t（秒）並暫停 */
  seek: (t: number) => void
  /** 影片模式：目前來源時間 */
  current: () => number
}

export type PreviewMode = 'normal' | 'crop' | 'pick'

interface Props {
  geom: Geometry
  plan: PlanItem[]
  bitmaps: Array<ImageBitmap | null>
  mode: PreviewMode
  selectedText: string | null
  onSelectText: (id: string | null) => void
  onPick: (hex: string) => void
  ref?: Ref<PreviewApi>
}

/** 預覽解析度上限（寬），避免大尺寸輸出時每格繪製太重 */
const PREVIEW_MAX_W = 960

/**
 * 所見即所得預覽：把目前畫面依裁切、尺寸、文字、去背畫到 canvas。
 * 影片模式播放選取區間（套用速度）；圖片模式依影格計畫輪播。
 */
export function PreviewStage({
  geom,
  plan,
  bitmaps,
  mode,
  selectedText,
  onSelectText,
  onPick,
  ref,
}: Props) {
  const t = useGT()
  const source = useGifStore((s) => s.source)
  const range = useGifStore((s) => s.range)
  const speed = useGifStore((s) => s.settings.speed)
  const reverse = useGifStore((s) => s.settings.reverse)
  const pingpong = useGifStore((s) => s.settings.pingpong)
  const texts = useGifStore((s) => s.texts)
  const chroma = useGifStore((s) => s.chroma)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [imgIndex, setImgIndex] = useState(0)
  const [clock, setClock] = useState(0)
  const video = source?.kind === 'video' ? source : null

  // 預覽畫布尺寸：裁切模式顯示完整原始畫面
  const view = useMemo((): Geometry => {
    if (mode === 'crop') {
      const w = Math.min(PREVIEW_MAX_W, geom.baseW)
      const h = Math.max(1, Math.round((w * geom.baseH) / geom.baseW))
      return { ...geom, crop: FULL_CROP, outW: w, outH: h }
    }
    const w = Math.min(PREVIEW_MAX_W, geom.outW)
    const h = Math.max(1, Math.round((w * geom.outH) / geom.outW))
    return { ...geom, outW: w, outH: h }
  }, [geom, mode])

  const starts = useMemo(() => outputStartTimes(plan.map((p) => p.delayCs)), [plan])

  /** 繪製目前畫面 */
  const paint = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    if (c.width !== view.outW || c.height !== view.outH) {
      c.width = view.outW
      c.height = view.outH
    }
    const ctx = c.getContext('2d', { willReadFrequently: chroma.enabled })
    if (!ctx) return
    let outT = 0
    if (video) {
      const v = videoRef.current
      if (!v || v.readyState < 2) return
      drawSource(ctx, v, v.videoWidth, v.videoHeight, view)
      outT = Math.max(0, (v.currentTime - range[0]) / speed)
    } else {
      const item = plan[imgIndex]
      const b = item ? bitmaps[item.src] : null
      ctx.clearRect(0, 0, c.width, c.height)
      if (b) drawSource(ctx, b, b.width, b.height, view)
      outT = starts[imgIndex] ?? 0
    }
    if (mode !== 'crop') drawTexts(ctx, texts, outT, view.outW, view.outH)
    if (chroma.enabled && mode !== 'pick') {
      const img = ctx.getImageData(0, 0, c.width, c.height)
      chromaKeyImage(img, chroma.color, chroma.tolerance)
      ctx.putImageData(img, 0, 0)
    }
  }, [view, video, range, speed, plan, imgIndex, bitmaps, starts, texts, chroma, mode])

  // 參數變化時重畫；播放迴圈與事件處理透過 ref 取得最新的 paint，避免重新啟動播放
  const paintRef = useRef(paint)
  useEffect(() => {
    paintRef.current = paint
    paint()
  }, [paint])

  // ---------- 影片模式 ----------
  useEffect(() => {
    const v = videoRef.current
    if (!v || !video) return
    v.playbackRate = speed
  }, [speed, video])

  // 播放迴圈：限制在選取區間內循環
  useEffect(() => {
    const v = videoRef.current
    if (!v || !video || !playing) return
    let raf = 0
    let lastReport = 0
    const tick = (now: number) => {
      if (v.currentTime >= range[1] - 0.01 || v.currentTime < range[0] - 0.05) {
        v.currentTime = range[0]
      }
      paintRef.current()
      if (now - lastReport > 66) {
        lastReport = now
        usePlayhead.setState({ t: v.currentTime })
        setClock(v.currentTime)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    if (v.currentTime < range[0] || v.currentTime >= range[1]) v.currentTime = range[0]
    v.play().catch((e) => {
      console.error(e)
      setPlaying(false)
    })
    return () => {
      cancelAnimationFrame(raf)
      v.pause()
    }
  }, [playing, video, range])

  // 暫停狀態下 seek 完成時重畫
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onSeeked = () => {
      paintRef.current()
      usePlayhead.setState({ t: v.currentTime })
      setClock(v.currentTime)
    }
    const onLoaded = () => {
      if (v.currentTime < range[0] || v.currentTime > range[1]) v.currentTime = range[0]
      paintRef.current()
    }
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('loadeddata', onLoaded)
    return () => {
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('loadeddata', onLoaded)
    }
  }, [range])

  // ---------- 圖片模式：依影格延遲輪播 ----------
  const safeIndex = plan.length ? Math.min(imgIndex, plan.length - 1) : 0
  if (safeIndex !== imgIndex) setImgIndex(safeIndex)
  useEffect(() => {
    if (video || !playing || plan.length < 2) return
    const item = plan[imgIndex]
    const id = setTimeout(
      () => setImgIndex((i) => (i + 1) % plan.length),
      Math.max(20, (item?.delayCs ?? 10) * 10),
    )
    return () => clearTimeout(id)
  }, [video, playing, plan, imgIndex])

  useEffect(() => () => usePlayhead.setState({ t: null, playing: false }), [])
  useEffect(() => {
    usePlayhead.setState({ playing })
  }, [playing])

  useImperativeHandle(
    ref,
    () => ({
      toggle: () => setPlaying((p) => !p),
      pause: () => setPlaying(false),
      seek: (time: number) => {
        const v = videoRef.current
        if (!v) return
        setPlaying(false)
        v.currentTime = Math.max(0, time)
      },
      current: () => videoRef.current?.currentTime ?? 0,
    }),
    [],
  )

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'pick') return
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const r = c.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * c.width)
    const y = Math.floor(((e.clientY - r.top) / r.height) * c.height)
    const d = ctx.getImageData(Math.min(c.width - 1, x), Math.min(c.height - 1, y), 1, 1).data
    onPick(rgbToHex(d[0], d[1], d[2]))
  }

  const ratio = view.outW / view.outH
  const relTime = video ? Math.max(0, clock - range[0]) : (starts[imgIndex] ?? 0)
  const totalTime = video ? range[1] - range[0] : plan.reduce((a, p) => a + p.delayCs, 0) / 100

  return (
    <div className="flex flex-col gap-3">
      <div
        className="gif-checker relative mx-auto overflow-hidden rounded-lg shadow-e1 ring-1 ring-border"
        style={{
          width: `min(100%, calc(min(58vh, 520px) * ${ratio}))`,
          aspectRatio: `${view.outW} / ${view.outH}`,
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t('preview.label')}
          onPointerDown={pick}
          className={cn('absolute inset-0 size-full', mode === 'pick' && 'cursor-crosshair')}
        />
        {mode === 'crop' && <CropOverlay geom={geom} />}
        {mode === 'normal' && (
          <TextOverlayBoxes
            view={view}
            outT={video ? Math.max(0, (clock - range[0]) / speed) : (starts[imgIndex] ?? 0)}
            selected={selectedText}
            onSelect={onSelectText}
          />
        )}
        {video && (
          <video
            ref={videoRef}
            src={video.url}
            muted
            playsInline
            preload="auto"
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none absolute size-px opacity-0"
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-small text-text-2">
        <Tooltip content={playing ? t('actions.pause') : t('actions.play')} shortcut="Space">
          <Button
            variant="secondary"
            icon
            size="sm"
            aria-label={playing ? t('actions.pause') : t('actions.play')}
            onClick={() => setPlaying((p) => !p)}
            className="size-10 rounded-full sm:size-9"
          >
            {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </Button>
        </Tooltip>
        <span className="tabular-nums">
          {t('preview.time', {
            current: formatTime(relTime, { tenths: true }),
            total: formatTime(totalTime, { tenths: true }),
          })}
        </span>
        {video && (reverse || pingpong) && (
          <span className="text-caption text-text-3">{t('preview.hintForward')}</span>
        )}
        {mode === 'pick' && (
          <span className="text-caption text-accent-ink">{t('preview.pickHint')}</span>
        )}
        {mode === 'crop' && (
          <span className="text-caption text-text-3">{t('preview.cropHint')}</span>
        )}
      </div>
    </div>
  )
}
