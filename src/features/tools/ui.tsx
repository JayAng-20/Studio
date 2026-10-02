/** 圖片工具內部共用的小元件與 hook */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { cn } from '@/lib/cn'
import { useTools, useCurrent, type Doc } from './store'
import type { EditState } from './lib/types'

/** 右側面板中的一個區塊 */
export function Section({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-1',
        className,
      )}
    >
      {(title || action) && (
        <div className="flex min-h-7 items-center justify-between gap-2">
          {title && <h3 className="text-small font-semibold text-text">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** 目前圖片＋編輯函式 */
export function useEditor() {
  const { doc, state } = useCurrent()
  const id = doc?.id
  const edit = useCallback(
    (label: string, fn: (s: EditState, d: Doc) => EditState, coalesce?: string) => {
      if (id) useTools.getState().edit(id, label, fn, coalesce)
    },
    [id],
  )
  return { doc, state, edit }
}

/** 元素大小（ResizeObserver） */
export function useElementSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect
      setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, size] as const
}

/** Blob → ImageBitmap（快取；浮水印 Logo 預覽用） */
const bitmapCache = new WeakMap<Blob, Promise<ImageBitmap>>()
export function bitmapOf(b: Blob) {
  let p = bitmapCache.get(b)
  if (!p) {
    p = createImageBitmap(b)
    bitmapCache.set(b, p)
  }
  return p
}

export function useBitmap(blob: Blob | null) {
  const [bmp, setBmp] = useState<{ blob: Blob; bmp: ImageBitmap } | null>(null)
  useEffect(() => {
    if (!blob) return
    let alive = true
    bitmapOf(blob).then(
      (b) => alive && setBmp({ blob, bmp: b }),
      (e) => console.error(e),
    )
    return () => {
      alive = false
    }
  }, [blob])
  return blob && bmp?.blob === blob ? bmp.bmp : null
}

/** 取色器狀態（不進復原堆疊） */
interface ColorState {
  picking: boolean
  picks: string[]
  setPicking: (on: boolean) => void
  addPick: (hex: string) => void
}
export const useColorStore = create<ColorState>((set) => ({
  picking: false,
  picks: [],
  setPicking: (picking) => set({ picking }),
  addPick: (hex) =>
    set((s) => ({ picks: [hex, ...s.picks.filter((p) => p !== hex)].slice(0, 10) })),
}))

/** 舞台的檢視狀態 */
interface ViewState {
  /** 按住看原圖 */
  peek: boolean
  /** 壓縮分頁的前後對比 */
  compare: boolean
  setPeek: (on: boolean) => void
  setCompare: (on: boolean) => void
}
export const useViewStore = create<ViewState>((set) => ({
  peek: false,
  compare: true,
  setPeek: (peek) => set({ peek }),
  setCompare: (compare) => set({ compare }),
}))

/** 延遲值（輸入停止後才更新） */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}
