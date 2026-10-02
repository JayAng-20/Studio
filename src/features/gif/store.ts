/**
 * GIF 製作的頁面狀態（離開模組再回來仍保留工作）。
 * 只把「參數」存到 localStorage；檔案、物件 URL、結果只存在記憶體。
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { uid } from '@/lib/files'
import type { BusSource } from '@/stores/fileBus'
import {
  type CropRatio,
  DEFAULT_CHROMA,
  FULL_CROP,
  PRESETS,
  normalizeSettings,
  type ChromaKey,
  type CropRect,
  type GifSettings,
  type OutputFormat,
  type PlanItem,
  type PresetId,
  type TextLayer,
} from './settings'

export interface VideoSource {
  kind: 'video'
  file: File
  url: string
  width: number
  height: number
  duration: number
}

export interface ImageItem {
  id: string
  file: File
  url: string
  width: number
  height: number
}

export interface ImagesSource {
  kind: 'images'
  items: ImageItem[]
}

export type Source = VideoSource | ImagesSource

export interface GifResult {
  blob: Blob
  url: string
  name: string
  format: OutputFormat
  width: number
  height: number
  /** 實際寫入的影格數（相同畫面會合併） */
  frames: number
  /** 計畫的影格數 */
  planned: number
  durationMs: number
  /** 編碼前的預估大小（用於比較） */
  estimated: number | null
  elapsedMs: number
}

export type Stage = 'edit' | 'encoding' | 'done'

interface GifState {
  source: Source | null
  /** 來源模組（顯示「來自螢幕錄影」） */
  from: BusSource | null
  range: [number, number]
  settings: GifSettings
  crop: CropRect
  cropRatio: CropRatio
  texts: TextLayer[]
  chroma: ChromaKey
  /** 使用者在影格編輯器調整過的影格計畫；null 表示依參數自動產生 */
  customPlan: PlanItem[] | null
  stage: Stage
  result: GifResult | null
  /** 參數改變導致自訂影格被重設的時間（用來提示使用者） */
  planResetAt: number

  setSource: (s: Source | null, from?: BusSource | null) => void
  setImages: (items: ImageItem[]) => void
  setRange: (r: [number, number]) => void
  patch: (p: Partial<GifSettings>) => void
  applyPreset: (id: PresetId) => void
  setCrop: (c: CropRect) => void
  setCropRatio: (r: CropRatio) => void
  setTexts: (t: TextLayer[]) => void
  updateText: (id: string, p: Partial<TextLayer>) => void
  setChroma: (p: Partial<ChromaKey>) => void
  setCustomPlan: (p: PlanItem[] | null) => void
  setStage: (s: Stage) => void
  setResult: (r: GifResult | null) => void
  clear: () => void
}

/** 會讓影格計畫失效的參數 */
const TIMING_KEYS: Array<keyof GifSettings> = ['fps', 'speed', 'reverse', 'pingpong']

function revokeSource(s: Source | null) {
  if (!s) return
  if (s.kind === 'video') URL.revokeObjectURL(s.url)
  else s.items.forEach((i) => URL.revokeObjectURL(i.url))
}

export const useGifStore = create<GifState>()(
  persist(
    (set, get) => ({
      source: null,
      from: null,
      range: [0, 0],
      settings: normalizeSettings(undefined),
      crop: FULL_CROP,
      cropRatio: 'free',
      texts: [],
      chroma: DEFAULT_CHROMA,
      customPlan: null,
      stage: 'edit',
      result: null,
      planResetAt: 0,

      setSource: (source, from = null) => {
        const prev = get()
        if (prev.source && prev.source !== source) {
          // 舊來源的物件 URL 不再使用（圖片模式新增時會沿用舊項目，由 setImages 處理）
          revokeSource(prev.source)
        }
        if (prev.result) URL.revokeObjectURL(prev.result.url)
        set({
          source,
          from,
          crop: FULL_CROP,
          cropRatio: 'free',
          texts: [],
          chroma: { ...prev.chroma, enabled: false },
          customPlan: null,
          stage: 'edit',
          result: null,
        })
      },
      setImages: (items) => {
        const prev = get().source
        if (prev?.kind === 'images') {
          const keep = new Set(items.map((i) => i.url))
          prev.items.forEach((i) => !keep.has(i.url) && URL.revokeObjectURL(i.url))
        }
        set({ source: items.length ? { kind: 'images', items } : null, customPlan: null })
      },
      setRange: (range) =>
        set((s) => ({
          range,
          customPlan: null,
          planResetAt: s.customPlan ? Date.now() : s.planResetAt,
        })),
      patch: (p) =>
        set((s) => {
          const timing = TIMING_KEYS.some((k) => k in p && p[k] !== s.settings[k])
          return {
            settings: { ...s.settings, ...p },
            customPlan: timing ? null : s.customPlan,
            planResetAt: timing && s.customPlan ? Date.now() : s.planResetAt,
          }
        }),
      applyPreset: (id) =>
        set((s) => {
          const reset = PRESETS[id].fps !== s.settings.fps && !!s.customPlan
          return {
            settings: { ...s.settings, ...PRESETS[id] },
            customPlan: reset ? null : s.customPlan,
            planResetAt: reset ? Date.now() : s.planResetAt,
          }
        }),
      setCrop: (crop) => set({ crop }),
      setCropRatio: (cropRatio) => set({ cropRatio }),
      setTexts: (texts) => set({ texts }),
      updateText: (id, p) => set((s) => ({ texts: s.texts.map((t) => (t.id === id ? { ...t, ...p } : t)) })),
      setChroma: (p) => set((s) => ({ chroma: { ...s.chroma, ...p } })),
      setCustomPlan: (customPlan) => set({ customPlan }),
      setStage: (stage) => set({ stage }),
      setResult: (result) => {
        const prev = get().result
        if (prev && prev !== result) URL.revokeObjectURL(prev.url)
        set({ result })
      },
      clear: () => {
        const s = get()
        revokeSource(s.source)
        if (s.result) URL.revokeObjectURL(s.result.url)
        set({
          source: null,
          from: null,
          range: [0, 0],
          crop: FULL_CROP,
          texts: [],
          chroma: { ...s.chroma, enabled: false },
          customPlan: null,
          stage: 'edit',
          result: null,
        })
      },
    }),
    {
      name: 'jayang:gif-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ settings: s.settings }),
      merge: (persisted, current) => ({
        ...current,
        settings: normalizeSettings((persisted as { settings?: Partial<GifSettings> })?.settings),
      }),
    },
  ),
)

export const newTextLayer = (text: string, start = 0): TextLayer => ({
  id: uid('txt'),
  text,
  size: 0.12,
  color: '#FFFFFF',
  strokeColor: '#000000',
  stroke: 0.14,
  bold: true,
  x: 0.5,
  y: 0.84,
  start,
  end: null,
})
