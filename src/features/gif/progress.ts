import { create } from 'zustand'
import type { EncodeProgress } from './encoder'

/** 編碼進度與取消控制（獨立 store：離開頁面再回來仍能看到進度並取消） */
export const useEncodeState = create<{
  progress: EncodeProgress | null
  controller: AbortController | null
  startedAt: number
}>(() => ({ progress: null, controller: null, startedAt: 0 }))

/** 「正在寫入的影格」預覽畫布（由 EncodingView 掛上） */
export const heroTarget: { canvas: HTMLCanvasElement | null } = { canvas: null }

let pending: HTMLCanvasElement | null = null
let raf = 0
/** 把剛畫好的影格複製到預覽畫布；以 requestAnimationFrame 節流 */
export function drawHero(src: HTMLCanvasElement) {
  pending = src
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const c = heroTarget.canvas
    const s = pending
    pending = null
    if (!c || !s || !s.width) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(s, 0, 0, c.width, c.height)
  })
}
