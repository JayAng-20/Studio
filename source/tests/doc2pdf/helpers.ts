/** 測試用假量測：中日韓字 1 em、其他 0.5 em、空白 0.25 em；Courier 只認 ASCII */
import type { FontKey, Measurer } from '@/features/doc2pdf/engine/fonts'
import { isCJK } from '@/features/doc2pdf/engine/text'

export const fakeMeasurer: Measurer = {
  advance(font: FontKey, ch: string) {
    if (font === 'mono' || font === 'monoBold') return 0.6
    const cp = ch.codePointAt(0)!
    if (ch === ' ') return 0.25
    return isCJK(cp) ? 1 : 0.5
  },
  has(font: FontKey, cp: number) {
    if (font === 'mono' || font === 'monoBold' || font.startsWith('serif'))
      return cp >= 0x20 && cp < 0x7f
    // 假裝思源黑體沒有表情符號
    return cp < 0x1f000
  },
}
