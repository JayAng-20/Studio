import { create } from 'zustand'
import { useEffect, useRef } from 'react'
import type { ModuleId } from '@/config/moduleIds'

/** 模組之間傳遞檔案的附帶資訊 */
export interface BusMeta {
  /** 時間區間（秒），例如播放器的 A–B 區間 */
  range?: { start: number; end: number }
  /** 其他自由欄位 */
  [k: string]: unknown
}

export type BusSource = ModuleId | 'home'

export interface BusPayload {
  from: BusSource
  to: ModuleId
  files: File[]
  meta?: BusMeta
  at: number
}

interface FileBusState {
  inbox: Partial<Record<ModuleId, BusPayload>>
  send: (to: ModuleId, from: BusSource, files: File[], meta?: BusMeta) => void
  take: (to: ModuleId) => BusPayload | undefined
  peek: (to: ModuleId) => BusPayload | undefined
  clear: () => void
}

/** 以記憶體傳遞 File／Blob，不寫入任何儲存空間 */
export const useFileBus = create<FileBusState>((set, get) => ({
  inbox: {},
  send: (to, from, files, meta) =>
    set((s) => ({ inbox: { ...s.inbox, [to]: { from, to, files, meta, at: Date.now() } } })),
  take: (to) => {
    const p = get().inbox[to]
    if (p) set((s) => ({ inbox: { ...s.inbox, [to]: undefined } }))
    return p
  },
  peek: (to) => get().inbox[to],
  clear: () => set({ inbox: {} }),
}))

/** 模組掛載後與之後每次收到檔案時呼叫 handler */
export function useIncomingFiles(to: ModuleId, handler: (p: BusPayload) => void) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  const pending = useFileBus((s) => s.inbox[to])
  useEffect(() => {
    if (!pending) return
    const p = useFileBus.getState().take(to)
    if (p) ref.current(p)
  }, [pending, to])
}

/** 把 Blob 包成 File（傳遞時保留檔名） */
export const asFile = (b: Blob, name: string) =>
  b instanceof File && b.name === name
    ? b
    : new File([b], name, { type: b.type, lastModified: Date.now() })
