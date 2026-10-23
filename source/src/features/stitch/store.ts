/**
 * 長圖拼接狀態：圖片（原始檔＋預覽網址＋在畫布上的位置）、選取、復原／重做、輸出設定。
 * 拖曳中的位置變化只更新 items，放開時才 commit 進歷史紀錄。
 */
import { create } from 'zustand'
import { uid } from '@/lib/files'
import { canvasToBlob, createCanvas, releaseCanvas } from '@/lib/image'
import { decodeAny } from '@/features/pdf/lib/raster'
import { arrange, matchSize, normalize, type Align } from './lib'

export interface StitchItem {
  id: string
  file: File
  name: string
  /** 預覽用（最長邊 1600 px） */
  url: string
  natW: number
  natH: number
  x: number
  y: number
  w: number
  h: number
}

export type Flow = 'vertical' | 'horizontal' | 'free'

export interface StitchOptions {
  gap: number
  padding: number
  radius: number
  background: string
  transparent: boolean
  format: 'png' | 'jpeg' | 'webp'
  quality: number
  /** 輸出倍率 */
  scale: number
  snap: boolean
  align: Align
}

interface StitchState {
  items: StitchItem[]
  selected: string | null
  flow: Flow
  options: StitchOptions
  past: StitchItem[][]
  future: StitchItem[][]
  loading: number
  set: (items: StitchItem[]) => void
  commit: (items: StitchItem[], before?: StitchItem[]) => void
  select: (id: string | null) => void
  setOptions: (p: Partial<StitchOptions>) => void
  setFlow: (f: Flow) => void
  undo: () => void
  redo: () => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  reorder: (ids: string[]) => void
  layout: (flow: Exclude<Flow, 'free'>, opts?: { match?: boolean }) => void
  clear: () => void
}

const HISTORY = 60
const PREVIEW_MAX = 1600

export const useStitch = create<StitchState>((set, get) => ({
  items: [],
  selected: null,
  flow: 'vertical',
  options: {
    gap: 0,
    padding: 0,
    radius: 0,
    background: '#FFFFFF',
    transparent: false,
    format: 'jpeg',
    quality: 92,
    scale: 1,
    snap: true,
    align: 'center',
  },
  past: [],
  future: [],
  loading: 0,
  set: (items) => set({ items }),
  commit: (items, before) =>
    set((s) => ({
      items,
      past: [...s.past, before ?? s.items].slice(-HISTORY),
      future: [],
    })),
  select: (selected) => set({ selected }),
  setOptions: (p) => {
    set((s) => ({ options: { ...s.options, ...p } }))
    // 間距或對齊改變時，自動排列模式立即重排；滑桿每動一格都會呼叫，不寫進復原紀錄
    const s = get()
    if (s.flow !== 'free' && ('gap' in p || 'align' in p))
      set({ items: relayout(s.items, s.flow, s.options) })
  },
  setFlow: (flow) => set({ flow }),
  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1]
      if (!prev) return s
      return { items: prev, past: s.past.slice(0, -1), future: [s.items, ...s.future], flow: 'free' }
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0]
      if (!next) return s
      return { items: next, future: s.future.slice(1), past: [...s.past, s.items], flow: 'free' }
    }),
  remove: (id) => {
    const s = get()
    const items = s.items.filter((i) => i.id !== id)
    s.commit(s.flow === 'free' ? items : relayout(items, s.flow, s.options))
    if (s.selected === id) set({ selected: null })
  },
  duplicate: (id) => {
    const s = get()
    const src = s.items.find((i) => i.id === id)
    if (!src) return
    const copy = { ...src, id: uid('st'), x: src.x + 24, y: src.y + 24 }
    const idx = s.items.indexOf(src)
    const items = [...s.items.slice(0, idx + 1), copy, ...s.items.slice(idx + 1)]
    s.commit(s.flow === 'free' ? items : relayout(items, s.flow, s.options))
    set({ selected: copy.id })
  },
  reorder: (ids) => {
    const s = get()
    const items = ids.map((id) => s.items.find((i) => i.id === id)!).filter(Boolean)
    s.commit(s.flow === 'free' ? items : relayout(items, s.flow, s.options))
  },
  layout: (flow, opts) => {
    const s = get()
    let items = s.items
    if (opts?.match && items.length) {
      const target =
        flow === 'vertical'
          ? Math.round(Math.max(...items.map((i) => i.w)))
          : Math.round(Math.max(...items.map((i) => i.h)))
      items = matchSize(items, flow, target)
    }
    s.commit(relayout(items, flow, s.options))
    set({ flow })
  },
  clear: () => {
    get().items.forEach((i) => URL.revokeObjectURL(i.url))
    set({ items: [], selected: null, past: [], future: [], flow: 'vertical' })
  },
}))

function relayout(items: StitchItem[], flow: Exclude<Flow, 'free'>, o: StitchOptions) {
  return normalize(arrange(items, flow, o.gap, o.align))
}

/** 解碼圖片、做預覽圖，接在目前排列的最後面 */
export async function addImages(files: File[]): Promise<number> {
  const st = useStitch.getState()
  useStitch.setState({ loading: st.loading + files.length })
  const added: StitchItem[] = []
  for (const file of files) {
    try {
      const bmp = await decodeAny(file)
      const k = Math.min(1, PREVIEW_MAX / Math.max(bmp.width, bmp.height))
      const c = createCanvas(bmp.width * k, bmp.height * k)
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
      const blob = await canvasToBlob(c, 'image/webp', 0.86).catch(() => canvasToBlob(c, 'image/png'))
      releaseCanvas(c)
      added.push({
        id: uid('st'),
        file,
        name: file.name,
        url: URL.createObjectURL(blob),
        natW: bmp.width,
        natH: bmp.height,
        x: 0,
        y: 0,
        w: bmp.width,
        h: bmp.height,
      })
      bmp.close()
    } catch (e) {
      console.error(e)
    } finally {
      useStitch.setState((s) => ({ loading: Math.max(0, s.loading - 1) }))
    }
  }
  if (!added.length) return 0
  const s = useStitch.getState()
  const flow = s.flow
  // 新圖片的寬（直式）或高（橫式）預設對齊現有的第一張
  const ref = s.items[0] ?? added[0]
  const sized = added.map((i) =>
    flow === 'horizontal'
      ? { ...i, h: ref.h, w: (i.natW * ref.h) / i.natH }
      : { ...i, w: ref.w, h: (i.natH * ref.w) / i.natW },
  )
  let items = [...s.items, ...sized]
  if (flow === 'free') {
    // 自由模式：疊在最後一張的右下方
    const last = s.items[s.items.length - 1]
    let off = 0
    items = [
      ...s.items,
      ...sized.map((i) => {
        off += 32
        return { ...i, x: (last?.x ?? 0) + off, y: (last ? last.y + last.h : 0) + off }
      }),
    ]
  } else items = relayout(items, flow, s.options)
  s.commit(items)
  return added.length
}
