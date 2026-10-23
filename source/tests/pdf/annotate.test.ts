// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument, degrees } from 'pdf-lib'
import {
  annBounds,
  applyAnnotations,
  moveAnn,
  strokePath,
  type Ann,
} from '@/features/pdf/lib/annotate'

const PNG_1x1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)
const img = { bytes: PNG_1x1, type: 'png' as const, width: 1, height: 1 }

describe('標註', () => {
  it('路徑：單點與多點', () => {
    expect(strokePath([])).toBe('')
    expect(strokePath([[1, 2]])).toMatch(/^M1 2L/)
    expect(
      strokePath([
        [0, 0],
        [10, 0],
        [20, 10],
      ]),
    ).toBe('M0 0Q10 0 15 5L20 10')
  })
  it('移動與外接框', () => {
    const a: Ann = {
      id: 'a',
      kind: 'pen',
      page: 0,
      points: [
        [0, 0],
        [10, 20],
      ],
      color: '#000000',
      width: 2,
      opacity: 1,
    }
    const m = moveAnn(a, 5, 5)
    expect(annBounds(m)).toEqual({ x: 4, y: 4, w: 12, h: 22 })
  })
  it('匯出後頁數與旋轉不變，內容增加', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([400, 600])
    doc.addPage([400, 600]).setRotation(degrees(90))
    const src = await doc.save()
    const anns: Ann[] = [
      {
        id: '1',
        kind: 'highlight',
        page: 0,
        points: [
          [10, 10],
          [200, 10],
        ],
        color: '#FDE047',
        width: 14,
        opacity: 0.4,
      },
      {
        id: '2',
        kind: 'pen',
        page: 1,
        points: [
          [10, 10],
          [50, 80],
          [90, 20],
        ],
        color: '#DC2626',
        width: 2,
        opacity: 1,
      },
      { id: '3', kind: 'text', page: 1, x: 30, y: 40, text: '你好', sizePt: 14, color: '#000000' },
      { id: '4', kind: 'sign', page: 0, x: 100, y: 400, w: 120, h: 40, image: img, url: '' },
    ]
    const out = await applyAnnotations(src, anns, async () => ({
      image: img,
      size: { w: 30, h: 18 },
    }))
    const d = await PDFDocument.load(out)
    expect(d.getPageCount()).toBe(2)
    expect(d.getPage(1).getRotation().angle).toBe(90)
    expect(out.byteLength).toBeGreaterThan(src.byteLength)
  })
})
