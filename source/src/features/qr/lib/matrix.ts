/**
 * 用 `qrcode` 只取得模組矩陣（不使用它的繪製器），之後自行繪製 SVG／Canvas。
 * 函式庫在第一次使用時才動態載入。
 */
import type { Ecc } from './style'

export interface QrMatrix {
  /** 每邊模組數 */
  n: number
  /** n×n，1 = 深色 */
  data: Uint8Array
  version: number
  ecc: Ecc
}

export class QrTooLongError extends Error {
  constructor() {
    super('QR 內容超過容量')
    this.name = 'QrTooLongError'
  }
}

type QrLib = typeof import('qrcode')
let libPromise: Promise<QrLib> | null = null

/** 動態載入 qrcode（相容 CJS default 匯出） */
export function loadQrLib(): Promise<QrLib> {
  libPromise ??= import('qrcode').then((m) => {
    const mod = m as QrLib & { default?: QrLib }
    return typeof mod.create === 'function' ? mod : (mod.default as QrLib)
  })
  return libPromise
}

export function createMatrixSync(lib: QrLib, text: string, ecc: Ecc): QrMatrix {
  try {
    const qr = lib.create(text, { errorCorrectionLevel: ecc })
    const n = qr.modules.size
    return { n, data: Uint8Array.from(qr.modules.data), version: qr.version, ecc }
  } catch (e) {
    if (e instanceof Error && /too big|amount of data/i.test(e.message)) throw new QrTooLongError()
    throw e
  }
}

export async function createMatrix(text: string, ecc: Ecc): Promise<QrMatrix> {
  return createMatrixSync(await loadQrLib(), text, ecc)
}

/** 是否位於三個定位點（7×7）內 */
export function isFinder(n: number, r: number, c: number): boolean {
  return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)
}
