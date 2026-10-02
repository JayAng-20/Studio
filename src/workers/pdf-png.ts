/**
 * 長圖 PNG 編碼 Worker：主執行緒逐頁（必要時逐條帶）送來 RGBA 像素，
 * 這裡把每一列補上背景、對齊後送進串流 PNG 編碼器。主執行緒等待回覆後才送下一批（背壓），
 * 記憶體只保留壓縮後的資料與一批像素。
 */
import { createPngEncoder, type PngStreamEncoder } from '../features/pdf/lib/png'

type Rgba = [number, number, number, number]

export type PngWorkerRequest =
  | { id: number; type: 'init'; width: number; height: number; alpha: boolean; bg: Rgba }
  | { id: number; type: 'band'; data: ArrayBuffer; w: number; rows: number; x: number }
  | { id: number; type: 'fill'; rows: number; color: Rgba }
  | { id: number; type: 'finish' }

export type PngWorkerResponse =
  | { id: number; ok: true; rows: number; parts?: ArrayBuffer[] }
  | { id: number; ok: false; error: string }

/** Worker 全域（避免與 DOM 型別衝突，只宣告用到的部分） */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<PngWorkerRequest>) => void | Promise<void>) | null
  postMessage: (m: PngWorkerResponse, transfer?: Transferable[]) => void
}

let enc: PngStreamEncoder | null = null
let width = 0
let bg: Rgba = [255, 255, 255, 255]
let row = new Uint8Array(0)

function paint(target: Uint8Array, color: Rgba, from = 0, to = target.length / 4) {
  for (let i = from; i < to; i++) {
    const o = i * 4
    target[o] = color[0]
    target[o + 1] = color[1]
    target[o + 2] = color[2]
    target[o + 3] = color[3]
  }
}

scope.onmessage = async (e: MessageEvent<PngWorkerRequest>) => {
  const m = e.data
  try {
    switch (m.type) {
      case 'init': {
        enc = createPngEncoder({ width: m.width, height: m.height, alpha: m.alpha })
        width = m.width
        bg = m.bg
        row = new Uint8Array(width * 4)
        break
      }
      case 'band': {
        if (!enc) throw new Error('encoder not initialised')
        const src = new Uint8Array(m.data)
        const w = Math.min(m.w, width - m.x)
        paint(row, bg)
        for (let r = 0; r < m.rows; r++) {
          row.set(src.subarray(r * m.w * 4, r * m.w * 4 + w * 4), m.x * 4)
          enc.writeRow(row)
        }
        await enc.drain()
        break
      }
      case 'fill': {
        if (!enc) throw new Error('encoder not initialised')
        const line = new Uint8Array(width * 4)
        paint(line, m.color)
        for (let r = 0; r < m.rows; r++) enc.writeRow(line)
        await enc.drain()
        break
      }
      case 'finish': {
        if (!enc) throw new Error('encoder not initialised')
        const parts = (await enc.finish()).map((p) =>
          p.byteOffset === 0 && p.byteLength === p.buffer.byteLength
            ? (p.buffer as ArrayBuffer)
            : (p.slice().buffer as ArrayBuffer),
        )
        enc = null
        const res: PngWorkerResponse = { id: m.id, ok: true, rows: 0, parts }
        scope.postMessage(res, parts)
        return
      }
    }
    const res: PngWorkerResponse = { id: m.id, ok: true, rows: enc?.rows ?? 0 }
    scope.postMessage(res)
  } catch (err) {
    const res: PngWorkerResponse = { id: m.id, ok: false, error: String(err) }
    scope.postMessage(res)
  }
}
