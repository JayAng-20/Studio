// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { encodeIco, readIcoDirectory } from '@/lib/convert-ico'

/** 假 PNG：PNG 簽章＋可辨識的內容 */
const fakePng = (size: number, fill: number) => {
  const b = new Uint8Array(8 + size)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  b.fill(fill, 8)
  return b
}

describe('ICO 封裝（PNG-in-ICO）', () => {
  const sizes = [256, 16, 48, 32]
  const images = sizes.map((s, i) => ({ width: s, height: s, png: fakePng(10 + i * 7, i + 1) }))
  const ico = encodeIco(images)
  const view = new DataView(ico.buffer)

  it('ICONDIR 標頭：reserved 0、type 1、數量正確', () => {
    expect(view.getUint16(0, true)).toBe(0)
    expect(view.getUint16(2, true)).toBe(1)
    expect(view.getUint16(4, true)).toBe(4)
  })

  it('目錄依尺寸由小到大，256 寫成 0，32 位元、1 個 plane', () => {
    expect([...ico.subarray(6, 6 + 16 * 4)].filter((_, i) => i % 16 === 0)).toEqual([16, 32, 48, 0])
    for (let i = 0; i < 4; i++) {
      const p = 6 + i * 16
      expect(ico[p + 2]).toBe(0) // 色盤數
      expect(ico[p + 3]).toBe(0) // reserved
      expect(view.getUint16(p + 4, true)).toBe(1)
      expect(view.getUint16(p + 6, true)).toBe(32)
    }
    const dir = readIcoDirectory(ico)
    expect(dir.map((d) => d.width)).toEqual([16, 32, 48, 256])
    expect(dir.map((d) => d.height)).toEqual([16, 32, 48, 256])
  })

  it('資料位移連續、長度正確、內容就是原本的 PNG', () => {
    const dir = readIcoDirectory(ico)
    let expected = 6 + 16 * 4
    for (const d of dir) {
      expect(d.offset).toBe(expected)
      expected += d.bytes
      const src = images.find((im) => im.width === d.width)!
      expect(d.bytes).toBe(src.png.length)
      expect([...ico.subarray(d.offset, d.offset + d.bytes)]).toEqual([...src.png])
      // 每一段都以 PNG 簽章開頭
      expect([...ico.subarray(d.offset, d.offset + 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    }
    expect(ico.length).toBe(expected)
  })

  it('非正方形尺寸也能寫入', () => {
    const dir = readIcoDirectory(encodeIco([{ width: 64, height: 32, png: fakePng(4, 9) }]))
    expect(dir[0]).toMatchObject({ width: 64, height: 32, bitCount: 32 })
  })

  it('錯誤輸入', () => {
    expect(() => encodeIco([])).toThrow()
    expect(() => encodeIco([{ width: 512, height: 512, png: fakePng(1, 1) }])).toThrow()
    expect(() => readIcoDirectory(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow()
  })
})
