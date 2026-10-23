/** 主執行緒與 gif Worker 之間的訊息格式 */
import type { DitherMode, Palette } from './dither'

export type WorkerRequest =
  | {
      type: 'palette'
      id: number
      /** RGBA 樣本像素 */
      samples: ArrayBuffer
      colors: number
      /** 保留一格給透明 */
      reserve: boolean
    }
  | {
      type: 'quantize'
      id: number
      rgba: ArrayBuffer
      width: number
      height: number
      colors: number
      dither: DitherMode
      /** 全域調色盤；null 表示每格自己量化 */
      palette: Palette | null
      reserve: boolean
    }
  | {
      type: 'gif-begin'
      id: number
      width: number
      height: number
      /** NETSCAPE 迴圈欄位（見 timeline.repeatField） */
      repeat: number
      /** 全域調色盤（全域模式才有） */
      global: Palette | null
      /** 差異最佳化：沒變的像素寫成透明，讓 LZW 壓得更小 */
      diff: boolean
      /** 差異容許值（RGB 距離平方）；0 表示完全相同才略過 */
      tolerance: number
      /** 真透明（色鍵去背）：每格清除後再畫 */
      transparent: boolean
    }
  | {
      type: 'gif-frame'
      id: number
      index: ArrayBuffer
      palette: Palette
      transparentIndex: number
      delayCs: number
    }
  | { type: 'gif-end'; id: number }
  | {
      type: 'deflate'
      id: number
      rgba: ArrayBuffer
      width: number
      height: number
      colorType: 2 | 6
    }
  | {
      type: 'webp'
      id: number
      rgba: ArrayBuffer
      width: number
      height: number
      quality: number
      lossless: boolean
    }

export type WorkerResponse =
  | { id: number; ok: false; error: string }
  | { id: number; ok: true; type: 'palette'; palette: Palette }
  | {
      id: number
      ok: true
      type: 'quantize'
      index: ArrayBuffer
      palette: Palette
      transparentIndex: number
    }
  | { id: number; ok: true; type: 'gif-begin' }
  /** written：這一格實際寫入的位元組（與前一格相同而合併時為 0） */
  | { id: number; ok: true; type: 'gif-frame'; written: number }
  | {
      id: number
      ok: true
      type: 'gif-end'
      bytes: ArrayBuffer
      frameSizes: number[]
      frames: number
    }
  | { id: number; ok: true; type: 'deflate'; data: ArrayBuffer }
  | { id: number; ok: true; type: 'webp'; chunks: ArrayBuffer; hasAlpha: boolean }
