import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ModuleId } from '@/config/moduleIds'

export interface RecentEntry {
  module: ModuleId
  /** 只存檔名，不存檔案內容 */
  fileName?: string
  at: number
}

interface RecentsState {
  entries: RecentEntry[]
  visit: (module: ModuleId, fileName?: string) => void
  clear: () => void
}

export const RECENTS_KEY = 'jayang:recents'

export const useRecents = create<RecentsState>()(
  persist(
    (set) => ({
      entries: [],
      visit: (module, fileName) =>
        set((s) => {
          const rest = s.entries.filter((e) => !(e.module === module && e.fileName === fileName))
          const withoutBare = fileName
            ? rest.filter((e) => !(e.module === module && !e.fileName))
            : rest
          return { entries: [{ module, fileName, at: Date.now() }, ...withoutBare].slice(0, 20) }
        }),
      clear: () => set({ entries: [] }),
    }),
    { name: RECENTS_KEY, storage: createJSONStorage(() => localStorage) },
  ),
)

/** 最近使用過的模組（不重複，依時間排序） */
export function recentModules(entries: RecentEntry[], limit = 3): ModuleId[] {
  const out: ModuleId[] = []
  for (const e of entries) {
    if (!out.includes(e.module)) out.push(e.module)
    if (out.length >= limit) break
  }
  return out
}
