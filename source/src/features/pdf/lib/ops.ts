/**
 * pdf-lib 作業（純資料進出：Uint8Array → Uint8Array），可在 Node 測試。
 * 原則：盡量保持原檔內容不變；結構性作業（合併、分割、整理）以 copyPages 建立新文件，
 * 只複製被用到的物件，因此刪頁後檔案會變小；但表單欄位（AcroForm）與書籤不會帶過去，
 * 介面會事先提示。
 */
import type { PDFDocument, PDFImage, PDFPage } from 'pdf-lib'
import { app } from '@/config/app'
import {
  normRotation,
  placementToDraw,
  type PageGeometry,
  type Placement,
  type Size,
} from './placement'

export type PdfOpErrorCode = 'encrypted' | 'invalid' | 'image' | 'empty'

/** 作業錯誤：以代碼讓介面顯示「發生什麼事＋可以怎麼辦」 */
export class PdfOpError extends Error {
  code: PdfOpErrorCode
  detail?: string
  constructor(code: PdfOpErrorCode, detail?: string) {
    super(`pdf-op:${code}${detail ? `:${detail}` : ''}`)
    this.name = 'PdfOpError'
    this.code = code
    this.detail = detail
  }
}

const lib = () => import('pdf-lib')

const abortIf = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

/** 讓出主執行緒，避免長迴圈卡住介面 */
const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0))

/** 載入可編輯的 PDF；加密檔明確丟出 encrypted */
export async function loadForEdit(bytes: Uint8Array, name?: string): Promise<PDFDocument> {
  const { PDFDocument, EncryptedPDFError } = await lib()
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (e) {
    if (e instanceof EncryptedPDFError) throw new PdfOpError('encrypted', name)
    console.error(e)
    throw new PdfOpError('invalid', name)
  }
}

/** 建立新文件，並把來源的標題、作者等資訊帶過去 */
async function createFrom(meta?: PDFDocument): Promise<PDFDocument> {
  const { PDFDocument } = await lib()
  const doc = await PDFDocument.create({ updateMetadata: false })
  if (meta) {
    const title = meta.getTitle()
    const author = meta.getAuthor()
    const subject = meta.getSubject()
    const keywords = meta.getKeywords()
    const creator = meta.getCreator()
    if (title) doc.setTitle(title)
    if (author) doc.setAuthor(author)
    if (subject) doc.setSubject(subject)
    if (keywords) doc.setKeywords(splitKeywords(keywords))
    if (creator) doc.setCreator(creator)
  }
  doc.setProducer(app.name)
  doc.setCreationDate(meta?.getCreationDate() ?? new Date())
  doc.setModificationDate(new Date())
  return doc
}

export const splitKeywords = (s: string) =>
  s
    .split(/[,，;；\n]/)
    .map((k) => k.trim())
    .filter(Boolean)

/** 組裝計畫中的一頁 */
export type PlanItem =
  | {
      kind: 'page'
      /** 來源索引（對應 sources） */
      src: number
      /** 0 起算頁碼 */
      page: number
      /** 額外旋轉（度，90 的倍數，順時針） */
      rotate?: number
    }
  | {
      kind: 'blank'
      /** 頁面尺寸（PDF 單位） */
      size: [number, number]
    }

export interface AssembleOptions {
  /** 以哪個來源的資訊（標題、作者）當新文件的資訊；預設第一個 */
  metaFrom?: number
  signal?: AbortSignal
  onProgress?: (p: number) => void
}

/**
 * 依計畫組出多份文件（合併、擷取、分割、整理共用）。
 * 每個來源只載入一次；同一來源的頁面一次複製，共用的資源不重複。
 */
export async function assembleMany(
  sources: Uint8Array[],
  plans: PlanItem[][],
  opts: AssembleOptions = {},
): Promise<Uint8Array[]> {
  const { degrees } = await lib()
  const docs: Array<PDFDocument | undefined> = []
  const used = new Set<number>()
  plans.forEach((plan) => plan.forEach((it) => it.kind === 'page' && used.add(it.src)))
  let loaded = 0
  const totalSteps = used.size + plans.length
  for (const i of used) {
    abortIf(opts.signal)
    docs[i] = await loadForEdit(sources[i])
    loaded++
    opts.onProgress?.(loaded / totalSteps)
    await yieldToMain()
  }
  const metaDoc = docs[opts.metaFrom ?? [...used][0] ?? 0]
  const outputs: Uint8Array[] = []
  for (let pi = 0; pi < plans.length; pi++) {
    abortIf(opts.signal)
    const plan = plans[pi]
    if (!plan.length) throw new PdfOpError('empty')
    const out = await createFrom(metaDoc)
    // 依來源分組一次複製
    const bySrc = new Map<number, number[]>()
    plan.forEach((it) => {
      if (it.kind !== 'page') return
      const list = bySrc.get(it.src) ?? []
      list.push(it.page)
      bySrc.set(it.src, list)
    })
    const copied = new Map<number, PDFPage[]>()
    for (const [src, pages] of bySrc) {
      const doc = docs[src]!
      const count = doc.getPageCount()
      pages.forEach((p) => {
        if (p < 0 || p >= count) throw new PdfOpError('invalid', `page ${p + 1}`)
      })
      copied.set(src, await out.copyPages(doc, pages))
    }
    const cursor = new Map<number, number>()
    for (const it of plan) {
      if (it.kind === 'blank') {
        out.addPage(it.size)
        continue
      }
      const k = cursor.get(it.src) ?? 0
      cursor.set(it.src, k + 1)
      const page = out.addPage(copied.get(it.src)![k])
      if (it.rotate) page.setRotation(degrees(normRotation(page.getRotation().angle + it.rotate)))
    }
    outputs.push(await out.save({ useObjectStreams: true }))
    loaded++
    opts.onProgress?.(loaded / totalSteps)
    await yieldToMain()
  }
  return outputs
}

export async function assemble(
  sources: Uint8Array[],
  plan: PlanItem[],
  opts: AssembleOptions = {},
): Promise<Uint8Array> {
  const [out] = await assembleMany(sources, [plan], opts)
  return out
}

/** 文件資訊（中繼資料） */
export interface PdfMeta {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
  created?: Date
  modified?: Date
}

export async function readMeta(bytes: Uint8Array): Promise<PdfMeta> {
  const doc = await loadForEdit(bytes)
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    created: doc.getCreationDate(),
    modified: doc.getModificationDate(),
  }
}

/** 寫入中繼資料（就地修改，其他內容不變）；clear 為 true 時清除所有欄位 */
export async function writeMeta(
  bytes: Uint8Array,
  meta: Pick<PdfMeta, 'title' | 'author' | 'subject' | 'keywords'>,
  clear = false,
): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes)
  doc.setTitle(clear ? '' : meta.title.trim())
  doc.setAuthor(clear ? '' : meta.author.trim())
  doc.setSubject(clear ? '' : meta.subject.trim())
  doc.setKeywords(clear ? [] : splitKeywords(meta.keywords))
  if (clear) {
    doc.setCreator('')
    doc.setProducer('')
  }
  doc.setModificationDate(new Date())
  return doc.save({ useObjectStreams: true })
}

/** 已編碼的影像（JPEG 或 PNG 位元組） */
export interface EncodedImage {
  bytes: Uint8Array
  type: 'jpg' | 'png'
  /** 像素尺寸 */
  width: number
  height: number
}

async function embed(doc: PDFDocument, img: EncodedImage): Promise<PDFImage> {
  try {
    return img.type === 'jpg' ? await doc.embedJpg(img.bytes) : await doc.embedPng(img.bytes)
  } catch (e) {
    console.error(e)
    throw new PdfOpError('image')
  }
}

export type PageSizeMode = 'a4' | 'letter' | 'fit'
export type OrientationMode = 'auto' | 'portrait' | 'landscape'
export type FitMode = 'contain' | 'cover' | 'actual'

export const PAGE_SIZES: Record<Exclude<PageSizeMode, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
}

/** 1 px（96 dpi）＝ 0.75 pt */
export const PX_TO_PT = 0.75
/** PDF 規範建議的頁面邊長上限 */
export const MAX_PAGE_PT = 14400
export const MM_TO_PT = 72 / 25.4

export interface ImagesToPdfOptions {
  pageSize: PageSizeMode
  orientation: OrientationMode
  /** 邊距（pt） */
  margin: number
  fit: FitMode
  title?: string
}

/** 單張圖片的版面計算（純函式，預覽與匯出共用） */
export function layoutImage(
  imgPx: Size,
  rotation: number,
  opts: Pick<ImagesToPdfOptions, 'pageSize' | 'orientation' | 'margin' | 'fit'>,
): { page: Size; draw: { x: number; y: number; w: number; h: number }; clip: boolean } {
  const r = normRotation(rotation)
  const rotated = r === 90 || r === 270 ? { w: imgPx.h, h: imgPx.w } : imgPx
  const natural = { w: rotated.w * PX_TO_PT, h: rotated.h * PX_TO_PT }
  const m = Math.max(0, opts.margin)
  if (opts.pageSize === 'fit') {
    // 依圖片：頁面＝圖片＋邊距，過大時等比縮小到上限
    const k = Math.min(1, (MAX_PAGE_PT - 2 * m) / Math.max(natural.w, natural.h))
    const w = natural.w * k
    const h = natural.h * k
    return { page: { w: w + 2 * m, h: h + 2 * m }, draw: { x: m, y: m, w, h }, clip: false }
  }
  const [pw, ph] = PAGE_SIZES[opts.pageSize]
  const landscape =
    opts.orientation === 'landscape' || (opts.orientation === 'auto' && rotated.w > rotated.h)
  const page: Size = landscape ? { w: ph, h: pw } : { w: pw, h: ph }
  const box = { w: Math.max(1, page.w - 2 * m), h: Math.max(1, page.h - 2 * m) }
  let w: number
  let h: number
  if (opts.fit === 'actual') {
    w = natural.w
    h = natural.h
  } else {
    const s =
      opts.fit === 'contain'
        ? Math.min(box.w / rotated.w, box.h / rotated.h)
        : Math.max(box.w / rotated.w, box.h / rotated.h)
    w = rotated.w * s
    h = rotated.h * s
  }
  const x = m + (box.w - w) / 2
  const y = m + (box.h - h) / 2
  return { page, draw: { x, y, w, h }, clip: opts.fit !== 'contain' }
}

/** 圖片轉 PDF */
export async function imagesToPdf(
  images: Array<EncodedImage & { rotation: number }>,
  opts: ImagesToPdfOptions,
  signal?: AbortSignal,
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const { degrees, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await lib()
  if (!images.length) throw new PdfOpError('empty')
  const doc = await createFrom()
  if (opts.title) doc.setTitle(opts.title)
  for (let i = 0; i < images.length; i++) {
    abortIf(signal)
    const img = images[i]
    const pdfImg = await embed(doc, img)
    const {
      page: size,
      draw,
      clip: needClip,
    } = layoutImage({ w: img.width, h: img.height }, img.rotation, opts)
    const page = doc.addPage([size.w, size.h])
    const m = Math.max(0, opts.margin)
    if (needClip) {
      page.pushOperators(
        pushGraphicsState(),
        rectangle(m, m, size.w - 2 * m, size.h - 2 * m),
        clip(),
        endPath(),
      )
    }
    // drawImage 以左下角為軸逆時針旋轉；使用者的旋轉是順時針
    const r = normRotation(img.rotation)
    const imgW = r === 90 || r === 270 ? draw.h : draw.w
    const imgH = r === 90 || r === 270 ? draw.w : draw.h
    const pdfY = size.h - draw.y - draw.h // 轉成 PDF 座標（下方為原點）
    const base = {
      0: { x: draw.x, y: pdfY },
      90: { x: draw.x, y: pdfY + draw.h },
      180: { x: draw.x + draw.w, y: pdfY + draw.h },
      270: { x: draw.x + draw.w, y: pdfY },
    }[r as 0 | 90 | 180 | 270]
    page.drawImage(pdfImg, {
      x: base.x,
      y: base.y,
      width: imgW,
      height: imgH,
      rotate: degrees(-r),
    })
    if (needClip) page.pushOperators(popGraphicsState())
    onProgress?.((i + 1) / images.length)
    await yieldToMain()
  }
  return doc.save({ useObjectStreams: true })
}

/** 一個要蓋到頁面上的圖章（浮水印或頁碼），尺寸為 PDF 單位 */
export interface StampSpec {
  image: EncodedImage
  /** 在頁面上顯示的大小（pt） */
  size: Size
  opacity: number
}

/**
 * 在指定頁面蓋上圖章（就地修改原檔，其他內容不變）。
 * placements(pageIndex, visualSize) 回傳該頁要蓋的位置；stampFor(pageIndex) 回傳該頁用的圖章（頁碼每頁不同）。
 */
export async function stampPages(
  bytes: Uint8Array,
  layers: Array<{
    stampFor: (pageIndex: number, visual: Size) => StampSpec | null
    placements: (pageIndex: number, visual: Size, stamp: StampSpec) => Placement[]
  }>,
  signal?: AbortSignal,
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const { degrees } = await lib()
  const doc = await loadForEdit(bytes)
  const pages = doc.getPages()
  const cache = new Map<Uint8Array, PDFImage>()
  for (let i = 0; i < pages.length; i++) {
    abortIf(signal)
    const page = pages[i]
    const geo = pageGeometry(page)
    const visual = geoVisual(geo)
    for (const layer of layers) {
      const stamp = layer.stampFor(i, visual)
      if (!stamp) continue
      let img = cache.get(stamp.image.bytes)
      if (!img) {
        img = await embed(doc, stamp.image)
        cache.set(stamp.image.bytes, img)
      }
      for (const p of layer.placements(i, visual, stamp)) {
        const d = placementToDraw(geo, p, stamp.size)
        page.drawImage(img, {
          x: d.x,
          y: d.y,
          width: d.width,
          height: d.height,
          rotate: degrees(d.rotate),
          opacity: stamp.opacity,
        })
      }
    }
    onProgress?.((i + 1) / pages.length)
    if (i % 20 === 19) await yieldToMain()
  }
  return doc.save({ useObjectStreams: true })
}

/** 頁面的裁切框與旋轉 */
export function pageGeometry(page: PDFPage): PageGeometry {
  const box = page.getCropBox()
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: normRotation(page.getRotation().angle),
  }
}

const geoVisual = (g: PageGeometry): Size => {
  const r = normRotation(g.rotation)
  return r === 90 || r === 270 ? { w: g.height, h: g.width } : { w: g.width, h: g.height }
}

/** 用整頁影像重建 PDF（掃描式壓縮）：每頁一張 JPEG，頁面尺寸沿用原本的視覺尺寸 */
export async function rebuildFromImages(
  pages: Array<{ image: EncodedImage; size: Size }>,
  metaSource?: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let meta: PDFDocument | undefined
  if (metaSource) {
    try {
      meta = await loadForEdit(metaSource)
    } catch {
      meta = undefined
    }
  }
  const doc = await createFrom(meta)
  for (const p of pages) {
    abortIf(signal)
    const img = await embed(doc, p.image)
    const page = doc.addPage([p.size.w, p.size.h])
    page.drawImage(img, { x: 0, y: 0, width: p.size.w, height: p.size.h })
  }
  return doc.save({ useObjectStreams: true })
}

/** 檔案基本資訊：頁數、每頁旋轉（測試與摘要用） */
export async function inspect(bytes: Uint8Array): Promise<{ pages: number; rotations: number[] }> {
  const doc = await loadForEdit(bytes)
  return {
    pages: doc.getPageCount(),
    rotations: doc.getPages().map((p) => normRotation(p.getRotation().angle)),
  }
}
