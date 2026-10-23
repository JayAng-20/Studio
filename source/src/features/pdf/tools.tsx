import {
  BookOpen,
  Bookmark,
  Columns2,
  Combine,
  Crop,
  FileDown,
  FileImage,
  FileText,
  GitCompareArrows,
  Gauge,
  ImageDown,
  Images,
  LayoutGrid,
  LayoutPanelTop,
  LockKeyhole,
  LockOpen,
  Minimize2,
  Paperclip,
  PenLine,
  Ratio,
  ScanText,
  Scissors,
  ShieldCheck,
  SquareDashed,
  Stamp,
  Tags,
  TextCursorInput,
  type LucideIcon,
} from 'lucide-react'
import type { TKey } from '@/i18n'

export type ToolId =
  | 'viewer'
  | 'organize'
  | 'merge'
  | 'split'
  | 'compare'
  | 'crop'
  | 'resize'
  | 'layout'
  | 'annotate'
  | 'stamp'
  | 'headerFooter'
  | 'redact'
  | 'form'
  | 'bookmarks'
  | 'attachments'
  | 'meta'
  | 'protect'
  | 'unlock'
  | 'sanitize'
  | 'compress'
  | 'optimize'
  | 'images'
  | 'toImages'
  | 'toWord'
  | 'text'
  | 'extractImages'
  | 'ocr'

/** PDF 編輯器（#/pdf）與 PDF 轉換（#/pdfconvert）共用同一套檔案匣，各自顯示自己的工具 */
export type PdfScope = 'pdf' | 'pdfconvert'

export type ToolGroup = 'view' | 'edit' | 'secure' | 'toPdf' | 'fromPdf' | 'recognize'

export interface ToolDef {
  id: ToolId
  scope: PdfScope
  group: ToolGroup
  icon: LucideIcon
  /** 主要輸入：pdf（單一檔）、pdfs（多檔）、images */
  input: 'pdf' | 'pdfs' | 'images'
  /** 會用 pdf-lib 改寫原檔（加密檔無法處理） */
  needsEdit: boolean
  /** 以 copyPages／embedPage 建立新文件（表單欄位與書籤不會帶過去） */
  structural: boolean
}

type Def = Omit<ToolDef, 'scope' | 'needsEdit' | 'structural' | 'input'> &
  Partial<Pick<ToolDef, 'needsEdit' | 'structural' | 'input'>>

const edit = (d: Def): ToolDef => ({
  input: 'pdf',
  needsEdit: true,
  structural: false,
  ...d,
  scope: 'pdf',
})
const conv = (d: Def): ToolDef => ({
  input: 'pdf',
  needsEdit: false,
  structural: false,
  ...d,
  scope: 'pdfconvert',
})

export const TOOLS: ToolDef[] = [
  // 檢視與整理
  edit({ id: 'viewer', group: 'view', icon: BookOpen, needsEdit: false }),
  edit({ id: 'organize', group: 'view', icon: LayoutGrid, structural: true }),
  edit({ id: 'merge', group: 'view', icon: Combine, input: 'pdfs', structural: true }),
  edit({ id: 'split', group: 'view', icon: Scissors, structural: true }),
  edit({ id: 'compare', group: 'view', icon: GitCompareArrows, input: 'pdfs', needsEdit: false }),
  edit({ id: 'crop', group: 'view', icon: Crop }),
  edit({ id: 'resize', group: 'view', icon: Ratio, structural: true }),
  edit({ id: 'layout', group: 'view', icon: Columns2, structural: true }),
  // 編輯與標註
  edit({ id: 'annotate', group: 'edit', icon: PenLine }),
  edit({ id: 'stamp', group: 'edit', icon: Stamp }),
  edit({ id: 'headerFooter', group: 'edit', icon: LayoutPanelTop }),
  edit({ id: 'redact', group: 'edit', icon: SquareDashed }),
  edit({ id: 'form', group: 'edit', icon: TextCursorInput }),
  edit({ id: 'bookmarks', group: 'edit', icon: Bookmark }),
  edit({ id: 'attachments', group: 'edit', icon: Paperclip }),
  edit({ id: 'meta', group: 'edit', icon: Tags }),
  // 保護與最佳化
  edit({ id: 'protect', group: 'secure', icon: LockKeyhole }),
  edit({ id: 'unlock', group: 'secure', icon: LockOpen, needsEdit: false }),
  edit({ id: 'sanitize', group: 'secure', icon: ShieldCheck }),
  edit({ id: 'compress', group: 'secure', icon: Minimize2, needsEdit: false }),
  edit({ id: 'optimize', group: 'secure', icon: Gauge, needsEdit: false }),
  // 轉成 PDF
  conv({ id: 'images', group: 'toPdf', icon: FileImage, input: 'images' }),
  // 從 PDF 轉出
  conv({ id: 'toImages', group: 'fromPdf', icon: Images }),
  conv({ id: 'toWord', group: 'fromPdf', icon: FileDown }),
  conv({ id: 'text', group: 'fromPdf', icon: FileText }),
  conv({ id: 'extractImages', group: 'fromPdf', icon: ImageDown }),
  // 文字辨識
  conv({ id: 'ocr', group: 'recognize', icon: ScanText }),
]

export const SCOPE_GROUPS: Record<PdfScope, ToolGroup[]> = {
  pdf: ['view', 'edit', 'secure'],
  pdfconvert: ['toPdf', 'fromPdf', 'recognize'],
}


export const toolById = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>

export const isToolId = (v: string | null): v is ToolId => !!v && v in toolById

export const toolsOf = (scope: PdfScope) => TOOLS.filter((t) => t.scope === scope)

export const toolName = (id: ToolId) => `pdf.tools.${id}.name` as TKey
export const toolDesc = (id: ToolId) => `pdf.tools.${id}.desc` as TKey
