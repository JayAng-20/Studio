/** 主執行緒 ↔ Worker 的訊息格式 */
import type { ConvertOptions } from './convert'
import type { DocModel, SourceKind } from './model'

export interface ParseJob {
  kind: SourceKind
  name: string
  /** md／txt：已解碼的文字；rtf：原始位元組 */
  text?: string
  bytes?: Uint8Array
  raw?: boolean
  idPrefix: string
}

export type WorkerRequest =
  | { type: 'parse'; id: number; job: ParseJob }
  | {
      type: 'convert'
      id: number
      docs: DocModel[]
      options: ConvertOptions
      /** 第一次轉檔時才傳字型，之後 Worker 自己保留 */
      fonts?: { regular: Uint8Array; bold: Uint8Array }
    }

export type ParseErrorCode = 'notRtf' | 'parse'

export type WorkerResponse =
  | { type: 'parsed'; id: number; doc: DocModel }
  | { type: 'progress'; id: number; stage: 'layout' | 'render'; value: number }
  | {
      type: 'converted'
      id: number
      bytes: Uint8Array
      pages: number
      missing: number
      title: string
    }
  | {
      type: 'error'
      id: number
      code: ParseErrorCode | 'noFonts' | 'convert' | 'memory'
      message: string
    }
