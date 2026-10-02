/**
 * ICO 封裝（PNG-in-ICO）：把多張 PNG 包成一個 .ico 檔。
 * 結構：ICONDIR（6 bytes）＋ ICONDIRENTRY × n（各 16 bytes）＋ PNG 資料依序排列。
 * Windows Vista 以後、所有主流瀏覽器都能讀取內嵌 PNG 的圖示。
 */

export interface IcoImage {
  width: number
  height: number
  /** 完整的 PNG 檔案位元組 */
  png: Uint8Array
}

export interface IcoDirEntry {
  width: number
  height: number
  bitCount: number
  bytes: number
  offset: number
}

const HEADER = 6
const ENTRY = 16

/** ICO 規格允許的最大邊長（256 在目錄中寫成 0） */
export const ICO_MAX_SIZE = 256

export function encodeIco(images: IcoImage[]): Uint8Array {
  if (!images.length) throw new Error('ICO 至少需要一張圖')
  // 由小到大排列（多數讀取器不在意順序，但這是慣例）
  const list = [...images].sort((a, b) => a.width * a.height - b.width * b.height)
  for (const im of list) {
    if (im.width < 1 || im.height < 1 || im.width > ICO_MAX_SIZE || im.height > ICO_MAX_SIZE)
      throw new Error(`ICO 尺寸超出範圍：${im.width}×${im.height}`)
  }
  const dataStart = HEADER + ENTRY * list.length
  const total = dataStart + list.reduce((a, im) => a + im.png.length, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint16(0, 0, true) // reserved
  view.setUint16(2, 1, true) // type：1 = icon
  view.setUint16(4, list.length, true)
  let offset = dataStart
  list.forEach((im, i) => {
    const p = HEADER + i * ENTRY
    out[p] = im.width >= ICO_MAX_SIZE ? 0 : im.width
    out[p + 1] = im.height >= ICO_MAX_SIZE ? 0 : im.height
    out[p + 2] = 0 // 色盤數（PNG 為 0）
    out[p + 3] = 0 // reserved
    view.setUint16(p + 4, 1, true) // color planes
    view.setUint16(p + 6, 32, true) // bits per pixel
    view.setUint32(p + 8, im.png.length, true)
    view.setUint32(p + 12, offset, true)
    out.set(im.png, offset)
    offset += im.png.length
  })
  return out
}

/** 讀取 ICO 目錄（測試與檢查用） */
export function readIcoDirectory(bytes: Uint8Array): IcoDirEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < HEADER || view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1)
    throw new Error('不是 ICO 檔案')
  const count = view.getUint16(4, true)
  const out: IcoDirEntry[] = []
  for (let i = 0; i < count; i++) {
    const p = HEADER + i * ENTRY
    out.push({
      width: bytes[p] || 256,
      height: bytes[p + 1] || 256,
      bitCount: view.getUint16(p + 6, true),
      bytes: view.getUint32(p + 8, true),
      offset: view.getUint32(p + 12, true),
    })
  }
  return out
}
