/**
 * 塗黑遮蔽：有遮蔽框的頁面整頁以影像重建（框內塗黑），底下的文字、向量與影像都不再存在於檔案中；
 * 沒有遮蔽框的頁面原封不動複製。搜尋以 pdf.js 的文字內容推算每個字的位置。
 */
import type { PDFName as TName, PDFRef as TRef } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { canvasToBlob, releaseCanvas } from '@/lib/image'
import { app } from '@/config/app'
import { collectGarbage } from './acrobat'
import { loadForEdit } from './ops'
import { renderToCanvas } from './pdfjs'

export interface RRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export type RedactPreset = 'email' | 'phone' | 'twid' | 'card' | 'date'

export const PRESETS: Record<RedactPreset, RegExp> = {
  email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  phone:
    /(?:\+?886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}|\(?0\d{1,2}\)?[-\s]?\d{3,4}[-\s]?\d{4}|\+?\d{1,3}[-\s]\d{3}[-\s]\d{3,4}[-\s]\d{3,4}/g,
  twid: /[A-Z][12]\d{8}/g,
  card: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  date: /\b(?:19|20)\d{2}[-/.年](?:0?[1-9]|1[0-2])[-/.月](?:0?[1-9]|[12]\d|3[01])日?/g,
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

let seq = 0
const nid = () => `m${++seq}`

/**
 * 子字串在整段文字中的起訖比例（0–1）。有畫布時以相近字型實際量測字寬
 * （比例字型下 i 與 W 寬度差很多，單純用字數推算會讓塗黑框偏移、露出頭尾的字）；
 * 沒有畫布（Node 測試）時退回字數比例。
 */
export function spanRatio(
  str: string,
  start: number,
  end: number,
  measure?: (s: string) => number,
): [number, number] {
  const total = measure?.(str) ?? 0
  if (!measure || !(total > 0)) return [start / str.length, end / str.length]
  return [measure(str.slice(0, start)) / total, measure(str.slice(0, end)) / total]
}

function textMeasurer(): ((s: string, family: string) => number) | undefined {
  try {
    const c =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1).getContext('2d')
        : typeof document !== 'undefined'
          ? document.createElement('canvas').getContext('2d')
          : null
    if (!c) return undefined
    return (s, family) => {
      c.font = `100px ${family}`
      return c.measureText(s).width
    }
  } catch {
    return undefined
  }
}

/** 在整份文件中搜尋，回傳每頁的命中框（0–1 視覺座標） */
export async function findMatches(
  doc: PDFDocumentProxy,
  opts: { text?: string; presets: RedactPreset[]; caseSensitive?: boolean },
  signal?: AbortSignal,
): Promise<Map<number, RRect[]>> {
  const res: RegExp[] = opts.presets.map((p) => new RegExp(PRESETS[p].source, 'g'))
  const q = opts.text?.trim()
  if (q) res.push(new RegExp(escape(q), opts.caseSensitive ? 'g' : 'gi'))
  const out = new Map<number, RRect[]>()
  if (!res.length) return out
  const measure = textMeasurer()
  for (let p = 1; p <= doc.numPages; p++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    const rects: RRect[] = []
    for (const raw of tc.items) {
      const it = raw as {
        str?: string
        transform?: number[]
        width?: number
        height?: number
        fontName?: string
      }
      if (!it.str || !it.transform) continue
      const [a, b, c, d, e, f] = it.transform
      const h = it.height || Math.hypot(c, d)
      const len = it.str.length
      const family = (it.fontName && tc.styles[it.fontName]?.fontFamily) || 'sans-serif'
      const m1 = measure ? (s: string) => measure(s, family) : undefined
      for (const re of res) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(it.str))) {
          if (!m[0]) {
            re.lastIndex++
            continue
          }
          // 推算子字串位置（文字方向沿 transform 的 a、b）
          const [s0, s1] = spanRatio(it.str, m.index, m.index + m[0].length, m1)
          const w = it.width ?? 0
          const ux = Math.hypot(a, b) ? a / Math.hypot(a, b) : 1
          const uy = Math.hypot(a, b) ? b / Math.hypot(a, b) : 0
          const x0 = e + ux * w * s0
          const y0 = f + uy * w * s0
          const x1 = e + ux * w * s1
          const y1 = f + uy * w * s1
          const pts = [
            [x0 - uy * -h * 0.25, y0 + ux * -h * 0.25],
            [x1 - uy * -h * 0.25, y1 + ux * -h * 0.25],
            [x0 - uy * h * 0.95, y0 + ux * h * 0.95],
            [x1 - uy * h * 0.95, y1 + ux * h * 0.95],
          ].map(([x, y]) => vp.convertToViewportPoint(x, y))
          const xs = pts.map((q) => q[0])
          const ys = pts.map((q) => q[1])
          // 字寬是以近似字型量測的，左右各多留約 0.6 個字寬，確保完整蓋住
          const px = Math.max(1.5, (w / len) * 0.6)
          const py = 1
          rects.push({
            id: nid(),
            x: Math.max(0, (Math.min(...xs) - px) / vp.width),
            y: Math.max(0, (Math.min(...ys) - py) / vp.height),
            w: (Math.max(...xs) - Math.min(...xs) + 2 * px) / vp.width,
            h: (Math.max(...ys) - Math.min(...ys) + 2 * py) / vp.height,
          })
        }
      }
    }
    page.cleanup()
    if (rects.length) out.set(p - 1, rects)
  }
  return out
}

/** 套用遮蔽，回傳新的 PDF */
export async function applyRedactions(
  bytes: Uint8Array,
  doc: PDFDocumentProxy,
  rects: Map<number, RRect[]>,
  o: { dpi: number; color: string; stripMeta: boolean },
  signal?: AbortSignal,
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFNumber, PDFStream } =
    await import('pdf-lib')
  const src = await loadForEdit(bytes)
  const out = await PDFDocument.create({ updateMetadata: false })
  if (!o.stripMeta) {
    const title = src.getTitle()
    const author = src.getAuthor()
    if (title) out.setTitle(title)
    if (author) out.setAuthor(author)
  }
  out.setProducer(app.name)
  out.setCreator(app.name)
  const n = src.getPageCount()
  const srcPages = src.getPages()
  const redacted = new Set<number>()
  for (let i = 0; i < n; i++) if (rects.get(i)?.length) redacted.add(i)
  const redactedRefs = new Set([...redacted].map((i) => srcPages[i].ref.toString()))
  const N = (k: string) => PDFName.of(k)
  // 先清空要塗黑的頁面：其他頁的連結（/Dest）、註解（/IRT、/P）仍可能指向這些頁，
  // 若保留原內容，複製時會被一併帶進輸出檔，底下的文字就沒有真的消失
  for (const i of redacted) {
    const node = srcPages[i].node
    const vp = (await doc.getPage(i + 1)).getViewport({ scale: 1 })
    // 這頁的註解可能經由表單欄位或回覆被其他頁參照：清掉外觀與文字內容
    const annots = node.lookupMaybe(N('Annots'), PDFArray)
    for (let k = 0; k < (annots?.size() ?? 0); k++) {
      const a = annots!.lookup(k)
      if (a instanceof PDFDict)
        for (const key of ['AP', 'Contents', 'RC', 'V', 'DV', 'A', 'AA', 'Popup', 'IRT'])
          a.delete(N(key))
    }
    for (const k of [
      'Contents',
      'Annots',
      'Thumb',
      'B',
      'PieceInfo',
      'Metadata',
      'AA',
      'StructParents',
      'CropBox',
      'TrimBox',
      'BleedBox',
      'ArtBox',
      'Group',
      'VP',
    ])
      node.delete(N(k))
    // 明確設定可繼承的屬性，避免複製時從上層 /Pages 帶入原本的資源
    node.set(N('Resources'), src.context.obj({}))
    node.set(N('MediaBox'), src.context.obj([0, 0, vp.width, vp.height]))
    node.set(N('Rotate'), src.context.obj(0))
  }
  // 其他頁上回覆／指向塗黑頁註解的關聯也切斷
  for (let i = 0; i < n; i++) {
    if (redacted.has(i)) continue
    const annots = srcPages[i].node.lookupMaybe(N('Annots'), PDFArray)
    if (!annots) continue
    for (let k = 0; k < annots.size(); k++) {
      const a = annots.lookup(k)
      if (!(a instanceof PDFDict)) continue
      for (const key of ['IRT', 'Popup']) {
        const ref = a.get(N(key))
        if (!(ref instanceof PDFRef)) continue
        const target = src.context.lookup(ref)
        const pg = target instanceof PDFDict ? target.get(N('P')) : undefined
        if (pg instanceof PDFRef && redactedRefs.has(pg.toString())) a.delete(N(key))
      }
    }
  }
  // pdf-lib 複製時，連結、註解 /P 指到的頁面會另外複製一份（不在頁面樹裡）；
  // 先標上頁碼，複製完再把這些參照改回輸出檔中的正式頁面
  const TAG = N('JayangPageIndex')
  srcPages.forEach((p, i) => p.node.set(TAG, PDFNumber.of(i)))
  const copied = await out.copyPages(
    src,
    Array.from({ length: n }, (_, i) => i),
  )
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const np = out.addPage(copied[i])
    const list = rects.get(i)
    if (list?.length) {
      const page = await doc.getPage(i + 1)
      const vp = page.getViewport({ scale: 1 })
      const canvas = await renderToCanvas(page, o.dpi / 72, { signal })
      try {
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = o.color
        for (const r of list)
          ctx.fillRect(
            Math.floor(r.x * canvas.width),
            Math.floor(r.y * canvas.height),
            Math.ceil(r.w * canvas.width) + 1,
            Math.ceil(r.h * canvas.height) + 1,
          )
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
        const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()))
        np.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height })
      } finally {
        releaseCanvas(canvas)
        page.cleanup()
      }
    }
    onProgress?.((i + 1) / n)
  }
  const octx = out.context
  const relink = (o: unknown) => {
    if (o instanceof PDFStream) relink(o.dict)
    else if (o instanceof PDFDict || o instanceof PDFArray) {
      const set = (k: TName | number, v: TRef) =>
        o instanceof PDFDict ? o.set(k as TName, v) : o.set(k as number, v)
      const entries: Array<[TName | number, unknown]> =
        o instanceof PDFDict ? o.entries() : o.asArray().map((v, i) => [i, v])
      for (const [k, v] of entries) {
        if (v instanceof PDFRef) {
          const target = octx.lookup(v)
          const idx = target instanceof PDFDict ? target.get(TAG) : undefined
          if (
            idx instanceof PDFNumber &&
            copied[idx.asNumber()] &&
            copied[idx.asNumber()].ref !== v
          )
            set(k, copied[idx.asNumber()].ref)
        } else relink(v)
      }
    }
  }
  for (const [, obj] of octx.enumerateIndirectObjects()) relink(obj)
  for (const [, obj] of octx.enumerateIndirectObjects()) if (obj instanceof PDFDict) obj.delete(TAG)
  await collectGarbage(out)
  return out.save({ useObjectStreams: true })
}
