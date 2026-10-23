/**
 * QR 解碼 Worker（瀏覽器不支援 BarcodeDetector 時使用）：在背景執行 jsQR，避免卡住畫面。
 * 收：{ id, buffer, width, height, inversion }，回：{ id, result: { text, corners } | null }
 */
import jsQR from 'jsqr'

export interface DecodeRequest {
  id: number
  buffer: ArrayBuffer
  width: number
  height: number
  inversion: 'dontInvert' | 'attemptBoth'
}

export interface DecodeResponse {
  id: number
  result: { text: string; corners: Array<{ x: number; y: number }> } | null
  error?: string
}

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
  const { id, buffer, width, height, inversion } = e.data
  try {
    const data = new Uint8ClampedArray(buffer)
    const r = jsQR(data, width, height, { inversionAttempts: inversion })
    const res: DecodeResponse = {
      id,
      result:
        r && r.data
          ? {
              text: r.data,
              corners: [
                r.location.topLeftCorner,
                r.location.topRightCorner,
                r.location.bottomRightCorner,
                r.location.bottomLeftCorner,
              ].map((p) => ({ x: p.x, y: p.y })),
            }
          : null,
    }
    ;(self as unknown as Worker).postMessage(res)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      id,
      result: null,
      error: err instanceof Error ? err.message : String(err),
    } satisfies DecodeResponse)
  }
}
