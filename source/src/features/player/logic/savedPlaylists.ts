/**
 * 播放清單儲存：只存檔名與順序（STORAGE_KEYS.playlists），不存檔案內容。
 * 重新開啟時需要使用者再選一次檔案，依檔名對回順序。
 */
import { STORAGE_KEYS, readJSON, writeJSON } from '@/lib/storage'

export interface SavedPlaylist {
  id: string
  name: string
  names: string[]
  savedAt: number
}

export const SAVED_MAX = 30

function isSaved(v: unknown): v is SavedPlaylist {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.savedAt === 'number' &&
    Array.isArray(o.names) &&
    o.names.every((n) => typeof n === 'string')
  )
}

export function loadSaved(): SavedPlaylist[] {
  const raw = readJSON<unknown>(STORAGE_KEYS.playlists, [])
  return Array.isArray(raw) ? raw.filter(isSaved) : []
}

/** 新增或以同名覆寫，最新的排前面 */
export function upsertSaved(list: SavedPlaylist[], entry: SavedPlaylist): SavedPlaylist[] {
  const rest = list.filter((p) => p.id !== entry.id && p.name !== entry.name)
  return [entry, ...rest].slice(0, SAVED_MAX)
}

export function writeSaved(list: SavedPlaylist[]) {
  writeJSON(STORAGE_KEYS.playlists, list)
}
