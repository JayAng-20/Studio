import { create } from 'zustand'
import { useEffect } from 'react'

export interface ShortcutDef {
  keys: string[]
  label: string
}

interface UiState {
  commandOpen: boolean
  shortcutsOpen: boolean
  allModulesOpen: boolean
  navOverlayOpen: boolean
  moduleShortcuts: ShortcutDef[]
  /** 有未儲存工作（例如錄影中）時，離開頁面要警告 */
  unsavedReasons: Set<string>
  set: (patch: Partial<Omit<UiState, 'set' | 'markUnsaved'>>) => void
  markUnsaved: (key: string, on: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  commandOpen: false,
  shortcutsOpen: false,
  allModulesOpen: false,
  navOverlayOpen: false,
  moduleShortcuts: [],
  unsavedReasons: new Set(),
  set: (patch) => set(patch),
  markUnsaved: (key, on) =>
    set((s) => {
      const next = new Set(s.unsavedReasons)
      if (on) next.add(key)
      else next.delete(key)
      return { unsavedReasons: next }
    }),
}))

/** 模組登記自己的快捷鍵（顯示在 ? 說明裡） */
export function useModuleShortcuts(list: ShortcutDef[]) {
  const key = JSON.stringify(list)
  useEffect(() => {
    useUi.getState().set({ moduleShortcuts: JSON.parse(key) as ShortcutDef[] })
    return () => useUi.getState().set({ moduleShortcuts: [] })
  }, [key])
}

/** 標記有未儲存的工作（離開頁面時觸發 beforeunload 提示） */
export function useUnsaved(key: string, on: boolean) {
  useEffect(() => {
    useUi.getState().markUnsaved(key, on)
    return () => useUi.getState().markUnsaved(key, false)
  }, [key, on])
}
