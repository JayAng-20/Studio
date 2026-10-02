/**
 * 把組版結果輸出成 PDF（pdf-lib）：
 * - 思源黑體以子集方式嵌入（只含用到的字），文字可選取、搜尋、複製。
 * - 連結：外部網址為 URI 註解；目錄與文件內連結為 GoTo 目的地。
 * - 書籤（Outline）：pdf-lib 沒有高階 API，自己建立 /Outlines 與 /First /Last /Next /Prev /Parent /Count /Dest。
 */
import fontkit from '@pdf-lib/fontkit'
import {
  LineCapStyle,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSqueeze,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib'
import { STANDARD_FONT, type FontKey } from './fonts'
import type { Composed, OutlineNode } from './compose'
import type { Op } from './layout'
import type { ImageData } from './model'
import type { RGB } from './themes'

export interface RenderOptions {
  width: number
  height: number
  fonts: { regular: Uint8Array; bold: Uint8Array }
  meta: { title: string; lang: string; subject?: string }
  signal?: AbortSignal
  onProgress?: (p: number) => void
}

/** 斜體模擬的傾斜角度 */
const ITALIC_SKEW = 12

const color = (c: RGB) => rgb(c[0], c[1], c[2])

/** 圓角矩形的 SVG 路徑（原點在左上，y 向下） */
function roundRectPath(w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  return [
    `M ${rr} 0`,
    `L ${w - rr} 0`,
    `Q ${w} 0 ${w} ${rr}`,
    `L ${w} ${h - rr}`,
    `Q ${w} ${h} ${w - rr} ${h}`,
    `L ${rr} ${h}`,
    `Q 0 ${h} 0 ${h - rr}`,
    `L 0 ${rr}`,
    `Q 0 0 ${rr} 0`,
    'Z',
  ].join(' ')
}

const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

export async function renderPdf(c: Composed, o: RenderOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const H = o.height
  const fonts = new Map<FontKey, PDFFont>()
  const fontFor = async (k: FontKey): Promise<PDFFont> => {
    let f = fonts.get(k)
    if (f) return f
    const std = STANDARD_FONT[k]
    if (std) f = await pdf.embedFont(std)
    else
      f = await pdf.embedFont(k === 'sansBold' ? o.fonts.bold : o.fonts.regular, {
        subset: true,
        // 關閉連字與上下文替換：字寬與排版量測一致，複製出來的文字也和原文相同
        features: { liga: false, clig: false, calt: false, dlig: false, kern: false },
      })
    fonts.set(k, f)
    return f
  }
  const images = new Map<ImageData, PDFImage>()
  const imageFor = async (d: ImageData) => {
    let img = images.get(d)
    if (!img) {
      img = d.format === 'png' ? await pdf.embedPng(d.bytes) : await pdf.embedJpg(d.bytes)
      images.set(d, img)
    }
    return img
  }

  const pages: PDFPage[] = []
  const links: { page: number; op: Extract<Op, { t: 'link' }> }[] = []
  for (let i = 0; i < c.pages.length; i++) {
    checkAbort(o.signal)
    const page = pdf.addPage([o.width, H])
    pages.push(page)
    for (const op of c.pages[i].ops) {
      switch (op.t) {
        case 'text': {
          const font = await fontFor(op.font)
          if (op.hs) page.pushOperators(pushGraphicsState(), setCharacterSqueeze(op.hs))
          page.drawText(op.text, {
            x: op.x,
            y: H - op.y,
            size: op.size,
            font,
            color: color(op.color),
            ...(op.skew && { ySkew: degrees(ITALIC_SKEW) }),
          })
          if (op.hs) page.pushOperators(popGraphicsState())
          break
        }
        case 'rect': {
          const opts = {
            color: op.fill ? color(op.fill) : undefined,
            borderColor: op.stroke ? color(op.stroke) : undefined,
            borderWidth: op.stroke ? (op.lw ?? 0.75) : 0,
            borderDashArray: op.dash,
          }
          if (op.r && op.r > 0.2) page.drawSvgPath(roundRectPath(op.w, op.h, op.r), { x: op.x, y: H - op.y, ...opts })
          else page.drawRectangle({ x: op.x, y: H - op.y - op.h, width: op.w, height: op.h, ...opts })
          break
        }
        case 'line':
          page.drawLine({
            start: { x: op.x1, y: H - op.y1 },
            end: { x: op.x2, y: H - op.y2 },
            thickness: op.w,
            color: color(op.color),
            dashArray: op.dash,
            lineCap: op.round ? LineCapStyle.Round : undefined,
          })
          break
        case 'circle':
          page.drawCircle({
            x: op.x,
            y: H - op.y,
            size: op.r,
            color: op.fill ? color(op.fill) : undefined,
            borderColor: op.stroke ? color(op.stroke) : undefined,
            borderWidth: op.stroke ? (op.lw ?? 0.75) : 0,
          })
          break
        case 'image': {
          const img = await imageFor(op.image)
          page.drawImage(img, { x: op.x, y: H - op.y - op.h, width: op.w, height: op.h })
          break
        }
        case 'link':
          links.push({ page: i, op })
          break
      }
    }
    o.onProgress?.((i + 1) / c.pages.length)
    // 讓出執行緒，取消訊息才進得來
    if (i % 8 === 7) await Promise.resolve()
  }

  // 連結註解
  const ctx = pdf.context
  const destArray = (id: string) => {
    const d = c.dests.get(id)
    if (!d) return null
    return ctx.obj([pages[d.page].ref, PDFName.of('XYZ'), null, Math.min(H, H - d.y + 6), null])
  }
  for (const { page, op } of links) {
    const rect = [op.x, H - op.y - op.h, op.x + op.w, H - op.y]
    let annot
    if (op.uri) {
      let uri = op.uri
      try {
        uri = encodeURI(decodeURI(uri))
      } catch {
        uri = encodeURI(uri)
      }
      annot = ctx.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: rect,
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) },
      })
    } else if (op.dest) {
      const dest = destArray(op.dest)
      if (!dest) continue
      annot = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], Dest: dest })
    } else continue
    pages[page].node.addAnnot(ctx.register(annot))
  }

  // 書籤
  if (c.outline.length) addOutline(pdf, c.outline, destArray)

  pdf.setTitle(o.meta.title || 'Document', { showInWindowTitleBar: true })
  pdf.setCreator('JayAng Studio Web')
  pdf.setProducer('JayAng Studio Web (pdf-lib)')
  pdf.setLanguage(o.meta.lang)
  if (o.meta.subject) pdf.setSubject(o.meta.subject)
  const now = new Date()
  pdf.setCreationDate(now)
  pdf.setModificationDate(now)
  checkAbort(o.signal)
  return pdf.save({ useObjectStreams: true })
}

/**
 * 建立書籤樹：第一層展開（/Count 為正），更深層收合（/Count 為負的子項目數）。
 */
export function addOutline(
  pdf: PDFDocument,
  nodes: OutlineNode[],
  destOf: (id: string) => ReturnType<PDFDocument['context']['obj']> | null,
) {
  const ctx = pdf.context
  const rootRef = ctx.nextRef()
  const build = (list: OutlineNode[], parent: PDFRef, depth: number): { first: PDFRef; last: PDFRef; visible: number } => {
    const refs = list.map(() => ctx.nextRef())
    let visible = 0
    list.forEach((n, i) => {
      const entries: Record<string, unknown> = {
        Title: PDFHexString.fromText(n.title),
        Parent: parent,
      }
      if (i > 0) entries.Prev = refs[i - 1]
      if (i < list.length - 1) entries.Next = refs[i + 1]
      const dest = destOf(n.dest)
      if (dest) entries.Dest = dest
      visible += 1
      if (n.children.length) {
        const open = depth === 0
        const sub = build(n.children, refs[i], depth + 1)
        entries.First = sub.first
        entries.Last = sub.last
        entries.Count = open ? sub.visible : -n.children.length
        if (open) visible += sub.visible
      }
      ctx.assign(refs[i], ctx.obj(entries as Parameters<typeof ctx.obj>[0]))
    })
    return { first: refs[0], last: refs[refs.length - 1], visible }
  }
  const top = build(nodes, rootRef, 0)
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.visible }))
  pdf.catalog.set(PDFName.of('Outlines'), rootRef)
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
}
