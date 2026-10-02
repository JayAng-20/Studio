/** 本機資料：辨識歷史與常用範本（localStorage，只存在這台裝置） */
import { readJSON, writeJSON, removeKey, STORAGE_KEYS } from '@/lib/storage'
import { uid } from '@/lib/files'
import { CONTENT_TYPES, defaultValues, type ContentType, type ContentValues } from './content'
import { sanitizeStyle, type QrStyle } from './style'

export type ScanSource = 'camera' | 'image'

export interface HistoryItem {
  id: string
  text: string
  source: ScanSource
  at: number
}

export const HISTORY_MAX = 50

export function loadHistory(): HistoryItem[] {
  const raw = readJSON<unknown>(STORAGE_KEYS.qrHistory, [])
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (x): x is HistoryItem =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as HistoryItem).id === 'string' &&
        typeof (x as HistoryItem).text === 'string' &&
        typeof (x as HistoryItem).at === 'number',
    )
    .map((x) => ({ ...x, source: x.source === 'camera' ? 'camera' : 'image' }) as HistoryItem)
    .slice(0, HISTORY_MAX)
}

/** 新增一筆：同內容的舊紀錄移到最前面 */
export function addHistory(list: HistoryItem[], text: string, source: ScanSource): HistoryItem[] {
  const item: HistoryItem = { id: uid('scan'), text, source, at: Date.now() }
  const next = [item, ...list.filter((h) => h.text !== text)].slice(0, HISTORY_MAX)
  writeJSON(STORAGE_KEYS.qrHistory, next)
  return next
}

export function saveHistory(list: HistoryItem[]) {
  if (list.length) writeJSON(STORAGE_KEYS.qrHistory, list)
  else removeKey(STORAGE_KEYS.qrHistory)
}

export interface QrTemplate {
  id: string
  name: string
  type: ContentType
  values: ContentValues[ContentType]
  style: QrStyle
  createdAt: number
}

export const TEMPLATES_MAX = 24

/** 讀取範本：欄位不完整的用預設值補齊，避免舊資料讓畫面壞掉 */
export function loadTemplates(): QrTemplate[] {
  const raw = readJSON<unknown>(STORAGE_KEYS.qrTemplates, [])
  if (!Array.isArray(raw)) return []
  const out: QrTemplate[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const type = CONTENT_TYPES.includes(o.type as ContentType) ? (o.type as ContentType) : null
    if (!type || typeof o.id !== 'string') continue
    const defaults = defaultValues()[type] as unknown as Record<string, unknown>
    const given = (o.values && typeof o.values === 'object' ? o.values : {}) as Record<
      string,
      unknown
    >
    const values: Record<string, unknown> = { ...defaults }
    for (const k of Object.keys(defaults)) {
      if (typeof given[k] === typeof defaults[k]) values[k] = given[k]
    }
    out.push({
      id: o.id,
      name: typeof o.name === 'string' ? o.name : '',
      type,
      values: values as unknown as ContentValues[ContentType],
      style: sanitizeStyle(o.style),
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    })
  }
  return out.slice(0, TEMPLATES_MAX)
}

/** 寫入範本；回傳 false 表示儲存空間不足（通常是 Logo 太大） */
export function saveTemplates(list: QrTemplate[]): boolean {
  try {
    if (list.length) localStorage.setItem(STORAGE_KEYS.qrTemplates, JSON.stringify(list))
    else removeKey(STORAGE_KEYS.qrTemplates)
    return true
  } catch (e) {
    console.error(e)
    return false
  }
}
