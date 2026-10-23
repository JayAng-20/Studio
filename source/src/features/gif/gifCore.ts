/**
 * GIF 編碼核心（不依賴 DOM／Worker，可在 Worker 與測試中使用）。
 * - computePalette：從樣本像素量化出調色盤（gifenc 的 PnnQuant）
 * - quantizeFrame：單格量化＋抖色 → 索引
 * - GifAssembler：依序寫入影格；支援差異最佳化（沒變的像素寫成透明）與相同影格合併
 */
import { GIFEncoder, quantize, type GifEncoderInstance } from 'gifenc'
import { indexPixels, samplePixels, type DitherMode, type Palette } from './dither'

/** 從樣本量化出調色盤；reserve 時最後一格保留給透明 */
export function computePalette(samples: Uint8Array, colors: number, reserve: boolean): Palette {
  const max = Math.max(2, Math.min(256, Math.round(colors)) - (reserve ? 1 : 0))
  // gifenc 以 new Uint32Array(rgba.buffer) 讀取，必須是獨立且長度為 4 倍數的緩衝
  const buf =
    samples.byteOffset === 0 && samples.byteLength === samples.buffer.byteLength
      ? samples
      : samples.slice()
  let palette: Palette = buf.length >= 4 ? quantize(buf, max, { format: 'rgb565' }) : [[0, 0, 0]]
  if (!palette.length) palette = [[0, 0, 0]]
  palette = palette.map((c) => [c[0], c[1], c[2]])
  if (reserve) palette.push([0, 0, 0])
  return palette
}

export interface QuantizeResult {
  index: Uint8Array
  palette: Palette
  /** 透明格索引；沒有保留時為 -1 */
  transparentIndex: number
}

/** 單格量化：palette 為 null 時每格自己量化（較好），否則套用全域調色盤（較小） */
export function quantizeFrame(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  colors: number,
  dither: DitherMode,
  palette: Palette | null,
  reserve: boolean,
): QuantizeResult {
  const pal = palette ?? computePalette(samplePixels([rgba], 300_000), colors, reserve)
  const transparentIndex = reserve ? pal.length - 1 : -1
  const index = indexPixels(rgba, width, height, pal, dither, { transparentIndex })
  return { index, palette: pal, transparentIndex }
}

export interface AssemblerOptions {
  width: number
  height: number
  /** NETSCAPE 迴圈欄位 */
  repeat: number
  global: Palette | null
  diff: boolean
  tolerance: number
  transparent: boolean
}

interface Pending {
  order: number
  index: Uint8Array
  palette: Palette
  transparentIndex: number
  delayCs: number
  useTransparency: boolean
}

export class GifAssembler {
  private enc: GifEncoderInstance
  private displayed: Uint8Array
  private pending: Pending | null = null
  private count = 0
  private written = 0
  /** 每個輸入影格實際寫入的位元組（被合併的影格為 0） */
  readonly frameSizes: number[] = []
  private readonly o: AssemblerOptions

  constructor(o: AssemblerOptions) {
    this.o = o
    this.enc = GIFEncoder({ initialCapacity: Math.max(4096, o.width * o.height) })
    this.displayed = new Uint8Array(o.width * o.height * 3)
  }

  /** 寫入一格；回傳 false 表示與前一格相同而被合併 */
  add(index: Uint8Array, palette: Palette, transparentIndex: number, delayCs: number): boolean {
    const { width, height, diff, tolerance, transparent } = this.o
    const order = this.count++
    this.frameSizes.push(0)
    const n = width * height
    const disp = this.displayed
    let useTransparency = transparent && transparentIndex >= 0
    let out = index

    if (!transparent && diff && order > 0 && transparentIndex >= 0) {
      // 差異最佳化：與目前畫面上的顏色比較，沒變（或在容許值內）就寫透明
      out = new Uint8Array(n)
      let changed = 0
      for (let p = 0; p < n; p++) {
        const idx = index[p]
        const c = palette[idx]
        const d = p * 3
        const dr = c[0] - disp[d]
        const dg = c[1] - disp[d + 1]
        const db = c[2] - disp[d + 2]
        if (dr * dr + dg * dg + db * db <= tolerance) {
          out[p] = transparentIndex
        } else {
          out[p] = idx
          disp[d] = c[0]
          disp[d + 1] = c[1]
          disp[d + 2] = c[2]
          changed++
        }
      }
      if (changed === 0 && this.pending) {
        // 完全沒變：把延遲加到前一格，不另外寫一格
        this.pending.delayCs += delayCs
        return false
      }
      useTransparency = true
    } else if (!transparent) {
      for (let p = 0; p < n; p++) {
        const c = palette[index[p]]
        const d = p * 3
        disp[d] = c[0]
        disp[d + 1] = c[1]
        disp[d + 2] = c[2]
      }
    }

    this.flush()
    this.pending = { order, index: out, palette, transparentIndex, delayCs, useTransparency }
    return true
  }

  private flush() {
    const f = this.pending
    if (!f) return
    this.pending = null
    const { width, height, global, diff, transparent, repeat } = this.o
    const first = this.written === 0
    const before = this.enc.bytesView().length
    this.enc.writeFrame(f.index, width, height, {
      // 全域模式只有第一格帶調色盤（成為全域色表）；每格模式每格都帶（之後成為區域色表）
      palette: global ? (first ? global : null) : f.palette,
      delay: f.delayCs * 10,
      repeat,
      transparent: f.useTransparency,
      transparentIndex: f.useTransparency ? f.transparentIndex : 0,
      // 真透明：每格先清除；差異最佳化：保留前一格
      dispose: transparent ? 2 : diff ? 1 : -1,
    })
    this.frameSizes[f.order] = this.enc.bytesView().length - before
    this.written++
  }

  /** 結束並取得檔案位元組 */
  finish(): Uint8Array {
    this.flush()
    this.enc.finish()
    return this.enc.bytes()
  }

  get framesWritten() {
    return this.written + (this.pending ? 1 : 0)
  }
}
