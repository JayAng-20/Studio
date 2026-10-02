import {
  BookOpen,
  Combine,
  FileImage,
  FileType,
  Images,
  LayoutGrid,
  LockOpen,
  Minimize2,
  PenLine,
  Scissors,
  Stamp,
  Tags,
  TextCursorInput,
  ScanText,
  type LucideIcon,
} from 'lucide-react'
import type { TKey } from '@/i18n'

export type ToolId =
  | 'viewer'
  | 'organize'
  | 'merge'
  | 'split'
  | 'images'
  | 'text2pdf'
  | 'toImages'
  | 'stamp'
  | 'text'
  | 'meta'
  | 'compress'
  | 'form'
  | 'annotate'
  | 'unlock'

export type ToolGroup = 'view' | 'convert' | 'edit'

export interface ToolDef {
  id: ToolId
  group: ToolGroup
  icon: LucideIcon
  /** 主要輸入：pdf（單一檔）、pdfs（多檔）、images、text（md／txt／rtf） */
  input: 'pdf' | 'pdfs' | 'images' | 'text'
  /** 會用 pdf-lib 改寫原檔（加密檔無法處理） */
  needsEdit: boolean
  /** 以 copyPages 建立新文件（表單欄位與書籤不會帶過去） */
  structural: boolean
}

export const TOOLS: ToolDef[] = [
  {
    id: 'viewer',
    group: 'view',
    icon: BookOpen,
    input: 'pdf',
    needsEdit: false,
    structural: false,
  },
  {
    id: 'organize',
    group: 'view',
    icon: LayoutGrid,
    input: 'pdf',
    needsEdit: true,
    structural: true,
  },
  { id: 'merge', group: 'view', icon: Combine, input: 'pdfs', needsEdit: true, structural: true },
  { id: 'split', group: 'view', icon: Scissors, input: 'pdf', needsEdit: true, structural: true },
  {
    id: 'images',
    group: 'convert',
    icon: FileImage,
    input: 'images',
    needsEdit: false,
    structural: false,
  },
  {
    id: 'text2pdf',
    group: 'convert',
    icon: FileType,
    input: 'text',
    needsEdit: false,
    structural: false,
  },
  {
    id: 'toImages',
    group: 'convert',
    icon: Images,
    input: 'pdf',
    needsEdit: false,
    structural: false,
  },
  {
    id: 'text',
    group: 'convert',
    icon: ScanText,
    input: 'pdf',
    needsEdit: false,
    structural: false,
  },
  { id: 'stamp', group: 'edit', icon: Stamp, input: 'pdf', needsEdit: true, structural: false },
  {
    id: 'annotate',
    group: 'edit',
    icon: PenLine,
    input: 'pdf',
    needsEdit: true,
    structural: false,
  },
  {
    id: 'form',
    group: 'edit',
    icon: TextCursorInput,
    input: 'pdf',
    needsEdit: true,
    structural: false,
  },
  { id: 'meta', group: 'edit', icon: Tags, input: 'pdf', needsEdit: true, structural: false },
  {
    id: 'compress',
    group: 'edit',
    icon: Minimize2,
    input: 'pdf',
    needsEdit: false,
    structural: false,
  },
  {
    id: 'unlock',
    group: 'edit',
    icon: LockOpen,
    input: 'pdf',
    needsEdit: false,
    structural: false,
  },
]

export const TOOL_GROUPS: ToolGroup[] = ['view', 'convert', 'edit']

export const toolById = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>

export const isToolId = (v: string | null): v is ToolId => !!v && v in toolById

export const toolName = (id: ToolId) => `pdf.tools.${id}.name` as TKey
export const toolDesc = (id: ToolId) => `pdf.tools.${id}.desc` as TKey
