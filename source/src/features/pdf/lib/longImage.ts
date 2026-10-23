/**
 * 「合成一張長圖」的版面計算（純函式）：每頁的像素尺寸、位置、間距與分隔線。
 * 以最寬的頁面為輸出寬度，其他頁依設定置中或靠左。
 */
import type { Size } from './placement'

export type LongAlign = 'center' | 'left'

export interface LongOptions {
  /** 縮放（像素／pt），例如 dpi / 72 */
  scale: number
  /** 頁與頁之間的間距（px） */
  gap: number
  align: LongAlign
  /** 每頁之間畫一條細分隔線 */
  separator: boolean
}

export interface LongPage {
  /** 在來源中的頁碼（1 起算） */
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface LongLayout {
  width: number
  height: number
  pages: LongPage[]
  /** 分隔線的位置（y、高度），落在間距中央 */
  lines: Array<{ y: number; h: number }>
}

/** 分隔線粗細：約 0.5 pt，至少 1 px */
export const separatorWidth = (scale: number) => Math.max(1, Math.round(scale * 0.5))

/**
 * 計算長圖版面。sizes 為每頁的視覺尺寸（pt，已套用 /Rotate），pages 為要輸出的頁碼（1 起算）。
 */
export function planLongImage(sizes: Size[], pages: number[], o: LongOptions): LongLayout {
  const dims = pages.map((p) => {
    const s = sizes[p - 1] ?? sizes[0] ?? { w: 595, h: 842 }
    return {
      page: p,
      w: Math.max(1, Math.round(s.w * o.scale)),
      h: Math.max(1, Math.round(s.h * o.scale)),
    }
  })
  const width = Math.max(1, ...dims.map((d) => d.w))
  const lw = o.separator ? separatorWidth(o.scale) : 0
  const gap = Math.max(Math.round(o.gap), lw)
  const out: LongPage[] = []
  const lines: LongLayout['lines'] = []
  let y = 0
  dims.forEach((d, i) => {
    if (i > 0) {
      if (lw) lines.push({ y: y + Math.floor((gap - lw) / 2), h: lw })
      y += gap
    }
    const x = o.align === 'center' ? Math.floor((width - d.w) / 2) : 0
    out.push({ page: d.page, x, y, w: d.w, h: d.h })
    y += d.h
  })
  return { width, height: Math.max(1, y), pages: out, lines }
}

/** 依「輸出寬度（px）」換算縮放：最寬的頁面等於指定寬度 */
export function scaleForWidth(sizes: Size[], pages: number[], widthPx: number): number {
  const maxW = Math.max(1, ...pages.map((p) => (sizes[p - 1] ?? sizes[0] ?? { w: 595 }).w))
  return widthPx / maxW
}

/** 把頁碼清單每 n 頁分成一組 */
export function groupPages(pages: number[], n: number): number[][] {
  if (!n || n >= pages.length) return [pages]
  const out: number[][] = []
  for (let i = 0; i < pages.length; i += n) out.push(pages.slice(i, i + n))
  return out
}

/** PNG 檔案大小粗估：文件頁面多為大片留白，RGB 約每像素 0.35 位元組，RGBA 約 0.45 */
export const estimatePngBytes = (pixels: number, alpha: boolean) => pixels * (alpha ? 0.45 : 0.35)

/** 各格式的單邊像素上限 */
export const FORMAT_MAX_DIM = { png: 0x7fffffff, jpg: 65535, webp: 16383 } as const

/** 超過這個總像素或檔案大小時先警告 */
export const LONG_WARN_PIXELS = 500_000_000
export const LONG_WARN_BYTES = 1024 ** 3
/** 輸出寬度上限（canvas 單邊在各瀏覽器都安全的範圍） */
export const LONG_MAX_WIDTH = 16384
