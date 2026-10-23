/** 顏色計算：WCAG 相對亮度與對比，用來判斷 QR 是否可能掃不出來 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): Rgb | null {
  let h = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (c) => c + c)
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** WCAG 2 相對亮度（0–1） */
export function luminance(hex: string): number {
  const c = hexToRgb(hex)
  if (!c) return 0
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export type ContrastIssue = 'low' | 'inverted' | null

/**
 * 判斷前景（可能有多個漸層色）與背景：
 * - 任何一個前景色與背景對比 < 3:1 → low
 * - 前景比背景亮（深底淺字）→ inverted（很多掃描器不支援反轉）
 */
export function checkContrast(
  foregrounds: string[],
  background: string,
): { issue: ContrastIssue; ratio: number } {
  const ratio = Math.min(...foregrounds.map((f) => contrastRatio(f, background)))
  if (ratio < 3) return { issue: 'low', ratio }
  const bgL = luminance(background)
  if (foregrounds.some((f) => luminance(f) > bgL)) return { issue: 'inverted', ratio }
  return { issue: null, ratio }
}
