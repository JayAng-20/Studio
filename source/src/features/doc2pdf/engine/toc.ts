/** 目錄項目與書籤樹（純函式，介面的結構預覽也用同一套規則） */
import { collectHeadings, type DocModel } from './model'

export interface TocEntry {
  id: string
  /** 正規化後的層級（1 起算） */
  level: number
  text: string
  number?: string
}

export interface OutlineNode {
  title: string
  dest: string
  children: OutlineNode[]
}

export const docAnchor = (i: number) => `doc:${i}`

/**
 * 從文件取出目錄項目：層級正規化（文件最高層標題算第 1 層）。
 * 單一文件的唯一 H1 視為文件標題、不列入；多份文件時，沒有以最高層標題開頭的文件補一個檔案項目。
 */
export function buildEntries(docs: DocModel[], headingNumbers: Map<string, string>): TocEntry[] {
  const out: TocEntry[] = []
  docs.forEach((doc, i) => {
    let hs = collectHeadings(doc).filter((h) => h.text)
    let min = hs.length ? Math.min(...hs.map((h) => h.level)) : 1
    // 單一文件：唯一的最高層標題在最前面時，它是文件標題，不放進目錄（下一層提升為第 1 層）
    if (
      docs.length === 1 &&
      hs.length > 1 &&
      hs[0].level === min &&
      hs.filter((h) => h.level === min).length === 1
    ) {
      hs = hs.slice(1)
      min = Math.min(...hs.map((h) => h.level))
    }
    let shift = 1 - min
    if (docs.length > 1) {
      const first = doc.blocks[0]
      const startsWithTop =
        first?.type === 'heading' &&
        first.level === min &&
        hs.filter((h) => h.level === min).length === 1
      if (!startsWithTop) {
        if (
          first?.type === 'heading' &&
          hs[0] &&
          hs[0].id === first.id &&
          hs[0].text === doc.title
        ) {
          // 第一個標題就是文件標題：用它當檔案項目，其餘往下一層
          out.push({
            id: hs[0].id,
            level: 1,
            text: hs[0].text,
            number: headingNumbers.get(hs[0].id),
          })
          hs = hs.slice(1)
        } else out.push({ id: docAnchor(i), level: 1, text: doc.title })
        shift += 1
      }
    }
    for (const h of hs)
      out.push({ id: h.id, level: h.level + shift, text: h.text, number: headingNumbers.get(h.id) })
  })
  return out
}

/** 由扁平的目錄項目建立書籤階層樹（層級跳號時接到最近的上層） */
export function buildOutlineTree(
  entries: { id: string; level: number; text: string; number?: string }[],
): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: { level: number; node: OutlineNode }[] = []
  for (const e of entries) {
    const node: OutlineNode = {
      title: e.number ? `${e.number} ${e.text}` : e.text,
      dest: e.id,
      children: [],
    }
    while (stack.length && stack[stack.length - 1].level >= e.level) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else roots.push(node)
    stack.push({ level: e.level, node })
  }
  return roots
}
