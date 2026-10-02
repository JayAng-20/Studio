/**
 * 修正字型讓 @pdf-lib/fontkit 的子集化正確：
 * fontkit 的 TTFSubset 在子集總長度 ≤ 0xFFFF 時改用短格式 loca（位移量 ÷ 2），
 * 但沒有把每個字形補齊成偶數長度——思源黑體用長格式 loca、字形長度常是奇數，
 * 子集後位移量被截斷，大部分字形會變成空白。
 * 這裡在嵌入前把 glyf 表的每個字形補齊到偶數長度並重建 loca（長格式），字形內容完全不變。
 */

interface TableRec {
  tag: string
  offset: number
  length: number
}

function checksum(b: Uint8Array): number {
  let sum = 0
  const n = b.length
  for (let i = 0; i < n; i += 4) {
    const v =
      ((b[i] << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0
    sum = (sum + v) >>> 0
  }
  return sum
}

/** 字形長度是否已經全部是偶數（不需要修正） */
export function glyphsAreEven(src: Uint8Array): boolean {
  const info = readLoca(src)
  if (!info) return true
  const { offsets } = info
  for (let i = 0; i < offsets.length - 1; i++) if ((offsets[i + 1] - offsets[i]) % 2) return false
  return true
}

function readTables(src: Uint8Array) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength)
  const num = dv.getUint16(4)
  const tables: TableRec[] = []
  for (let i = 0; i < num; i++) {
    const p = 12 + i * 16
    const tag = String.fromCharCode(src[p], src[p + 1], src[p + 2], src[p + 3])
    tables.push({ tag, offset: dv.getUint32(p + 8), length: dv.getUint32(p + 12) })
  }
  return { dv, tables }
}

function readLoca(src: Uint8Array) {
  const { dv, tables } = readTables(src)
  const t = (tag: string) => tables.find((x) => x.tag === tag)
  const head = t('head')
  const maxp = t('maxp')
  const loca = t('loca')
  const glyf = t('glyf')
  if (!head || !maxp || !loca || !glyf) return null
  const format = dv.getInt16(head.offset + 50)
  const n = dv.getUint16(maxp.offset + 4)
  const offsets = new Array<number>(n + 1)
  for (let i = 0; i <= n; i++)
    offsets[i] =
      format === 0 ? dv.getUint16(loca.offset + i * 2) * 2 : dv.getUint32(loca.offset + i * 4)
  return { tables, offsets, head, loca, glyf }
}

export function padGlyphs(src: Uint8Array): Uint8Array {
  const info = readLoca(src)
  if (!info) return src
  const { tables, offsets, glyf } = info
  let odd = false
  for (let i = 0; i < offsets.length - 1; i++) if ((offsets[i + 1] - offsets[i]) % 2) odd = true
  if (!odd) return src

  // 新的 glyf 與 loca（長格式）
  let glyfLen = 0
  for (let i = 0; i < offsets.length - 1; i++) {
    const len = offsets[i + 1] - offsets[i]
    glyfLen += len + (len % 2)
  }
  const newGlyf = new Uint8Array(glyfLen)
  const newLoca = new Uint8Array(offsets.length * 4)
  const locaDv = new DataView(newLoca.buffer)
  let pos = 0
  for (let i = 0; i < offsets.length - 1; i++) {
    locaDv.setUint32(i * 4, pos)
    const len = offsets[i + 1] - offsets[i]
    newGlyf.set(src.subarray(glyf.offset + offsets[i], glyf.offset + offsets[i + 1]), pos)
    pos += len + (len % 2)
  }
  locaDv.setUint32((offsets.length - 1) * 4, pos)

  const data = new Map<string, Uint8Array>()
  for (const tb of tables) data.set(tb.tag, src.slice(tb.offset, tb.offset + tb.length))
  data.set('glyf', newGlyf)
  data.set('loca', newLoca)
  const head = data.get('head')!
  const hdv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  hdv.setInt16(50, 1) // indexToLocFormat = long
  hdv.setUint32(8, 0) // checkSumAdjustment 先歸零

  const num = tables.length
  const headerLen = 12 + num * 16
  let total = headerLen
  for (const tb of tables) total += (data.get(tb.tag)!.length + 3) & ~3
  const out = new Uint8Array(total)
  const odv = new DataView(out.buffer)
  out.set(src.subarray(0, 12), 0)
  let off = headerLen
  let headOffset = 0
  tables.forEach((tb, i) => {
    const d = data.get(tb.tag)!
    const p = 12 + i * 16
    out.set(src.subarray(p, p + 4), p)
    odv.setUint32(p + 4, checksum(d))
    odv.setUint32(p + 8, off)
    odv.setUint32(p + 12, d.length)
    out.set(d, off)
    if (tb.tag === 'head') headOffset = off
    off += (d.length + 3) & ~3
  })
  // 整個檔案的校驗調整值
  odv.setUint32(headOffset + 8, (0xb1b0afba - checksum(out)) >>> 0)
  return out
}
