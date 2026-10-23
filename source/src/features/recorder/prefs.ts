/** 錄影偏好設定：存在 localStorage（jayang:recorder），解析時一律驗證型別 */
import { create } from 'zustand'
import { readJSON, writeJSON } from '@/lib/storage'
import { parsePrefs, type RecorderPrefs } from './core'

export const RECORDER_PREFS_KEY = 'jayang:recorder'

interface PrefsState extends RecorderPrefs {
  update: (patch: Partial<RecorderPrefs>) => void
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...parsePrefs(readJSON<unknown>(RECORDER_PREFS_KEY, null)),
  update: (patch) => {
    set(patch)
    const { update: _u, ...rest } = get()
    writeJSON(RECORDER_PREFS_KEY, rest)
  },
}))

/** 目前的偏好設定（純資料） */
export function currentPrefs(): RecorderPrefs {
  const { update: _u, ...rest } = usePrefs.getState()
  return rest
}
