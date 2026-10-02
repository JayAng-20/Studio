/** 圖片轉 PDF 的圖片清單（模組內共用，切換工具時保留） */
import { create } from 'zustand'
import { uid, fileKind } from '@/lib/files'
import { toast } from '@/components/ui'
import { t } from '@/i18n'
import { decodeAny, thumbnailUrl } from './lib/raster'

export interface ImageItem {
  id: string
  file: File
  name: string
  size: number
  status: 'loading' | 'ready'
  width: number
  height: number
  thumb?: string
  /** 順時針旋轉（度） */
  rotation: number
}

interface ImagesState {
  items: ImageItem[]
  set: (items: ImageItem[]) => void
  patch: (id: string, p: Partial<ImageItem>) => void
  remove: (id: string) => void
  clear: () => void
}

export const useImages = create<ImagesState>((set, get) => ({
  items: [],
  set: (items) => set({ items }),
  patch: (id, p) => set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, ...p } : x)) })),
  remove: (id) => {
    const it = get().items.find((x) => x.id === id)
    if (it?.thumb) URL.revokeObjectURL(it.thumb)
    set((s) => ({ items: s.items.filter((x) => x.id !== id) }))
  },
  clear: () => {
    get().items.forEach((x) => x.thumb && URL.revokeObjectURL(x.thumb))
    set({ items: [] })
  },
}))

export const isImageFile = (f: File) => fileKind(f) === 'image'

/** 加入圖片：先放進清單（骨架），再背景解碼取得尺寸與縮圖 */
export async function addImageFiles(files: File[]) {
  const items: ImageItem[] = files.map((file) => ({
    id: uid('img'),
    file,
    name: file.name,
    size: file.size,
    status: 'loading',
    width: 0,
    height: 0,
    rotation: 0,
  }))
  useImages.setState((s) => ({ items: [...s.items, ...items] }))
  for (const it of items) {
    try {
      const bmp = await decodeAny(it.file)
      try {
        const thumb = await thumbnailUrl(bmp)
        if (!useImages.getState().items.some((x) => x.id === it.id)) {
          URL.revokeObjectURL(thumb)
          continue
        }
        useImages.getState().patch(it.id, {
          status: 'ready',
          width: bmp.width,
          height: bmp.height,
          thumb,
        })
      } finally {
        bmp.close()
      }
    } catch (e) {
      console.error(e)
      useImages.getState().remove(it.id)
      toast.error(t('pdf.images.decodeFailed'), {
        description: t('pdf.images.decodeFailedDesc', { name: it.name }),
      })
    }
  }
}
