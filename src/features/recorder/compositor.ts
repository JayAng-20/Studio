/**
 * 鏡頭泡泡合成：把螢幕畫面與圓形鏡頭畫面畫到同一張 canvas，再 captureStream。
 * 支援 MediaStreamTrackProcessor 時直接讀影格（背景分頁也不會停），否則用 <video>。
 */
import { clampBubble, type BubblePrefs } from './core'

interface FrameSource {
  frame(): CanvasImageSource | null
  size(): { w: number; h: number } | null
  dispose(): void
}

interface TrackProcessorCtor {
  new (init: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame> }
}

function videoSource(track: MediaStreamTrack, existing?: HTMLVideoElement): FrameSource {
  const v = existing ?? document.createElement('video')
  if (!existing) {
    v.muted = true
    v.playsInline = true
    v.srcObject = new MediaStream([track])
    v.play().catch(() => {})
  }
  return {
    frame: () => (v.readyState >= 2 && v.videoWidth ? v : null),
    size: () => (v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null),
    dispose: () => {
      if (existing) return
      v.pause()
      v.srcObject = null
    },
  }
}

function processorSource(track: MediaStreamTrack, Ctor: TrackProcessorCtor): FrameSource {
  const reader = new Ctor({ track }).readable.getReader()
  let latest: VideoFrame | null = null
  let stopped = false
  void (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read()
        if (done || !value) break
        if (stopped) {
          value.close()
          break
        }
        latest?.close()
        latest = value
      }
    } catch {
      /* 軌道結束 */
    }
  })()
  return {
    frame: () => latest,
    size: () => (latest ? { w: latest.displayWidth, h: latest.displayHeight } : null),
    dispose: () => {
      stopped = true
      reader.cancel().catch(() => {})
      latest?.close()
      latest = null
    },
  }
}

function makeSource(track: MediaStreamTrack, existing?: HTMLVideoElement): FrameSource {
  const Ctor = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor })
    .MediaStreamTrackProcessor
  if (typeof Ctor === 'function') {
    try {
      return processorSource(track, Ctor)
    } catch {
      /* 退回 <video> */
    }
  }
  return videoSource(track, existing)
}

export interface Compositor {
  canvas: HTMLCanvasElement
  track: MediaStreamTrack
  draw(): void
  setBubble(b: BubblePrefs): void
  dispose(): void
}

export function createCompositor(opts: {
  screen: MediaStreamTrack
  screenVideo: HTMLVideoElement
  camera: MediaStreamTrack
  width: number
  height: number
  fps: number
  bubble: BubblePrefs
}): Compositor {
  // 偶數尺寸對編碼器較友善；超過 4K 時等比縮小
  const scale = Math.min(1, 3840 / Math.max(opts.width, opts.height))
  const W = Math.max(2, Math.round((opts.width * scale) / 2) * 2)
  const H = Math.max(2, Math.round((opts.height * scale) / 2) * 2)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (!g) throw new Error('2D canvas unavailable')
  g.fillStyle = '#000'
  g.fillRect(0, 0, W, H)
  const screen = makeSource(opts.screen, opts.screenVideo)
  const cam = makeSource(opts.camera)
  let bubble = clampBubble(opts.bubble, W / H)
  const stream = canvas.captureStream(opts.fps)
  const track = stream.getVideoTracks()[0]

  const draw = () => {
    const f = screen.frame()
    const fs = screen.size()
    if (f && fs) {
      // 來源尺寸改變（例如視窗縮放）時以 contain 置中
      const r = Math.min(W / fs.w, H / fs.h)
      const dw = fs.w * r
      const dh = fs.h * r
      if (dw < W - 1 || dh < H - 1) {
        g.fillStyle = '#000'
        g.fillRect(0, 0, W, H)
      }
      g.drawImage(f, (W - dw) / 2, (H - dh) / 2, dw, dh)
    }
    const cf = cam.frame()
    const cs = cam.size()
    if (cf && cs) {
      const d = bubble.size * Math.min(W, H)
      const cx = bubble.x * W
      const cy = bubble.y * H
      const rad = d / 2
      // 陰影
      g.save()
      g.shadowColor = 'rgba(0,0,0,.35)'
      g.shadowBlur = d * 0.08
      g.shadowOffsetY = d * 0.02
      g.beginPath()
      g.arc(cx, cy, rad, 0, Math.PI * 2)
      g.fillStyle = '#000'
      g.fill()
      g.restore()
      // 圓形裁切、置中取正方形（cover）
      g.save()
      g.beginPath()
      g.arc(cx, cy, rad, 0, Math.PI * 2)
      g.clip()
      const side = Math.min(cs.w, cs.h)
      const sx = (cs.w - side) / 2
      const sy = (cs.h - side) / 2
      if (bubble.mirror) {
        g.translate(cx, cy)
        g.scale(-1, 1)
        g.drawImage(cf, sx, sy, side, side, -rad, -rad, d, d)
      } else {
        g.drawImage(cf, sx, sy, side, side, cx - rad, cy - rad, d, d)
      }
      g.restore()
      // 白色外框
      g.beginPath()
      g.arc(cx, cy, rad, 0, Math.PI * 2)
      g.lineWidth = Math.max(2, d * 0.025)
      g.strokeStyle = 'rgba(255,255,255,.92)'
      g.stroke()
    }
    // 沒有新影格時 captureStream(fps) 仍會依 fps 送出最後一格
  }

  return {
    canvas,
    track,
    draw,
    setBubble: (b) => {
      bubble = clampBubble(b, W / H)
    },
    dispose: () => {
      screen.dispose()
      cam.dispose()
      track.stop()
      canvas.width = 0
      canvas.height = 0
    },
  }
}
