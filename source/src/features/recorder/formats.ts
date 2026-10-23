/** 執行環境實際支援的錄影格式（只算一次） */
import { caps } from '@/lib/capabilities'
import { listFormats, type AvailableFormat } from './core'

let cached: AvailableFormat[] | null = null

export function listFormatsCached(): AvailableFormat[] {
  if (!cached) cached = caps.mediaRecorder() ? listFormats(caps.recorderType) : []
  return cached
}
