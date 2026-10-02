/**
 * 模組狀態（只存在記憶體）：切換分頁或離開再回來時，產生器的內容與樣式都還在。
 * 不寫入 localStorage，避免 Wi‑Fi 密碼等內容留在裝置上（使用者主動存成範本除外）。
 */
import { create } from 'zustand'
import { defaultValues, type ContentType, type ContentValues } from './lib/content'
import { defaultStyle, type Ecc, type QrStyle } from './lib/style'

export type QrTab = 'generate' | 'scan'
export type ScanStatus = 'idle' | 'camera' | 'continuous' | 'image' | 'found'

interface QrState {
  tab: QrTab
  type: ContentType
  values: ContentValues
  style: QrStyle
  /** 放入 Logo 前的錯誤修正等級（移除 Logo 時還原） */
  eccBeforeLogo: Ecc | null
  scanStatus: ScanStatus
  setTab: (tab: QrTab) => void
  setType: (type: ContentType) => void
  setValues: <T extends ContentType>(type: T, patch: Partial<ContentValues[T]>) => void
  setStyle: (patch: Partial<QrStyle>) => void
  resetStyle: () => void
  applyTemplate: (type: ContentType, values: ContentValues[ContentType], style: QrStyle) => void
  setScanStatus: (s: ScanStatus) => void
}

export const useQrStore = create<QrState>((set) => ({
  tab: 'generate',
  type: 'url',
  values: defaultValues(),
  style: defaultStyle(),
  eccBeforeLogo: null,
  scanStatus: 'idle',
  setTab: (tab) => set({ tab }),
  setType: (type) => set({ type }),
  setValues: (type, patch) =>
    set((s) => ({ values: { ...s.values, [type]: { ...s.values[type], ...patch } } })),
  setStyle: (patch) =>
    set((s) => {
      const next = { ...s.style, ...patch }
      let eccBeforeLogo = s.eccBeforeLogo
      // 放入 Logo：自動升到 H；移除 Logo：還原原本的等級
      if (patch.logo !== undefined) {
        if (patch.logo && !s.style.logo) {
          eccBeforeLogo = s.style.ecc
          next.ecc = 'H'
        } else if (!patch.logo && s.style.logo) {
          next.ecc = eccBeforeLogo ?? s.style.ecc
          eccBeforeLogo = null
        }
      }
      if (next.logo) next.ecc = 'H'
      return { style: next, eccBeforeLogo }
    }),
  resetStyle: () => set({ style: defaultStyle(), eccBeforeLogo: null }),
  applyTemplate: (type, values, style) =>
    set((s) => ({
      type,
      values: { ...s.values, [type]: values },
      style,
      eccBeforeLogo: style.logo ? 'M' : null,
    })),
  setScanStatus: (scanStatus) => set({ scanStatus }),
}))
