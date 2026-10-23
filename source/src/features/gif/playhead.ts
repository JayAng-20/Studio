import { create } from 'zustand'

/** 預覽播放頭（獨立小 store，避免每格更新造成整頁重繪） */
export const usePlayhead = create<{ t: number | null; playing: boolean }>(() => ({
  t: null,
  playing: false,
}))
