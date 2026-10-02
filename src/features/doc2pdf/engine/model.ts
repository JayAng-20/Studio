/**
 * 文件內部模型：Markdown／RTF／TXT 都先轉成這個結構，再交給排版引擎。
 * 全部是可結構化複製（structured clone）的純資料，可以在 Worker 與主執行緒之間傳遞。
 */

export type SourceKind = 'md' | 'txt' | 'rtf'

/** 行內樣式片段；text 內的 '\n' 代表強制換行 */
export interface Run {
  text: string
  b?: boolean
  i?: boolean
  /** 刪除線 */
  s?: boolean
  /** 底線 */
  u?: boolean
  /** 行內程式碼 */
  code?: boolean
  /** 連結：http(s)／mailto 等為外部 URI；以 # 開頭為文件內錨點 */
  link?: string
  /** 字級倍率（RTF 的 \fs 相對於內文；1 為內文大小） */
  scale?: number
}

export type Align = 'left' | 'center' | 'right' | 'justify'

export interface HeadingBlock {
  type: 'heading'
  level: 1 | 2 | 3 | 4 | 5 | 6
  runs: Run[]
  /** 文件內唯一 id（目錄、書籤、內部連結用） */
  id: string
  /** GitHub 風格的 slug（給 [文字](#slug) 內部連結比對） */
  slug: string
  align?: Align
}

export interface ParagraphBlock {
  type: 'paragraph'
  runs: Run[]
  align?: Align
  /** 首行縮排（中文段落常見的兩字縮排） */
  indent?: boolean
}

export interface CodeBlock {
  type: 'code'
  text: string
  lang?: string
  /** 純文字「保持原樣」模式：等寬但不畫底色框 */
  plain?: boolean
}

export interface QuoteBlock {
  type: 'quote'
  blocks: Block[]
}

export interface ListItem {
  /** null：一般項目；true／false：任務清單（已完成／未完成） */
  task: boolean | null
  blocks: Block[]
  /** 自訂項目符號（RTF／TXT 原始的符號，例如「①」）；未提供時依層級畫預設符號 */
  marker?: string
}

export interface ListBlock {
  type: 'list'
  ordered: boolean
  start: number
  items: ListItem[]
}

export interface TableCell {
  runs: Run[]
  align?: Align
}

export interface TableBlock {
  type: 'table'
  rows: TableCell[][]
  /** 表頭列數（0 表示沒有表頭） */
  headerRows: number
  /** 各欄對齊（Markdown 的 :---:） */
  align: (Align | null)[]
}

export interface ImageData {
  bytes: Uint8Array
  format: 'png' | 'jpg'
  width: number
  height: number
}

export interface ImageBlock {
  type: 'image'
  src: string
  alt: string
  title?: string
  /** 已解析的影像資料；沒有時畫替代文字框 */
  data?: ImageData
  /** 無法嵌入的原因 */
  missing?: 'external' | 'notFound' | 'unsupported'
  /** 原始寬度提示（RTF 的 \picwgoal，單位 pt） */
  widthHint?: number
}

export interface RuleBlock {
  type: 'hr'
}

export interface PageBreakBlock {
  type: 'pageBreak'
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | CodeBlock
  | QuoteBlock
  | ListBlock
  | TableBlock
  | ImageBlock
  | RuleBlock
  | PageBreakBlock

export interface DocStats {
  headings: number
  tables: number
  lists: number
  codeBlocks: number
  images: number
  paragraphs: number
  chars: number
}

export interface DocModel {
  /** 來源檔名（含副檔名） */
  name: string
  kind: SourceKind
  /** 第一個 H1（或檔名） */
  title: string
  blocks: Block[]
}

/** 目錄草稿（結構預覽用）：扁平的標題清單 */
export interface HeadingInfo {
  id: string
  level: number
  text: string
}

export const runsText = (runs: Run[]) => runs.map((r) => r.text).join('')

/** 走訪所有區塊（含引用、清單內部） */
export function walkBlocks(blocks: Block[], fn: (b: Block) => void) {
  for (const b of blocks) {
    fn(b)
    if (b.type === 'quote') walkBlocks(b.blocks, fn)
    else if (b.type === 'list') for (const it of b.items) walkBlocks(it.blocks, fn)
  }
}

export function collectHeadings(doc: DocModel): HeadingInfo[] {
  const out: HeadingInfo[] = []
  walkBlocks(doc.blocks, (b) => {
    if (b.type === 'heading') out.push({ id: b.id, level: b.level, text: runsText(b.runs).replace(/[ \t\r\n]+/g, ' ').trim() })
  })
  return out
}

export function docStats(doc: DocModel): DocStats {
  const s: DocStats = { headings: 0, tables: 0, lists: 0, codeBlocks: 0, images: 0, paragraphs: 0, chars: 0 }
  walkBlocks(doc.blocks, (b) => {
    switch (b.type) {
      case 'heading':
        s.headings++
        s.chars += runsText(b.runs).length
        break
      case 'paragraph':
        s.paragraphs++
        s.chars += runsText(b.runs).length
        break
      case 'table':
        s.tables++
        for (const r of b.rows) for (const c of r) s.chars += runsText(c.runs).length
        break
      case 'list':
        s.lists++
        break
      case 'code':
        s.codeBlocks++
        s.chars += b.text.length
        break
      case 'image':
        s.images++
        break
    }
  })
  return s
}

/** GitHub 風格的標題 slug：小寫、去標點、空白轉 -（保留中日韓文字） */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u2000-\u206f\u2e00-\u2e7f\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~\u3000-\u3003\u3008-\u3011\uff01-\uff0f\uff1a-\uff20]/g, '')
    .replace(/\s/g, '-')
}

/** 依序產生唯一 slug（重複時加 -1、-2，與 GitHub 相同） */
export function createSlugger() {
  const seen = new Map<string, number>()
  return (text: string) => {
    const base = slugify(text)
    const n = seen.get(base)
    if (n === undefined) {
      seen.set(base, 0)
      return base
    }
    seen.set(base, n + 1)
    return `${base}-${n + 1}`
  }
}

/** 第一個 H1 的文字 */
export function findTitle(blocks: Block[]): string | null {
  for (const b of blocks) {
    if (b.type === 'heading' && b.level === 1) {
      const t = runsText(b.runs).replace(/\s+/g, ' ').trim()
      if (t) return t
    }
  }
  return null
}
