/** 錯誤、提示與格式名稱的文字對照 */
import { useCallback } from 'react'
import { useT, type TKey } from '@/i18n'
import { formatFromName, type SourceFormat } from './lib/probe'
import { FORMATS, type ErrorCode, type OutputFormat, type WarningCode } from './types'

const SOURCE_LABEL: Record<SourceFormat, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  apng: 'APNG',
  webp: 'WebP',
  gif: 'GIF',
  bmp: 'BMP',
  avif: 'AVIF',
  heic: 'HEIC',
  svg: 'SVG',
  ico: 'ICO',
  tiff: 'TIFF',
  unknown: '',
}

/** 來源格式的顯示名稱（檔頭無法辨識時退回副檔名） */
export function sourceLabel(format: SourceFormat | undefined, name: string): string {
  const f = format && format !== 'unknown' ? format : formatFromName(name)
  return SOURCE_LABEL[f] || (name.split('.').pop() ?? '').toUpperCase().slice(0, 5) || '?'
}

export const OUTPUT_LABEL: Record<OutputFormat, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
  ico: 'ICO',
  bmp: 'BMP',
  gif: 'GIF',
}

/** 錯誤代碼 → 「發生什麼事」＋「可以怎麼辦」 */
export function useErrorText() {
  const t = useT()
  return useCallback(
    (code: ErrorCode, format: OutputFormat | '') => {
      const fmt = format ? OUTPUT_LABEL[format] : ''
      return {
        title: t(`convert.errors.${code}.title` as TKey, { format: fmt }),
        desc: t(`convert.errors.${code}.desc` as TKey, { format: fmt }),
      }
    },
    [t],
  )
}

/** 提示代碼 → 說明文字 */
export function useWarningText() {
  const t = useT()
  return useCallback(
    (code: WarningCode, format: OutputFormat) =>
      t(`convert.warnings.${code}` as TKey, { format: OUTPUT_LABEL[format], ext: FORMATS[format].ext }),
    [t],
  )
}
