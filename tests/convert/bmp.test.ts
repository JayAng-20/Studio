// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { bmpRowSize, encodeBmp, hasTransparency } from '@/lib/convert-bmp'

/** 2×2：左上紅、右上綠、左下藍、右下白 */
const rgba2x2 = new Uint8Array([
  255, 0, 0, 255, 0, 255, 0, 255,
  0, 0, 255, 255, 255, 255, 255, 255,
])

describe('BMP 編碼', () => {
  it('24 位元標頭：BM、檔案大小、像素位移 54、BITMAPINFOHEADER', () => {
    const b = encodeBmp({ data: rgba2x2, width: 2, height: 2 })
    const v = new DataView(b.buffer)
    expect(String.fromCharCode(b[0], b[1])).toBe('BM')
    expect(v.getUint32(2, true)).toBe(b.length)
    expect(v.getUint32(10, true)).toBe(54)
    expect(v.getUint32(14, true)).toBe(40)
    expect(v.getInt32(18, true)).toBe(2)
    expect(v.getInt32(22, true)).toBe(2) // 正值：由下往上
    expect(v.getUint16(26, true)).toBe(1)
    expect(v.getUint16(28, true)).toBe(24)
    expect(v.getUint32(30, true)).toBe(0) // BI_RGB
    expect(v.getUint32(34, true)).toBe(8 * 2) // 每列 6 bytes 補到 8
    expect(v.getInt32(38, true)).toBe(2835)
    expect(b.length).toBe(54 + 16)
  })

  it('像素順序：BGR、由下往上、每列補齊 4 bytes', () => {
    const b = encodeBmp({ data: rgba2x2, width: 2, height: 2 })
    // 第一列（檔案中）是影像的最後一列：藍、白
    expect([...b.subarray(54, 62)]).toEqual([255, 0, 0, 255, 255, 255, 0, 0])
    // 第二列是影像第一列：紅、綠
    expect([...b.subarray(62, 70)]).toEqual([0, 0, 255, 0, 255, 0, 0, 0])
  })

  it('列寬補齊計算', () => {
    expect(bmpRowSize(1, 24)).toBe(4)
    expect(bmpRowSize(3, 24)).toBe(12)
    expect(bmpRowSize(4, 24)).toBe(12)
    expect(bmpRowSize(5, 24)).toBe(16)
    expect(bmpRowSize(3, 32)).toBe(12)
  })

  it('有透明時輸出 32 位元 BITMAPV4HEADER（BI_BITFIELDS＋alpha 遮罩）', () => {
    const data = new Uint8Array([10, 20, 30, 128])
    expect(hasTransparency(data)).toBe(true)
    const b = encodeBmp({ data, width: 1, height: 1 })
    const v = new DataView(b.buffer)
    expect(v.getUint32(10, true)).toBe(14 + 108)
    expect(v.getUint32(14, true)).toBe(108)
    expect(v.getUint16(28, true)).toBe(32)
    expect(v.getUint32(30, true)).toBe(3)
    expect(v.getUint32(54, true)).toBe(0x00ff0000)
    expect(v.getUint32(58, true)).toBe(0x0000ff00)
    expect(v.getUint32(62, true)).toBe(0x000000ff)
    expect(v.getUint32(66, true)).toBe(0xff000000)
    expect(v.getUint32(70, true)).toBe(0x73524742)
    expect([...b.subarray(122, 126)]).toEqual([30, 20, 10, 128])
    expect(b.length).toBe(126)
  })

  it('不透明時自動用 24 位元；可強制指定', () => {
    expect(hasTransparency(rgba2x2)).toBe(false)
    expect(new DataView(encodeBmp({ data: rgba2x2, width: 2, height: 2 }, { alpha: true }).buffer).getUint16(28, true)).toBe(32)
    expect(new DataView(encodeBmp({ data: new Uint8Array([1, 2, 3, 0]), width: 1, height: 1 }, { alpha: false }).buffer).getUint16(28, true)).toBe(24)
  })

  it('錯誤輸入', () => {
    expect(() => encodeBmp({ data: new Uint8Array(4), width: 0, height: 1 })).toThrow()
    expect(() => encodeBmp({ data: new Uint8Array(4), width: 2, height: 2 })).toThrow()
  })
})
