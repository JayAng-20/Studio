/** 輸出檔名：命名模板與去重（純函式） */
import { applyTemplate, sanitizeFilename, splitExt } from '@/lib/filename'

/** 模板可用的變數 */
export const TEMPLATE_VARS = ['name', 'w', 'h', 'format', 'quality', 'index', 'date', 'action'] as const
export type TemplateVar = (typeof TEMPLATE_VARS)[number]

export interface NameContext {
  /** 原始檔名（含副檔名） */
  original: string
  /** 處理名稱，例如 converted */
  action: string
  width?: number
  height?: number
  /** 輸出格式（副檔名，不含點） */
  format: string
  quality?: number
  /** 第幾個檔案（從 1 開始） */
  index?: number
  /** 批次總數（決定 {index} 補零位數） */
  total?: number
  date?: Date
}

/** 模板中不認得的變數 */
export function unknownVars(template: string): string[] {
  const out: string[] = []
  for (const m of template.matchAll(/\{(\w*)\}/g)) {
    const k = m[1]
    if (!(TEMPLATE_VARS as readonly string[]).includes(k) && !out.includes(k)) out.push(k)
  }
  return out
}

export function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/** 依模板產生輸出檔名（含副檔名）；未提供的變數連同前方分隔符一起省略 */
export function buildOutputName(template: string, ctx: NameContext): string {
  const { base } = splitExt(ctx.original)
  const digits = Math.max(2, String(ctx.total ?? ctx.index ?? 1).length)
  const name = sanitizeFilename(base, 'image')
  // {index} 需要補零（字串），改名成 {idx} 以避開共用型別中 index 為 number 的限制
  return applyTemplate(
    (template || '{name}').replace(/\{index\}/g, '{idx}'),
    {
      name,
      action: ctx.action,
      w: ctx.width,
      h: ctx.height,
      format: ctx.format,
      quality: ctx.quality,
      idx: ctx.index !== undefined ? String(ctx.index).padStart(digits, '0') : undefined,
      date: ctx.date ? formatDate(ctx.date) : undefined,
    },
    ctx.format,
  )
}
