// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import {
  PdfOpError,
  assemble,
  assembleMany,
  imagesToPdf,
  inspect,
  layoutImage,
  readMeta,
  stampPages,
  writeMeta,
} from '@/features/pdf/lib/ops'
import { chunkPages, parsePageRange, spanToIndices } from '@/features/pdf/lib/pageRange'

/** 用程式產生測試 PDF：每頁寫上頁碼文字，可指定某些頁的旋轉 */
async function makePdf(
  count: number,
  opts: { rotate?: Record<number, number>; title?: string } = {},
) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < count; i++) {
    const p = doc.addPage([400 + i, 600])
    p.drawText(`Page ${i + 1}`, { x: 40, y: 500, size: 24, font })
    const r = opts.rotate?.[i]
    if (r) p.setRotation(degrees(r))
  }
  if (opts.title) doc.setTitle(opts.title)
  return doc.save()
}

/** 讀出每頁寬度（makePdf 讓寬度＝400＋原始索引，用來確認頁序） */
async function widths(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => Math.round(p.getMediaBox().width) - 400)
}

/** 1×1 PNG */
const PNG_1x1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

describe('合併', () => {
  it('兩份文件合併後頁數與順序正確，並沿用第一份的標題', async () => {
    const a = await makePdf(3, { title: 'A 檔' })
    const b = await makePdf(2)
    const out = await assemble(
      [a, b],
      [
        ...[0, 1, 2].map((page) => ({ kind: 'page' as const, src: 0, page })),
        ...[0, 1].map((page) => ({ kind: 'page' as const, src: 1, page })),
      ],
    )
    expect((await inspect(out)).pages).toBe(5)
    expect(await widths(out)).toEqual([0, 1, 2, 0, 1])
    expect((await readMeta(out)).title).toBe('A 檔')
  })
  it('每個檔案可選頁範圍', async () => {
    const a = await makePdf(10)
    const b = await makePdf(4)
    const ra = parsePageRange('2-3,9-', 10)
    const rb = parsePageRange('4', 4)
    if (!ra.ok || !rb.ok) throw new Error('range')
    const out = await assemble(
      [a, b],
      [
        ...ra.pages.map((p) => ({ kind: 'page' as const, src: 0, page: p - 1 })),
        ...rb.pages.map((p) => ({ kind: 'page' as const, src: 1, page: p - 1 })),
      ],
    )
    expect(await widths(out)).toEqual([1, 2, 8, 9, 3])
  })
  it('保留來源頁面的旋轉角', async () => {
    const a = await makePdf(2, { rotate: { 1: 90 } })
    const out = await assemble(
      [a, a],
      [0, 1].flatMap((src) => [0, 1].map((page) => ({ kind: 'page' as const, src, page }))),
    )
    expect((await inspect(out)).rotations).toEqual([0, 90, 0, 90])
  })
})

describe('分割與擷取', () => {
  it('擷取指定頁面成單一檔案', async () => {
    const src = await makePdf(8)
    const r = parsePageRange('1-3,5,8-', 8)
    if (!r.ok) throw new Error('range')
    const out = await assemble(
      [src],
      r.pages.map((p) => ({ kind: 'page' as const, src: 0, page: p - 1 })),
    )
    expect(await widths(out)).toEqual([0, 1, 2, 4, 7])
  })
  it('每 N 頁一份', async () => {
    const src = await makePdf(7)
    const plans = chunkPages(7, 3).map((s) =>
      spanToIndices(s).map((page) => ({ kind: 'page' as const, src: 0, page })),
    )
    const outs = await assembleMany([src], plans)
    expect(outs).toHaveLength(3)
    expect(await Promise.all(outs.map(async (o) => (await inspect(o)).pages))).toEqual([3, 3, 1])
    expect(await widths(outs[2])).toEqual([6])
  })
  it('每個範圍一份', async () => {
    const src = await makePdf(10)
    const r = parsePageRange('1-2,5,9-', 10)
    if (!r.ok) throw new Error('range')
    const outs = await assembleMany(
      [src],
      r.spans.map((s) => spanToIndices(s).map((page) => ({ kind: 'page' as const, src: 0, page }))),
    )
    expect(await Promise.all(outs.map(widths))).toEqual([[0, 1], [4], [8, 9]])
  })
  it('分割後的檔案比原檔小（只複製用到的物件）', async () => {
    const src = await makePdf(30)
    const [one] = await assembleMany([src], [[{ kind: 'page', src: 0, page: 0 }]])
    expect(one.byteLength).toBeLessThan(src.byteLength)
  })
})

describe('整理頁面', () => {
  it('重新排序、旋轉、刪除、複製、插入空白頁', async () => {
    const src = await makePdf(4, { rotate: { 2: 90 } })
    const out = await assemble(
      [src],
      [
        { kind: 'page', src: 0, page: 3 },
        { kind: 'page', src: 0, page: 0, rotate: 90 },
        { kind: 'blank', size: [595, 842] },
        { kind: 'page', src: 0, page: 2, rotate: 270 },
        { kind: 'page', src: 0, page: 0 },
        // 第 2 頁（索引 1）被刪除：不在計畫中
      ],
    )
    const info = await inspect(out)
    expect(info.pages).toBe(5)
    // 原本 90° 的頁面再轉 270° → 0°；原本 0° 再轉 90° → 90°
    expect(info.rotations).toEqual([0, 90, 0, 0, 0])
    const w = await widths(out)
    expect(w[0]).toBe(3)
    expect(w[1]).toBe(0)
    expect(w[2]).toBe(195) // 595 − 400
    expect(w[3]).toBe(2)
    expect(w[4]).toBe(0)
  })
  it('旋轉 −90°（逆時針）會正規化成 270°', async () => {
    const src = await makePdf(1)
    const out = await assemble([src], [{ kind: 'page', src: 0, page: 0, rotate: -90 }])
    expect((await inspect(out)).rotations).toEqual([270])
  })
  it('頁碼超出範圍時丟出錯誤', async () => {
    const src = await makePdf(2)
    await expect(assemble([src], [{ kind: 'page', src: 0, page: 5 }])).rejects.toBeInstanceOf(
      PdfOpError,
    )
  })
  it('空計畫丟出 empty', async () => {
    const src = await makePdf(2)
    await expect(assemble([src], [])).rejects.toMatchObject({ code: 'empty' })
  })
})

describe('錯誤處理', () => {
  it('不是 PDF 的資料 → invalid', async () => {
    const junk = new TextEncoder().encode('not a pdf at all')
    await expect(inspect(junk)).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('中繼資料', () => {
  it('寫入與讀回', async () => {
    const src = await makePdf(1)
    const out = await writeMeta(src, {
      title: '年度報告',
      author: '王小明',
      subject: '財務',
      keywords: '營收, 預算，二〇二六',
    })
    const m = await readMeta(out)
    expect(m.title).toBe('年度報告')
    expect(m.author).toBe('王小明')
    expect(m.subject).toBe('財務')
    expect(m.keywords).toBe('營收 預算 二〇二六')
    expect((await inspect(out)).pages).toBe(1)
  })
})

describe('圖片轉 PDF 與圖章', () => {
  it('每張圖片一頁，A4 直向／依圖片尺寸', async () => {
    const img = { bytes: PNG_1x1, type: 'png' as const, width: 800, height: 600, rotation: 0 }
    const out = await imagesToPdf([img, { ...img, rotation: 90 }], {
      pageSize: 'a4',
      orientation: 'portrait',
      margin: 20,
      fit: 'contain',
    })
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(2)
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595)
    const fit = await imagesToPdf([img], {
      pageSize: 'fit',
      orientation: 'auto',
      margin: 0,
      fit: 'contain',
    })
    const d2 = await PDFDocument.load(fit)
    expect(Math.round(d2.getPage(0).getWidth())).toBe(600)
    expect(Math.round(d2.getPage(0).getHeight())).toBe(450)
  })
  it('自動方向：橫向圖片用橫向頁面', () => {
    const l = layoutImage({ w: 1600, h: 900 }, 0, {
      pageSize: 'a4',
      orientation: 'auto',
      margin: 0,
      fit: 'contain',
    })
    expect(l.page.w).toBeGreaterThan(l.page.h)
    const r = layoutImage({ w: 1600, h: 900 }, 90, {
      pageSize: 'a4',
      orientation: 'auto',
      margin: 0,
      fit: 'contain',
    })
    expect(r.page.w).toBeLessThan(r.page.h)
  })
  it('填滿模式會裁切、符合模式不裁切', () => {
    const opts = { pageSize: 'a4' as const, orientation: 'portrait' as const, margin: 10 }
    const cover = layoutImage({ w: 1000, h: 1000 }, 0, { ...opts, fit: 'cover' })
    expect(cover.clip).toBe(true)
    expect(cover.draw.h).toBeGreaterThan(841.89 - 20 - 0.01)
    const contain = layoutImage({ w: 1000, h: 1000 }, 0, { ...opts, fit: 'contain' })
    expect(contain.clip).toBe(false)
    expect(contain.draw.w).toBeCloseTo(595.28 - 20, 1)
  })
  it('蓋章後頁數不變、旋轉角不變', async () => {
    const src = await makePdf(3, { rotate: { 1: 90 } })
    const img = { bytes: PNG_1x1, type: 'png' as const, width: 1, height: 1 }
    const out = await stampPages(src, [
      {
        stampFor: (i) => (i === 0 ? null : { image: img, size: { w: 40, h: 20 }, opacity: 0.5 }),
        placements: (_i, v) => [{ cx: v.w / 2, cy: v.h - 20, angle: 0 }],
      },
    ])
    const info = await inspect(out)
    expect(info.pages).toBe(3)
    expect(info.rotations).toEqual([0, 90, 0])
    expect(out.byteLength).toBeGreaterThan(src.byteLength)
  })
})
