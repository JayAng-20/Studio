/**
 * 解碼門面：優先使用瀏覽器內建的 BarcodeDetector；不支援時改用 Worker 內的 jsQR。
 * 回傳的角點座標一律是「來源影像的像素座標」。
 */
import { caps } from '@/lib/capabilities'
import { createCanvas, releaseCanvas } from '@/lib/image'
import type { DecodeRequest, DecodeResponse } from '@/workers/qr-decode'

export interface Point {
  x: number
  y: number
}

export interface Detection {
  text: string
  /** 左上、右上、右下、左下 */
  corners: Point[]
}

interface NativeBarcode {
  rawValue: string
  cornerPoints?: Point[]
  boundingBox?: DOMRectReadOnly
}
interface NativeDetector {
  detect(source: CanvasImageSource | ImageBitmap | ImageData): Promise<NativeBarcode[]>
}
interface NativeDetectorCtor {
  new (opts: { formats: string[] }): NativeDetector
  getSupportedFormats?: () => Promise<string[]>
}

let nativeSupport: Promise<boolean> | null = null

/** BarcodeDetector 是否存在且支援 qr_code */
export function hasNativeQr(): Promise<boolean> {
  nativeSupport ??= (async () => {
    if (!caps.barcodeDetector()) return false
    try {
      const Ctor = (window as unknown as { BarcodeDetector: NativeDetectorCtor }).BarcodeDetector
      const formats = (await Ctor.getSupportedFormats?.()) ?? []
      return formats.includes('qr_code')
    } catch {
      return false
    }
  })()
  return nativeSupport
}

/** 把 BarcodeDetector 的結果轉成統一格式（角點順序不保證，依位置排序） */
function fromNative(b: NativeBarcode): Detection {
  let corners = b.cornerPoints?.map((p) => ({ x: p.x, y: p.y })) ?? []
  if (corners.length !== 4 && b.boundingBox) {
    const r = b.boundingBox
    corners = [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
      { x: r.x, y: r.y + r.height },
    ]
  }
  return { text: b.rawValue, corners }
}

type Source = CanvasImageSource & { width?: number; height?: number }

export class QrDecoder {
  private native: NativeDetector | null = null
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, (r: DecodeResponse) => void>()
  private canvas: HTMLCanvasElement | null = null
  private disposed = false
  readonly engine: 'native' | 'jsqr'

  private constructor(engine: 'native' | 'jsqr') {
    this.engine = engine
    if (engine === 'native') {
      const Ctor = (window as unknown as { BarcodeDetector: NativeDetectorCtor }).BarcodeDetector
      this.native = new Ctor({ formats: ['qr_code'] })
    }
  }

  static async create(): Promise<QrDecoder> {
    return new QrDecoder((await hasNativeQr()) ? 'native' : 'jsqr')
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../../../workers/qr-decode.ts', import.meta.url), {
        type: 'module',
      })
      this.worker.onmessage = (e: MessageEvent<DecodeResponse>) => {
        const cb = this.pending.get(e.data.id)
        this.pending.delete(e.data.id)
        cb?.(e.data)
      }
      this.worker.onerror = (e) => {
        console.error(e)
        // Worker 壞掉時讓等待中的請求結束，避免永遠卡住
        this.pending.forEach((cb, id) => cb({ id, result: null, error: 'worker' }))
        this.pending.clear()
      }
    }
    return this.worker
  }

  /** 以 jsQR 解碼：先把來源縮到 maxDim 內 */
  private async decodeWithWorker(
    source: Source,
    sw: number,
    sh: number,
    maxDim: number,
    inversion: DecodeRequest['inversion'],
  ): Promise<Detection | null> {
    const scale = Math.min(1, maxDim / Math.max(sw, sh))
    const w = Math.max(1, Math.round(sw * scale))
    const h = Math.max(1, Math.round(sh * scale))
    this.canvas ??= createCanvas(w, h)
    const c = this.canvas
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    // 高品質縮小：圓點、圓角等樣式化 QR 縮小後會融成方塊，jsQR 比較認得出來
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, w, h)
    const img = ctx.getImageData(0, 0, w, h)
    const worker = this.ensureWorker()
    const id = ++this.seq
    const res = await new Promise<DecodeResponse>((resolve) => {
      this.pending.set(id, resolve)
      const msg: DecodeRequest = { id, buffer: img.data.buffer, width: w, height: h, inversion }
      worker.postMessage(msg, [img.data.buffer])
    })
    if (res.error && res.error !== 'worker') console.error(res.error)
    if (!res.result) return null
    return {
      text: res.result.text,
      corners: res.result.corners.map((p) => ({ x: p.x / scale, y: p.y / scale })),
    }
  }

  private frame = 0

  /** 相機畫面：單次快速解碼（jsQR 交替使用 720／360 px、不嘗試反轉以維持流暢） */
  async detectFrame(source: Source, sw: number, sh: number): Promise<Detection[]> {
    if (this.disposed) return []
    if (this.native) {
      try {
        return (await this.native.detect(source)).filter((b) => b.rawValue).map(fromNative)
      } catch (e) {
        console.error(e)
        return []
      }
    }
    const dim = this.frame++ % 2 ? 360 : 720
    const r = await this.decodeWithWorker(source, sw, sh, dim, 'dontInvert')
    return r ? [r] : []
  }

  /** 圖片：盡量找出來（內建偵測器 → 多種尺寸的 jsQR，含反轉） */
  async detectImage(source: Source, sw: number, sh: number): Promise<Detection[]> {
    if (this.native) {
      try {
        const found = (await this.native.detect(source)).filter((b) => b.rawValue).map(fromNative)
        if (found.length) return found
      } catch (e) {
        console.error(e)
      }
    }
    const longest = Math.max(sw, sh)
    // 先原尺寸附近，再大圖（照片中的小 QR），最後縮小（圓點等樣式化 QR）
    const sizes = [...new Set([1200, 2000, 640, 360, 220].map((d) => Math.min(d, longest)))]
    for (const d of sizes) {
      if (this.disposed) return []
      const r = await this.decodeWithWorker(source, sw, sh, d, 'attemptBoth')
      if (r) return [r]
    }
    return []
  }

  dispose() {
    this.disposed = true
    this.worker?.terminate()
    this.worker = null
    this.pending.forEach((cb, id) => cb({ id, result: null }))
    this.pending.clear()
    releaseCanvas(this.canvas)
    this.canvas = null
  }
}
