/**
 * Markdown → 內部文件模型。用 marked 的 lexer 取得 token（GFM：表格、任務清單、刪除線、自動連結），
 * 再自己轉成 Block／Run；行內 HTML 標籤（<b>、<i>、<u>、<s>、<code>、<br>…）轉成樣式。
 */
import { Lexer, type Token, type Tokens } from 'marked'
import {
  findTitle,
  createSlugger,
  runsText,
  type Align,
  type Block,
  type DocModel,
  type HeadingBlock,
  type ListItem,
  type Run,
  type TableCell,
} from './model'
import { decodeEntities, stripHtml } from './text'
import { splitExt } from '@/lib/filename'

type Style = Omit<Run, 'text'>

interface Ctx {
  slug: (t: string) => string
  nextId: () => string
}

/** 行內 HTML 標籤對應的樣式 */
const TAG_STYLE: Record<string, keyof Style> = {
  b: 'b',
  strong: 'b',
  i: 'i',
  em: 'i',
  cite: 'i',
  u: 'u',
  ins: 'u',
  s: 's',
  del: 's',
  strike: 's',
  code: 'code',
  kbd: 'code',
  tt: 'code',
}

/** 分頁符號：單獨一行的 <!-- pagebreak -->、\newpage、\pagebreak */
const PAGE_BREAK = /^\s*(<!--\s*page-?break\s*-->|\\newpage|\\pagebreak)\s*$/i

export function parseMarkdown(src: string, name: string, idPrefix = 'h'): DocModel {
  let n = 0
  const ctx: Ctx = { slug: createSlugger(), nextId: () => `${idPrefix}${n++}` }
  // 把分頁符號換成獨立的 HTML 區塊標記，lexer 會原樣保留
  const normalized = src
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*(\\newpage|\\pagebreak)\s*$/gim, '<!-- pagebreak -->')
  const tokens = new Lexer({ gfm: true, breaks: false }).lex(normalized)
  const blocks = convertBlocks(tokens, ctx)
  const firstH1 = findTitle(blocks)
  return { name, kind: 'md', title: firstH1 ?? splitExt(name).base, blocks }
}

function convertBlocks(tokens: Token[], ctx: Ctx): Block[] {
  const out: Block[] = []
  for (const tok of tokens) {
    switch (tok.type) {
      case 'heading': {
        const t = tok as Tokens.Heading
        const runs = trimRuns(inline(t.tokens, {}, ctx))
        const text = runsText(runs)
        out.push({
          type: 'heading',
          level: Math.min(6, Math.max(1, t.depth)) as HeadingBlock['level'],
          runs,
          id: ctx.nextId(),
          slug: ctx.slug(text),
        })
        break
      }
      case 'paragraph':
        pushParagraphWithImages(out, (tok as Tokens.Paragraph).tokens, ctx)
        break
      case 'text': {
        // 緊湊清單中的文字（有行內 token）
        const t = tok as Tokens.Text
        if (t.tokens) pushParagraphWithImages(out, t.tokens, ctx)
        else if (t.text.trim())
          out.push({ type: 'paragraph', runs: [{ text: decodeEntities(t.text) }] })
        break
      }
      case 'code': {
        const t = tok as Tokens.Code
        out.push({ type: 'code', text: t.text.replace(/\n+$/, ''), lang: t.lang || undefined })
        break
      }
      case 'blockquote':
        out.push({ type: 'quote', blocks: convertBlocks((tok as Tokens.Blockquote).tokens, ctx) })
        break
      case 'list': {
        const t = tok as Tokens.List
        const items: ListItem[] = t.items.map((it) => ({
          task: it.task ? !!it.checked : null,
          blocks: convertBlocks(
            it.tokens.filter((x) => x.type !== 'checkbox'),
            ctx,
          ),
        }))
        const start = typeof t.start === 'number' ? t.start : parseInt(String(t.start), 10) || 1
        out.push({ type: 'list', ordered: t.ordered, start, items })
        break
      }
      case 'table': {
        const t = tok as Tokens.Table
        const align: (Align | null)[] = t.align.map((a) => a ?? null)
        const cell = (c: Tokens.TableCell): TableCell => ({
          runs: trimRuns(inline(c.tokens, {}, ctx)),
        })
        const rows = [t.header.map(cell), ...t.rows.map((r) => r.map(cell))]
        // 補齊欄數不一致的列
        const cols = Math.max(...rows.map((r) => r.length))
        for (const r of rows) while (r.length < cols) r.push({ runs: [] })
        while (align.length < cols) align.push(null)
        out.push({ type: 'table', rows, headerRows: 1, align })
        break
      }
      case 'hr':
        out.push({ type: 'hr' })
        break
      case 'html': {
        const t = tok as Tokens.HTML
        if (PAGE_BREAK.test(t.text) || /page-break-(after|before)\s*:\s*always/i.test(t.text)) {
          out.push({ type: 'pageBreak' })
          break
        }
        // HTML 區塊：<img> 轉成圖片，其餘去標籤後當文字
        const imgs = [...t.text.matchAll(/<img\b[^>]*>/gi)]
        for (const m of imgs) {
          const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1]
          const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? ''
          if (src) out.push({ type: 'image', src: decodeEntities(src), alt: decodeEntities(alt) })
        }
        const text = stripHtml(t.text)
        if (text) {
          for (const para of text.split(/\n{2,}/)) {
            if (para.trim()) out.push({ type: 'paragraph', runs: [{ text: para.trim() }] })
          }
        }
        break
      }
      case 'def':
      case 'space':
        break
      default: {
        // 不認得的區塊（擴充語法）：保留原文
        const raw = (tok as { text?: string; raw?: string }).text ?? (tok as { raw?: string }).raw
        if (raw && raw.trim()) out.push({ type: 'paragraph', runs: [{ text: raw.trim() }] })
      }
    }
  }
  return out
}

/** 段落中的圖片獨立成區塊（段落在圖片位置切開） */
function pushParagraphWithImages(out: Block[], tokens: Token[], ctx: Ctx) {
  let buf: Token[] = []
  const flush = () => {
    const runs = trimRuns(inline(buf, {}, ctx))
    if (runs.some((r) => r.text.trim())) out.push({ type: 'paragraph', runs })
    buf = []
  }
  for (const tok of tokens) {
    if (tok.type === 'image') {
      flush()
      const t = tok as Tokens.Image
      out.push({
        type: 'image',
        src: t.href,
        alt: decodeEntities(t.text),
        title: t.title ?? undefined,
      })
    } else if (
      tok.type === 'link' &&
      (tok as Tokens.Link).tokens.length === 1 &&
      (tok as Tokens.Link).tokens[0].type === 'image'
    ) {
      // [![alt](img)](url)：只保留圖片
      flush()
      const img = (tok as Tokens.Link).tokens[0] as Tokens.Image
      out.push({
        type: 'image',
        src: img.href,
        alt: decodeEntities(img.text),
        title: img.title ?? undefined,
      })
    } else buf.push(tok)
  }
  flush()
}

function inline(tokens: Token[] | undefined, style: Style, ctx: Ctx): Run[] {
  if (!tokens) return []
  const out: Run[] = []
  // 行內 HTML 開關標籤造成的樣式堆疊
  const htmlStack: (keyof Style)[] = []
  const cur = (): Style => {
    const s: Style = { ...style }
    for (const k of htmlStack) (s as Record<string, unknown>)[k] = true
    return s
  }
  for (const tok of tokens) {
    switch (tok.type) {
      case 'text': {
        const t = tok as Tokens.Text
        if (t.tokens && t.tokens.length) out.push(...inline(t.tokens, cur(), ctx))
        else out.push({ ...cur(), text: decodeEntities(t.text) })
        break
      }
      case 'escape':
        out.push({ ...cur(), text: (tok as Tokens.Escape).text })
        break
      case 'strong':
        out.push(...inline((tok as Tokens.Strong).tokens, { ...cur(), b: true }, ctx))
        break
      case 'em':
        out.push(...inline((tok as Tokens.Em).tokens, { ...cur(), i: true }, ctx))
        break
      case 'del':
        out.push(...inline((tok as Tokens.Del).tokens, { ...cur(), s: true }, ctx))
        break
      case 'codespan':
        out.push({ ...cur(), code: true, text: decodeEntities((tok as Tokens.Codespan).text) })
        break
      case 'br':
        out.push({ ...cur(), text: HARD_BREAK })
        break
      case 'link': {
        const t = tok as Tokens.Link
        const href = t.href.trim()
        out.push(...inline(t.tokens, { ...cur(), link: href || undefined }, ctx))
        break
      }
      case 'image': {
        // 行內圖片（出現在標題、表格等無法切段的位置）：以替代文字顯示
        const t = tok as Tokens.Image
        if (t.text) out.push({ ...cur(), i: true, text: `[${decodeEntities(t.text)}]` })
        break
      }
      case 'html': {
        const raw = (tok as Tokens.Tag).text
        const m = /^<\s*(\/)?\s*([a-z0-9]+)[^>]*?(\/)?\s*>$/i.exec(raw.trim())
        if (m) {
          const tag = m[2].toLowerCase()
          if (tag === 'br') out.push({ ...cur(), text: HARD_BREAK })
          else if (TAG_STYLE[tag]) {
            if (m[1]) {
              const idx = htmlStack.lastIndexOf(TAG_STYLE[tag])
              if (idx >= 0) htmlStack.splice(idx, 1)
            } else if (!m[3]) htmlStack.push(TAG_STYLE[tag])
          }
        } else {
          const text = stripHtml(raw)
          if (text) out.push({ ...cur(), text })
        }
        break
      }
      default: {
        const raw = (tok as { text?: string }).text
        if (raw) out.push({ ...cur(), text: decodeEntities(raw) })
      }
    }
  }
  return mergeRuns(out)
}

const sameStyle = (a: Run, b: Run) =>
  !!a.b === !!b.b &&
  !!a.i === !!b.i &&
  !!a.s === !!b.s &&
  !!a.u === !!b.u &&
  !!a.code === !!b.code &&
  a.link === b.link &&
  (a.scale ?? 1) === (b.scale ?? 1)

/** 合併相鄰同樣式的片段、去掉空片段 */
export function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = []
  for (const r of runs) {
    if (!r.text) continue
    const last = out[out.length - 1]
    if (last && sameStyle(last, r)) last.text += r.text
    else out.push({ ...r })
  }
  return out
}

const CJK_CHAR = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/

/** 硬換行在行內轉換時先用 U+2028 表示，避免和 Markdown 的軟換行混淆 */
export const HARD_BREAK = '\u2028'

/**
 * 整理段落文字：Markdown 的軟換行（原文中的 \n）在拉丁文之間變成空白、在中日韓字之間直接接起來；
 * 硬換行（<br>、行尾兩個空白）還原成 \n；去掉段落頭尾空白。
 */
export function trimRuns(runs: Run[]): Run[] {
  const all = runs.map((r) => r.text).join('')
  let base = 0
  const out = runs.map((r) => {
    const offset = base
    base += r.text.length
    const text = r.text.replace(/[ \t]*\n[ \t]*/g, (m: string, off: number) => {
      if (r.code) return ' '
      const before = all
        .slice(0, offset + off)
        .trimEnd()
        .slice(-1)
      const after = all
        .slice(offset + off + m.length)
        .trimStart()
        .slice(0, 1)
      return CJK_CHAR.test(before) && CJK_CHAR.test(after) ? '' : ' '
    })
    return { ...r, text: text.replace(/\u2028/g, '\n') }
  })
  while (out.length && !out[0].text.trim()) out.shift()
  while (out.length && !out[out.length - 1].text.trim()) out.pop()
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, '')
    const l = out[out.length - 1]
    l.text = l.text.replace(/\s+$/, '')
  }
  return mergeRuns(out)
}
