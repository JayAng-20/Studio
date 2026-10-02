/**
 * 圖片工具的狀態：文件清單（每張圖）＋整個工作台共用一條復原堆疊。
 * 復原堆疊存的是「每張圖的 EditState」快照（結構共享，沒改到的圖沿用同一個物件）。
 * 放在模組層級的 store：切到別的工具再回來，工作仍在。
 */
import { create } from 'zustand'
import { uid } from '@/lib/files'
import { useSettings } from '@/stores/settings'
import { useRecents } from '@/stores/recents'
import { t } from '@/i18n'
import { toast } from '@/components/ui'
import {
  createHistory,
  mapHistory,
  pushHistory,
  redo as redoH,
  replacePresent,
  undo as undoH,
  type History,
} from './lib/history'
import { defaultEditState, type Container, type EditState } from './lib/types'
import { loadImage, readExif, type ExifSummary } from './loader'
import { sharedEngine } from './engine'

export type TabId = 'crop' | 'adjust' | 'watermark' | 'redact' | 'compress' | 'info' | 'color'

export interface Doc {
  id: string
  file: File
  name: string
  status: 'loading' | 'ready' | 'error'
  /** 可解碼來源（HEIC 轉檔後） */
  source?: Blob
  container: Container
  srcW: number
  srcH: number
  proxy?: ImageBitmap
  /** 原圖縮圖（載入時產生） */
  thumbUrl?: string
  /** 套用編輯後的縮圖 */
  editedThumbUrl?: string
  /** undefined＝讀取中 */
  exif?: ExifSummary | null
  hasGps: boolean
  /** 上次匯出時的狀態簽章 */
  exportedKey?: string
}

export type States = Record<string, EditState>

interface ToolsState {
  docs: Doc[]
  selectedId: string | null
  history: History<States>
  tab: TabId
  addFiles: (files: File[]) => void
  removeDoc: (id: string) => void
  clearAll: () => void
  select: (id: string) => void
  selectRelative: (d: 1 | -1) => void
  setTab: (t: TabId) => void
  /** 編輯一張圖（一個復原步驟；coalesce 相同 key 的連續變更合併） */
  edit: (
    id: string,
    label: string,
    fn: (s: EditState, d: Doc) => EditState,
    coalesce?: string,
  ) => void
  /** 編輯多張圖（同一個復原步驟） */
  editMany: (ids: string[], label: string, fn: (s: EditState, d: Doc) => EditState) => void
  undo: () => void
  redo: () => void
  patchDoc: (id: string, patch: Partial<Doc>) => void
}

/** 依序載入（避免同時解碼太多大圖） */
let loadQueue: Promise<void> = Promise.resolve()

async function makeThumb(bmp: ImageBitmap): Promise<string> {
  const k = Math.min(1, 160 / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k))
  const h = Math.max(1, Math.round(bmp.height * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  c.width = 0
  c.height = 0
  return blob ? URL.createObjectURL(blob) : ''
}

function releaseDoc(d: Doc) {
  d.proxy?.close()
  if (d.thumbUrl) URL.revokeObjectURL(d.thumbUrl)
  if (d.editedThumbUrl) URL.revokeObjectURL(d.editedThumbUrl)
  sharedEngine().drop(d.id)
}

export const useTools = create<ToolsState>((set, get) => ({
  docs: [],
  selectedId: null,
  history: createHistory<States>({}),
  tab: 'crop',

  addFiles: (files) => {
    if (!files.length) return
    const quality = useSettings.getState().imageQuality
    const fresh: Doc[] = files.map((file) => ({
      id: uid('img'),
      file,
      name: file.name || 'image',
      status: 'loading',
      container: 'other',
      srcW: 0,
      srcH: 0,
      hasGps: false,
    }))
    set((s) => {
      const states = { ...s.history.present }
      for (const d of fresh) states[d.id] = defaultEditState(quality)
      return {
        docs: [...s.docs, ...fresh],
        // 新加入的第一張自動選取（使用者剛放進來就想看到它）
        selectedId: fresh[0].id,
        history: replacePresent(s.history, states),
      }
    })
    for (const d of fresh) {
      useRecents.getState().visit('tools', d.name)
      loadQueue = loadQueue.then(async () => {
        if (!get().docs.some((x) => x.id === d.id)) return
        try {
          const img = await loadImage(d.file)
          const thumbUrl = await makeThumb(img.proxy)
          if (!get().docs.some((x) => x.id === d.id)) {
            img.proxy.close()
            if (thumbUrl) URL.revokeObjectURL(thumbUrl)
            return
          }
          get().patchDoc(d.id, { ...img, thumbUrl, status: 'ready' })
          const meta = await readExif(d.file, img.container)
          get().patchDoc(d.id, { exif: meta.exif, hasGps: meta.hasGps })
        } catch (e) {
          console.error(e)
          get().patchDoc(d.id, { status: 'error', exif: null })
          toast.error(t('tools.errors.decode'), {
            description: t('tools.errors.decodeDesc', { name: d.name }),
          })
        }
      })
    }
  },

  removeDoc: (id) => {
    const s = get()
    const idx = s.docs.findIndex((d) => d.id === id)
    if (idx < 0) return
    releaseDoc(s.docs[idx])
    const docs = s.docs.filter((d) => d.id !== id)
    const selectedId =
      s.selectedId === id ? (docs[Math.min(idx, docs.length - 1)]?.id ?? null) : s.selectedId
    set({
      docs,
      selectedId,
      history: mapHistory(s.history, (st) => {
        if (!(id in st)) return st
        const next = { ...st }
        delete next[id]
        return next
      }),
    })
  },

  clearAll: () => {
    get().docs.forEach(releaseDoc)
    set({ docs: [], selectedId: null, history: createHistory<States>({}) })
  },

  select: (id) => set({ selectedId: id }),
  selectRelative: (d) => {
    const s = get()
    if (!s.docs.length) return
    const i = s.docs.findIndex((x) => x.id === s.selectedId)
    const n = (i + d + s.docs.length) % s.docs.length
    set({ selectedId: s.docs[n].id })
  },
  setTab: (tab) => set({ tab }),

  edit: (id, label, fn, coalesce) => {
    const s = get()
    const cur = s.history.present[id]
    const doc = s.docs.find((d) => d.id === id)
    if (!cur || !doc) return
    const next = fn(cur, doc)
    if (next === cur) return
    set({
      history: pushHistory(
        s.history,
        { ...s.history.present, [id]: next },
        { label, coalesce: coalesce ? `${id}:${coalesce}` : undefined },
      ),
    })
  },

  editMany: (ids, label, fn) => {
    const s = get()
    const states = { ...s.history.present }
    let changed = false
    for (const id of ids) {
      const cur = states[id]
      const doc = s.docs.find((d) => d.id === id)
      if (!cur || !doc || doc.status !== 'ready') continue
      const next = fn(cur, doc)
      if (next !== cur) {
        states[id] = next
        changed = true
      }
    }
    if (changed) set({ history: pushHistory(s.history, states, { label }) })
  },

  undo: () => set((s) => ({ history: undoH(s.history) })),
  redo: () => set((s) => ({ history: redoH(s.history) })),

  patchDoc: (id, patch) =>
    set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
}))

/** 目前選取的文件與它的狀態 */
export function useCurrent() {
  const doc = useTools((s) => s.docs.find((d) => d.id === s.selectedId) ?? null)
  const state = useTools((s) => (s.selectedId ? s.history.present[s.selectedId] : undefined))
  return { doc, state }
}
