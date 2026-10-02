import { createStore, clear, keys, get, set, del, entries } from 'idb-keyval'

/** 本機資料的唯一位置（設定頁「清除」與隱私說明依此列出） */
export const STORAGE_KEYS = {
  settings: 'jayang:settings',
  recents: 'jayang:recents',
  progress: 'jayang:progress',
  qrHistory: 'jayang:qr-history',
  qrTemplates: 'jayang:qr-templates',
  playlists: 'jayang:playlists',
  recorder: 'jayang:recorder',
  gifSettings: 'jayang:gif-settings',
} as const

let recStore: ReturnType<typeof createStore> | null = null
/** 錄影庫（IndexedDB） */
export const recordingsStore = () => (recStore ??= createStore('jayang-recordings', 'items'))

export const idb = { get, set, del, keys, entries, clear }

export async function clearRecordings() {
  try {
    await clear(recordingsStore())
  } catch (e) {
    console.error(e)
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error(e)
  }
}

export function removeKey(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 忽略 */
  }
}

/** 重設全部本機資料 */
export async function resetAllData() {
  Object.values(STORAGE_KEYS).forEach(removeKey)
  await clearRecordings()
}

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const e = await navigator.storage.estimate()
    return { used: e.usage ?? 0, quota: e.quota ?? 0 }
  } catch {
    return null
  }
}
