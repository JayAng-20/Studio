/** 影像資料工具：讀取 PNG／JPEG 尺寸、解碼 data URL、比對相對路徑 */
import type { ImageData } from './model'

/** 讀 PNG／JPEG 檔頭取得格式與像素尺寸；其他格式回傳 null */
export function imageInfo(b: Uint8Array): Omit<ImageData, 'bytes'> | null {
  // PNG：簽章＋IHDR
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { format: 'png', width: dv.getUint32(16), height: dv.getUint32(20) }
  }
  // JPEG：找 SOF 標記
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marker = b[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      const len = (b[i + 2] << 8) | b[i + 3]
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) {
        const height = (b[i + 5] << 8) | b[i + 6]
        const width = (b[i + 7] << 8) | b[i + 8]
        return width && height ? { format: 'jpg', width, height } : null
      }
      i += 2 + len
    }
  }
  return null
}

/** 解析 data URL；回傳位元組與 MIME */
export function decodeDataUrl(url: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]*)(;[^,]*)?,(.*)$/s.exec(url.trim())
  if (!m) return null
  const mime = m[1] || 'text/plain'
  const isBase64 = /;base64/i.test(m[2] ?? '')
  try {
    if (isBase64) {
      const bin = atob(m[3].replace(/\s+/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { bytes, mime }
    }
    return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), mime }
  } catch {
    return null
  }
}

/** 十六進位字串 → 位元組（RTF \pict 內的影像資料） */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const out = new Uint8Array(clean.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
  return out
}

export const isExternalUrl = (src: string) => /^(https?:)?\/\//i.test(src.trim())

/** 正規化相對路徑以便比對同時拖入的圖片（./img/a.png → img/a.png，大小寫不敏感） */
export function normalizeRelPath(src: string): string {
  let s = src.trim().split(/[?#]/)[0]
  try {
    s = decodeURIComponent(s)
  } catch {
    // 保留原字串
  }
  return s
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .toLowerCase()
}

/** 在檔案清單中找出對應相對路徑的圖片：先比完整路徑結尾，再比檔名 */
export function matchImageFile<T extends { name: string; path?: string }>(
  src: string,
  files: T[],
): T | undefined {
  const want = normalizeRelPath(src)
  if (!want) return undefined
  const base = want.split('/').pop()!
  return (
    files.find((f) => (f.path ?? f.name).toLowerCase().replace(/\\/g, '/').endsWith(want)) ??
    files.find((f) => f.name.toLowerCase() === base)
  )
}
