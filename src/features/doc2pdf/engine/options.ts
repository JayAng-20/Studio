/**
 * 轉檔選項與純計算（紙張、邊距、文件標題、語言）。不依賴 pdf-lib／fontkit，介面可以直接引用。
 */
import { findTitle, runsText, walkBlocks, type DocModel } from './model'
import type { DocLang } from './labels'
import { hasCJK } from './text'
import type { ThemeId } from './themes'

export type Paper = 'a4' | 'letter' | 'a5'
export type Orientation = 'portrait' | 'landscape'
export type MarginPreset = 'narrow' | 'normal' | 'wide'

export interface ConvertOptions {
  paper: Paper
  orientation: Orientation
  margin: MarginPreset
  baseSize: number
  lineHeight: number
  theme: ThemeId
  header: boolean
  footer: boolean
  cover: boolean
  coverDate: boolean
  toc: boolean
  tocPosition: 'front' | 'end'
  tocLevel: number
  /** 不納入目錄的標題 id */
  exclude: string[]
  bookmarks: boolean
  /** 自訂文件標題（空字串表示自動） */
  title: string
  /** 封面日期（毫秒） */
  date: number
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  paper: 'a4',
  orientation: 'portrait',
  margin: 'normal',
  baseSize: 11,
  lineHeight: 1.65,
  theme: 'clean',
  header: true,
  footer: true,
  cover: false,
  coverDate: true,
  toc: true,
  tocPosition: 'front',
  tocLevel: 3,
  exclude: [],
  bookmarks: true,
  title: '',
  date: 0,
}

const PAPER: Record<Paper, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  a5: [419.53, 595.28],
}

const MARGIN: Record<MarginPreset, { v: number; h: number }> = {
  narrow: { v: 46, h: 42 },
  normal: { v: 68, h: 64 },
  wide: { v: 82, h: 96 },
}

export function pageSetup(o: Pick<ConvertOptions, 'paper' | 'orientation' | 'margin'>) {
  let [w, h] = PAPER[o.paper]
  if (o.orientation === 'landscape') [w, h] = [h, w]
  const k = o.paper === 'a5' ? 0.78 : 1
  const m = MARGIN[o.margin]
  return { width: w, height: h, margin: { top: m.v * k, bottom: m.v * k, left: m.h * k, right: m.h * k } }
}

/** 文件語言：內容有中文就用中文的固定文字（目錄、日期） */
export function docLang(docs: DocModel[]): DocLang {
  let sample = ''
  for (const d of docs) {
    walkBlocks(d.blocks, (b) => {
      if (sample.length > 4000) return
      if (b.type === 'paragraph' || b.type === 'heading') sample += runsText(b.runs)
    })
    sample += d.title
  }
  return hasCJK(sample) ? 'zh' : 'en'
}

export function docTitle(docs: DocModel[], custom: string): string {
  if (custom.trim()) return custom.trim()
  for (const d of docs) {
    const t = findTitle(d.blocks)
    if (t) return t
  }
  return docs[0]?.title ?? 'Document'
}

