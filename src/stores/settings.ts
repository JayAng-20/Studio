import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type ThemePref = 'auto' | 'light' | 'dark'
export type MotionPref = 'full' | 'lite' | 'off'
export type Lang = 'zh-TW' | 'en'

export interface SettingsState {
  theme: ThemePref
  motion: MotionPref
  lang: Lang
  sidebarCollapsed: boolean
  imageQuality: number
  filenamePattern: string
  recorderLibrary: boolean
  set: (patch: Partial<Omit<SettingsState, 'set' | 'reset'>>) => void
  reset: () => void
}

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const defaultLang = (): Lang => {
  if (typeof navigator === 'undefined') return 'zh-TW'
  const l = navigator.language.toLowerCase()
  return l.startsWith('zh') || !l ? 'zh-TW' : 'en'
}

export const defaultSettings = () => ({
  theme: 'auto' as ThemePref,
  motion: (prefersReducedMotion() ? 'lite' : 'full') as MotionPref,
  lang: defaultLang(),
  sidebarCollapsed: false,
  imageQuality: 85,
  filenamePattern: '{name}_{action}',
  recorderLibrary: true,
})

export const SETTINGS_KEY = 'jayang:settings'

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings(),
      set: (patch) => set(patch),
      reset: () => set(defaultSettings()),
    }),
    {
      name: SETTINGS_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ set: _s, reset: _r, ...rest }) => rest,
    },
  ),
)

/** 解析「自動」主題為實際的 light／dark */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'auto') return pref
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}
