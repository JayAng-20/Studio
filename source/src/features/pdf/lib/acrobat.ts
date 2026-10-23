/**
 * 專業 PDF 功能（純資料進出：Uint8Array → Uint8Array，可在 Node 測試）：
 * 裁切頁面、頁面尺寸、多頁合一／小冊子、書籤、附件、清除隱藏資訊、最佳化與修復。
 */
import type { PDFDocument, PDFEmbeddedPage, PDFPage, PDFRef, PDFDict } from 'pdf-lib'
import { app } from '@/config/app'
import { loadForEdit, PdfOpError } from './ops'
import { normRotation, visualToPdf, type Size } from './placement'

const lib = () => import('pdf-lib')
const abortIf = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** 頁面的裁切框（含原點）與旋轉 */
function geo(page: PDFPage) {
  const b = page.getCropBox()
  return { x: b.x, y: b.y, width: b.width, height: b.height, rotation: normRotation(page.getRotation().angle) }
}

const visual = (g: ReturnType<typeof geo>): Size =>
  g.rotation === 90 || g.rotation === 270 ? { w: g.height, h: g.width } : { w: g.width, h: g.height }

async function newDocFrom(src?: PDFDocument): Promise<PDFDocument> {
  const { PDFDocument } = await lib()
  const doc = await PDFDocument.create({ updateMetadata: false })
  if (src) {
    const title = src.getTitle()
    const author = src.getAuthor()
    if (title) doc.setTitle(title)
    if (author) doc.setAuthor(author)
  }
  doc.setProducer(app.name)
  doc.setCreator(app.name)
  doc.setCreationDate(new Date())
  doc.setModificationDate(new Date())
  return doc
}

/* ---------- 裁切頁面 ---------- */

/** 視覺座標 0–1 的保留區域 */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** 設定 CropBox（不刪除內容，只是隱藏框外部分；可再用裁切工具還原成整頁） */
export async function cropPages(
  bytes: Uint8Array,
  rectFor: (pageIndex: number) => CropRect | null,
): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes)
  doc.getPages().forEach((page, i) => {
    const r = rectFor(i)
    if (!r) return
    const g = geo(page)
    const v = visual(g)
    const a = visualToPdf(g, r.x * v.w, r.y * v.h)
    const b = visualToPdf(g, (r.x + r.w) * v.w, (r.y + r.h) * v.h)
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(a.x - b.x)
    const h = Math.abs(a.y - b.y)
    if (w < 1 || h < 1) return
    page.setCropBox(x, y, w, h)
    // TrimBox／ArtBox 若超出新的裁切框，一併收斂，避免檢視器顯示不一致
    page.setTrimBox(x, y, w, h)
  })
  return doc.save({ useObjectStreams: true })
}

/** 從低解析度渲染的像素找出內容範圍（0–1 比例，視覺座標） */
export function contentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 245,
): CropRect | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX / width, y: minY / height, w: (maxX - minX + 1) / width, h: (maxY - minY + 1) / height }
}

/* ---------- 把頁面畫到新紙張上（頁面尺寸、多頁合一共用） ---------- */

/**
 * 把一頁（含 /Rotate）畫進新頁面的視覺框 (X, Y, W, H) 內：等比縮放、置中。
 * embedPage 不會套用 /Rotate，所以這裡自己旋轉。
 */
function drawFitted(
  target: PDFPage,
  emb: PDFEmbeddedPage,
  rotation: number,
  box: { x: number; y: number; w: number; h: number },
  degrees: (d: number) => ReturnType<typeof import('pdf-lib').degrees>,
  mode: 'fit' | 'fill' = 'fit',
) {
  const w = emb.width
  const h = emb.height
  const vw = rotation === 90 || rotation === 270 ? h : w
  const vh = rotation === 90 || rotation === 270 ? w : h
  const s = mode === 'fit' ? Math.min(box.w / vw, box.h / vh) : Math.max(box.w / vw, box.h / vh)
  const X = box.x + (box.w - vw * s) / 2
  const Y = box.y + (box.h - vh * s) / 2
  let x = X
  let y = Y
  let rot = 0
  if (rotation === 90) {
    y = Y + w * s
    rot = -90
  } else if (rotation === 180) {
    x = X + w * s
    y = Y + h * s
    rot = 180
  } else if (rotation === 270) {
    x = X + h * s
    rot = 90
  }
  target.drawPage(emb, { x, y, xScale: s, yScale: s, rotate: degrees(rot) })
}

async function embedAll(out: PDFDocument, src: PDFDocument) {
  const pages = src.getPages()
  const boxes = pages.map((p) => {
    const b = p.getCropBox()
    return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }
  })
  return out.embedPages(pages, boxes)
}

export type PaperId = 'a3' | 'a4' | 'a5' | 'b5' | 'letter' | 'legal' | 'tabloid'
export const PAPERS: Record<PaperId, [number, number]> = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  b5: [498.9, 708.66],
  letter: [612, 792],
  legal: [612, 1008],
  tabloid: [792, 1224],
}

export interface ResizeOptions {
  paper: PaperId | 'custom'
  /** 自訂尺寸（pt） */
  custom?: Size
  orientation: 'auto' | 'portrait' | 'landscape'
  /** 邊距（pt） */
  margin: number
  mode: 'fit' | 'fill'
  pages?: number[]
}

export async function resizePages(
  bytes: Uint8Array,
  o: ResizeOptions,
  signal?: AbortSignal,
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const { degrees } = await lib()
  const src = await loadForEdit(bytes)
  const out = await newDocFrom(src)
  const embedded = await embedAll(out, src)
  const pages = src.getPages()
  const only = o.pages ? new Set(o.pages) : null
  const [pw, ph] = o.paper === 'custom' ? [o.custom?.w ?? 595, o.custom?.h ?? 842] : PAPERS[o.paper]
  for (let i = 0; i < pages.length; i++) {
    abortIf(signal)
    const g = geo(pages[i])
    const v = visual(g)
    if (only && !only.has(i)) {
      const page = out.addPage([v.w, v.h])
      drawFitted(page, embedded[i], g.rotation, { x: 0, y: 0, w: v.w, h: v.h }, degrees)
      continue
    }
    const landscape = o.orientation === 'auto' ? v.w > v.h : o.orientation === 'landscape'
    const W = landscape ? Math.max(pw, ph) : Math.min(pw, ph)
    const H = landscape ? Math.min(pw, ph) : Math.max(pw, ph)
    const page = out.addPage([W, H])
    const m = Math.min(o.margin, W / 3, H / 3)
    drawFitted(page, embedded[i], g.rotation, { x: m, y: m, w: W - 2 * m, h: H - 2 * m }, degrees, o.mode)
    onProgress?.((i + 1) / pages.length)
    if (i % 20 === 19) await tick()
  }
  return out.save({ useObjectStreams: true })
}

/* ---------- 多頁合一與小冊子 ---------- */

export type NUp = 2 | 4 | 6 | 9 | 16
export const NUP_GRID: Record<NUp, { cols: number; rows: number; landscape: boolean }> = {
  2: { cols: 2, rows: 1, landscape: true },
  4: { cols: 2, rows: 2, landscape: false },
  6: { cols: 3, rows: 2, landscape: true },
  9: { cols: 3, rows: 3, landscape: false },
  16: { cols: 4, rows: 4, landscape: false },
}

export interface LayoutOptions {
  mode: 'nup' | 'booklet'
  n: NUp
  paper: PaperId
  /** 排列順序：z＝先橫後直、n＝先直後橫 */
  order: 'z' | 'n'
  /** 由右而左（直書、右翻） */
  rtl: boolean
  margin: number
  gap: number
  border: boolean
}

/** 小冊子（騎馬釘）拼版：每張紙正反兩面，各放左右兩頁；不足 4 的倍數補空白（-1） */
export function bookletOrder(count: number, rtl = false): Array<[number, number]> {
  const total = Math.ceil(count / 4) * 4
  const at = (i: number) => (i < count ? i : -1)
  const sides: Array<[number, number]> = []
  for (let k = 0; k < total / 4; k++) {
    const front: [number, number] = [at(total - 1 - 2 * k), at(2 * k)]
    const back: [number, number] = [at(2 * k + 1), at(total - 2 - 2 * k)]
    sides.push(rtl ? [front[1], front[0]] : front, rtl ? [back[1], back[0]] : back)
  }
  return sides
}

/** 多頁合一：每張紙上的格子對應到哪些頁（-1 為空格） */
export function nupOrder(count: number, n: NUp, order: 'z' | 'n', rtl: boolean): number[][] {
  const { cols, rows } = NUP_GRID[n]
  const sheets: number[][] = []
  for (let s = 0; s * n < count; s++) {
    const cells: number[] = new Array(n).fill(-1)
    for (let k = 0; k < n; k++) {
      const idx = s * n + k
      if (idx >= count) break
      let c = order === 'z' ? k % cols : Math.floor(k / rows)
      const r = order === 'z' ? Math.floor(k / cols) : k % rows
      if (rtl) c = cols - 1 - c
      cells[r * cols + c] = idx
    }
    sheets.push(cells)
  }
  return sheets
}

export async function layoutPages(
  bytes: Uint8Array,
  o: LayoutOptions,
  signal?: AbortSignal,
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const { degrees, rgb } = await lib()
  const src = await loadForEdit(bytes)
  const out = await newDocFrom(src)
  const pages = src.getPages()
  if (!pages.length) throw new PdfOpError('empty')
  const embedded = await embedAll(out, src)
  const [pw, ph] = PAPERS[o.paper]
  const sheets =
    o.mode === 'booklet'
      ? bookletOrder(pages.length, o.rtl).map((s) => [...s])
      : nupOrder(pages.length, o.n, o.order, o.rtl)
  const grid = o.mode === 'booklet' ? { cols: 2, rows: 1, landscape: true } : NUP_GRID[o.n]
  const W = grid.landscape ? Math.max(pw, ph) : Math.min(pw, ph)
  const H = grid.landscape ? Math.min(pw, ph) : Math.max(pw, ph)
  const m = o.margin
  const gap = o.mode === 'booklet' ? 0 : o.gap
  const cw = (W - 2 * m - gap * (grid.cols - 1)) / grid.cols
  const ch = (H - 2 * m - gap * (grid.rows - 1)) / grid.rows
  sheets.forEach((cells, si) => {
    abortIf(signal)
    const sheet = out.addPage([W, H])
    cells.forEach((idx, ci) => {
      const col = ci % grid.cols
      const row = Math.floor(ci / grid.cols)
      const box = { x: m + col * (cw + gap), y: H - m - (row + 1) * ch - row * gap, w: cw, h: ch }
      if (o.border && (idx >= 0 || o.mode === 'booklet'))
        sheet.drawRectangle({
          ...{ x: box.x, y: box.y, width: box.w, height: box.h },
          borderColor: rgb(0.75, 0.77, 0.8),
          borderWidth: 0.6,
        })
      if (idx < 0) return
      const g = geo(pages[idx])
      drawFitted(sheet, embedded[idx], g.rotation, box, degrees)
    })
    onProgress?.((si + 1) / sheets.length)
  })
  return out.save({ useObjectStreams: true })
}

/* ---------- 書籤 ---------- */

export interface BookmarkItem {
  id: string
  title: string
  /** 0 起算 */
  page: number
  /** 階層（0 為最上層） */
  level: number
}

/** 把扁平清單（依 level 縮排）寫成 /Outlines 樹；空清單時移除書籤 */
export async function writeBookmarks(bytes: Uint8Array, items: BookmarkItem[]): Promise<Uint8Array> {
  const { PDFName, PDFHexString, PDFNumber, PDFNull } = await lib()
  const doc = await loadForEdit(bytes)
  const ctx = doc.context
  const catalog = doc.catalog
  const pages = doc.getPages()
  catalog.delete(PDFName.of('Outlines'))
  if (!items.length) return doc.save({ useObjectStreams: true })

  interface Node {
    item: BookmarkItem
    ref: PDFRef
    dict: PDFDict
    children: Node[]
  }
  const rootRef = ctx.nextRef()
  const root = ctx.obj({ Type: 'Outlines' }) as PDFDict
  const top: Node[] = []
  const stack: Node[] = []
  for (const item of items) {
    const page = pages[Math.min(Math.max(0, item.page), pages.length - 1)]
    const dict = ctx.obj({}) as PDFDict
    dict.set(PDFName.of('Title'), PDFHexString.fromText(item.title.trim() || '—'))
    dict.set(
      PDFName.of('Dest'),
      ctx.obj([page.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]),
    )
    const node: Node = { item, ref: ctx.nextRef(), dict, children: [] }
    const level = Math.max(0, Math.min(item.level, stack.length))
    stack.length = level
    if (level === 0) top.push(node)
    else stack[level - 1].children.push(node)
    stack.push(node)
  }
  const link = (list: Node[], parent: PDFRef): number => {
    let count = 0
    list.forEach((n, i) => {
      n.dict.set(PDFName.of('Parent'), parent)
      if (i > 0) n.dict.set(PDFName.of('Prev'), list[i - 1].ref)
      if (i < list.length - 1) n.dict.set(PDFName.of('Next'), list[i + 1].ref)
      if (n.children.length) {
        const c = link(n.children, n.ref)
        n.dict.set(PDFName.of('First'), n.children[0].ref)
        n.dict.set(PDFName.of('Last'), n.children[n.children.length - 1].ref)
        // 正數＝預設展開
        n.dict.set(PDFName.of('Count'), PDFNumber.of(c))
        count += c
      }
      count++
      ctx.assign(n.ref, n.dict)
    })
    return count
  }
  const total = link(top, rootRef)
  root.set(PDFName.of('First'), top[0].ref)
  root.set(PDFName.of('Last'), top[top.length - 1].ref)
  root.set(PDFName.of('Count'), PDFNumber.of(total))
  ctx.assign(rootRef, root)
  catalog.set(PDFName.of('Outlines'), rootRef)
  catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
  return doc.save({ useObjectStreams: true })
}

/* ---------- 附件 ---------- */

export interface AttachmentFile {
  name: string
  data: Uint8Array
  mime?: string
  description?: string
}

/** 以新的附件清單取代文件層級的附件（頁面上的附件註解不受影響） */
export async function writeAttachments(bytes: Uint8Array, files: AttachmentFile[]): Promise<Uint8Array> {
  const { PDFName, PDFDict } = await lib()
  const doc = await loadForEdit(bytes)
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  names?.delete(PDFName.of('EmbeddedFiles'))
  doc.catalog.delete(PDFName.of('AF'))
  for (const f of files) {
    await doc.attach(f.data, f.name, {
      mimeType: f.mime || 'application/octet-stream',
      description: f.description,
      creationDate: new Date(),
      modificationDate: new Date(),
    })
  }
  return doc.save({ useObjectStreams: true })
}

/* ---------- 清除隱藏資訊 ---------- */

export interface SanitizeOptions {
  metadata: boolean
  javascript: boolean
  attachments: boolean
  annotations: boolean
  links: boolean
  forms: boolean
  bookmarks: boolean
  thumbnails: boolean
  layers: boolean
}

export type SanitizeReport = Partial<Record<keyof SanitizeOptions, number>>

export async function sanitizePdf(
  bytes: Uint8Array,
  o: SanitizeOptions,
): Promise<{ bytes: Uint8Array; report: SanitizeReport }> {
  const { PDFName, PDFDict, PDFArray } = await lib()
  const doc = await loadForEdit(bytes)
  const cat = doc.catalog
  const report: SanitizeReport = {}
  const bump = (k: keyof SanitizeOptions, n = 1) => (report[k] = (report[k] ?? 0) + n)
  const N = (s: string) => PDFName.of(s)

  if (o.forms) {
    try {
      const form = doc.getForm()
      const fields = form.getFields().length
      if (fields) {
        form.flatten({ updateFieldAppearances: true })
        bump('forms', fields)
      }
    } catch (e) {
      console.error(e)
    }
    if (cat.has(N('AcroForm'))) cat.delete(N('AcroForm'))
  }
  if (o.javascript) {
    const names = cat.lookupMaybe(N('Names'), PDFDict)
    if (names?.has(N('JavaScript'))) {
      names.delete(N('JavaScript'))
      bump('javascript')
    }
    for (const k of ['OpenAction', 'AA']) {
      const v = cat.lookup(N(k))
      if (v instanceof PDFDict && (v.has(N('JS')) || v.get(N('S')) === N('JavaScript'))) {
        cat.delete(N(k))
        bump('javascript')
      } else if (k === 'AA' && v) {
        cat.delete(N(k))
        bump('javascript')
      }
    }
  }
  if (o.attachments) {
    const names = cat.lookupMaybe(N('Names'), PDFDict)
    if (names?.has(N('EmbeddedFiles'))) {
      names.delete(N('EmbeddedFiles'))
      bump('attachments')
    }
    cat.delete(N('AF'))
  }
  if (o.bookmarks && cat.has(N('Outlines'))) {
    cat.delete(N('Outlines'))
    if (cat.get(N('PageMode')) === N('UseOutlines')) cat.delete(N('PageMode'))
    bump('bookmarks')
  }
  if (o.layers && cat.has(N('OCProperties'))) {
    cat.delete(N('OCProperties'))
    bump('layers')
  }
  if (o.metadata) {
    if (cat.has(N('Metadata'))) {
      cat.delete(N('Metadata'))
      bump('metadata')
    }
    cat.delete(N('PieceInfo'))
    const info = doc.context.trailerInfo.Info
    if (info) {
      doc.context.trailerInfo.Info = undefined
      bump('metadata')
    }
  }
  for (const page of doc.getPages()) {
    const node = page.node
    if (o.thumbnails && node.has(N('Thumb'))) {
      node.delete(N('Thumb'))
      bump('thumbnails')
    }
    if (o.javascript && node.has(N('AA'))) {
      node.delete(N('AA'))
      bump('javascript')
    }
    if (o.metadata) {
      node.delete(N('Metadata'))
      node.delete(N('PieceInfo'))
    }
    const annots = node.lookupMaybe(N('Annots'), PDFArray)
    if (!annots) continue
    const keep: ReturnType<typeof annots.get>[] = []
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i)
      const a = annots.lookup(i)
      const sub = a instanceof PDFDict ? a.get(N('Subtype')) : undefined
      const isLink = sub === N('Link')
      const isWidget = sub === N('Widget')
      const isFile = sub === N('FileAttachment')
      if (isLink && o.links) {
        bump('links')
        continue
      }
      if (isFile && o.attachments) {
        bump('attachments')
        continue
      }
      if (!isLink && !isWidget && o.annotations) {
        bump('annotations')
        continue
      }
      if (o.javascript && a instanceof PDFDict) {
        const act = a.lookup(N('A'))
        if (act instanceof PDFDict && act.get(N('S')) === N('JavaScript')) {
          a.delete(N('A'))
          bump('javascript')
        }
        if (a.has(N('AA'))) {
          a.delete(N('AA'))
          bump('javascript')
        }
      }
      keep.push(ref)
    }
    if (keep.length !== annots.size()) {
      if (keep.length) node.set(N('Annots'), doc.context.obj(keep))
      else node.delete(N('Annots'))
    }
  }
  // 刪除不再被引用的物件，讓被移除的內容真的從檔案消失
  await collectGarbage(doc)
  return { bytes: await doc.save({ useObjectStreams: true }), report }
}

/** 刪除無法從 trailer（Root、Info）到達的間接物件，回傳刪除數量 */
export async function collectGarbage(doc: PDFDocument): Promise<number> {
  const { PDFDict, PDFArray, PDFRef, PDFStream } = await lib()
  const ctx = doc.context
  const seen = new Set<string>()
  const stack: unknown[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info]
  while (stack.length) {
    const o = stack.pop()
    if (o instanceof PDFRef) {
      const k = o.toString()
      if (seen.has(k)) continue
      seen.add(k)
      stack.push(ctx.lookup(o))
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v)
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) stack.push(o.get(i))
    } else if (o instanceof PDFStream) {
      stack.push(o.dict)
    }
  }
  let removed = 0
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) {
      ctx.delete(ref)
      removed++
    }
  }
  return removed
}

/* ---------- 最佳化與修復 ---------- */

export interface OptimizeReport {
  before: number
  after: number
  removedObjects: number
  compressedStreams: number
  repaired: boolean
}

/** 刪除無法從 trailer 到達的物件、壓縮未壓縮的串流，並以物件串流重新存檔 */
export async function optimizePdf(
  bytes: Uint8Array,
  repairWith?: () => Promise<Uint8Array>,
): Promise<{ bytes: Uint8Array; report: OptimizeReport }> {
  const { PDFDocument, PDFName, PDFRawStream, PDFNumber } = await lib()
  const { deflateSync } = await import('fflate')
  let repaired = false
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (e) {
    if ((e as Error)?.name === 'EncryptedPDFError') throw new PdfOpError('encrypted')
    if (!repairWith) throw new PdfOpError('invalid')
    doc = await PDFDocument.load(await repairWith(), { updateMetadata: false })
    repaired = true
  }
  const ctx = doc.context
  const removed = await collectGarbage(doc)
  let compressed = 0
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && !obj.dict.has(PDFName.of('Filter')) && obj.contents.length > 256) {
      const type = obj.dict.get(PDFName.of('Type'))
      if (type === PDFName.of('Metadata')) continue
      const z = deflateSync(obj.contents, { level: 9 })
      if (z.length < obj.contents.length * 0.9) {
        obj.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
        obj.dict.set(PDFName.of('Length'), PDFNumber.of(z.length))
        ctx.assign(ref, PDFRawStream.of(obj.dict, z))
        compressed++
      }
    }
  }
  doc.setProducer(app.name)
  const out = await doc.save({ useObjectStreams: true })
  return {
    bytes: out,
    report: { before: bytes.length, after: out.length, removedObjects: removed, compressedStreams: compressed, repaired },
  }
}
