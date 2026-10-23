/**
 * 錄影庫：IndexedDB（recordingsStore）。
 * 中繼資料（含小縮圖）與影片 Blob 分開存，列表時只讀中繼資料。
 */
import { create } from 'zustand'
import { del, delMany, get, getMany, keys, set } from 'idb-keyval'
import { recordingsStore, storageEstimate, clearRecordings } from '@/lib/storage'
import type { Marker, SourceMode } from './core'

export interface LibraryMeta {
  id: string
  name: string
  mime: string
  size: number
  /** 秒 */
  duration: number
  width: number
  height: number
  createdAt: number
  markers: Marker[]
  thumb: Blob | null
  mode: SourceMode
  /** 由哪個編輯產生（裁切、轉 MP4） */
  edited?: 'trim' | 'mp4'
}

const META = 'meta:'
const BLOB = 'blob:'

const isMeta = (v: unknown): v is LibraryMeta =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as LibraryMeta).id === 'string' &&
  typeof (v as LibraryMeta).name === 'string'

export async function saveRecording(meta: LibraryMeta, blob: Blob): Promise<void> {
  const store = recordingsStore()
  // 先存影片再存中繼資料：中途失敗時不會出現沒有影片的項目
  await set(BLOB + meta.id, blob, store)
  try {
    await set(META + meta.id, meta, store)
  } catch (e) {
    await del(BLOB + meta.id, store).catch(() => {})
    throw e
  }
}

export async function listRecordings(): Promise<LibraryMeta[]> {
  const store = recordingsStore()
  const all = (await keys(store)).map(String)
  const metaKeys = all.filter((k) => k.startsWith(META))
  const metas = await getMany(metaKeys, store)
  return metas.filter(isMeta).sort((a, b) => b.createdAt - a.createdAt)
}

export async function loadRecordingBlob(id: string): Promise<Blob | null> {
  const b = await get(BLOB + id, recordingsStore())
  return b instanceof Blob ? b : null
}

export async function deleteRecording(id: string): Promise<void> {
  await delMany([META + id, BLOB + id], recordingsStore())
}

/** IndexedDB 是否可用（部分隱私模式或測試環境沒有） */
export const libraryAvailable = () => typeof indexedDB !== 'undefined'

interface LibraryState {
  items: LibraryMeta[]
  loaded: boolean
  usage: { used: number; quota: number } | null
  refresh: () => Promise<void>
  add: (meta: LibraryMeta, blob: Blob) => Promise<void>
  remove: (id: string) => Promise<void>
  clearAll: () => Promise<void>
}

export const useLibrary = create<LibraryState>((setState, getState) => ({
  items: [],
  loaded: false,
  usage: null,
  refresh: async () => {
    if (!libraryAvailable()) {
      setState({ items: [], loaded: true, usage: null })
      return
    }
    try {
      const [items, usage] = await Promise.all([listRecordings(), storageEstimate()])
      setState({ items, usage, loaded: true })
    } catch (e) {
      console.error(e)
      setState({ loaded: true, usage: await storageEstimate() })
    }
  },
  add: async (meta, blob) => {
    await saveRecording(meta, blob)
    setState({ items: [meta, ...getState().items.filter((m) => m.id !== meta.id)] })
    setState({ usage: await storageEstimate() })
  },
  remove: async (id) => {
    await deleteRecording(id)
    setState({ items: getState().items.filter((m) => m.id !== id) })
    setState({ usage: await storageEstimate() })
  },
  clearAll: async () => {
    await clearRecordings()
    setState({ items: [], usage: await storageEstimate() })
  },
}))
