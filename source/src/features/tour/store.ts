import { create } from 'zustand'
import type { TourDef } from './content'

interface TourState {
  active: TourDef | null
  /** 0＝開場；1..n＝各步驟；n+1＝效果與完成 */
  step: number
  dir: 1 | -1
  start: (tour: TourDef) => void
  go: (step: number) => void
  stop: () => void
}

export const useTour = create<TourState>((set, get) => ({
  active: null,
  step: 0,
  dir: 1,
  start: (tour) => set({ active: tour, step: 0, dir: 1 }),
  go: (step) => {
    const cur = get()
    if (!cur.active) return
    const last = cur.active.text['zh-TW'].steps.length + 1
    if (step < 0) return
    if (step > last) return set({ active: null, step: 0 })
    set({ step, dir: step >= cur.step ? 1 : -1 })
  },
  stop: () => set({ active: null, step: 0 }),
}))
