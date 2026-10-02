/**
 * 極簡 ID3v2 解析（v2.2／2.3／2.4）：標題、演出者、專輯、封面（APIC／PIC）。
 * 只讀取標籤本身，不解析音訊。
 */

export interface Id3Picture {
  mime: string
  data: Uint8Array
}

export interface Id3Tags {
  title?: string
  artist?: string
  album?: string
  picture?: Id3Picture
}

/** 讀取 ID3 標頭，回傳整個標籤（含 10 位元組標頭）的長度；不是 ID3 時回傳 0 */
export function id3TagSize(head: Uint8Array): number {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0
  const size = synchsafe(head, 6)
  const footer = head[5] & 0x10 ? 10 : 0
  return 10 + size + footer
}

function synchsafe(b: Uint8Array, o: number): number {
  return (
    ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)
  )
}

const u32 = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const u24 = (b: Uint8Array, o: number) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]

/** 去除反同步（0xFF 0x00 → 0xFF） */
function deunsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length)
  let j = 0
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i]
    if (b[i] === 0xff && b[i + 1] === 0x00) i++
  }
  return out.subarray(0, j)
}

function decodeString(enc: number, bytes: Uint8Array): string {
  let label: string
  let data = bytes
  switch (enc) {
    case 1:
      label = 'utf-16'
      break
    case 2:
      label = 'utf-16be'
      break
    case 3:
      label = 'utf-8'
      break
    default:
      label = 'latin1'
  }
  if (enc === 1 && data[0] === 0xfe && data[1] === 0xff) {
    label = 'utf-16be'
    data = data.subarray(2)
  } else if (enc === 1 && data[0] === 0xff && data[1] === 0xfe) {
    label = 'utf-16le'
    data = data.subarray(2)
  }
  try {
    return new TextDecoder(label).decode(data).replace(/\0+$/g, '').replace(/\0/g, ' / ').trim()
  } catch {
    return ''
  }
}

/** 找到字串結尾（依編碼為單或雙 0 位元組），回傳結尾後的位置 */
function skipTerminated(b: Uint8Array, start: number, enc: number): number {
  const wide = enc === 1 || enc === 2
  if (!wide) {
    let i = start
    while (i < b.length && b[i] !== 0) i++
    return i + 1
  }
  let i = start
  while (i + 1 < b.length && !(b[i] === 0 && b[i + 1] === 0)) i += 2
  return i + 2
}

function parsePicture(body: Uint8Array, v22: boolean): Id3Picture | undefined {
  if (body.length < 4) return undefined
  const enc = body[0]
  let i = 1
  let mime: string
  if (v22) {
    const fmt = String.fromCharCode(body[1], body[2], body[3]).toLowerCase()
    mime = fmt === 'png' ? 'image/png' : 'image/jpeg'
    i = 4
  } else {
    const end = body.indexOf(0, 1)
    if (end < 0) return undefined
    mime = new TextDecoder('latin1').decode(body.subarray(1, end)).toLowerCase() || 'image/jpeg'
    if (!mime.includes('/')) mime = `image/${mime === 'jpg' ? 'jpeg' : mime}`
    i = end + 1
  }
  i += 1 // 圖片類型
  i = skipTerminated(body, i, enc) // 描述
  if (i >= body.length) return undefined
  const data = body.slice(i)
  // 以檔頭確認格式
  if (data[0] === 0x89 && data[1] === 0x50) mime = 'image/png'
  else if (data[0] === 0xff && data[1] === 0xd8) mime = 'image/jpeg'
  return { mime, data }
}

/** 解析整個 ID3v2 標籤（傳入從檔案開頭讀到的位元組） */
export function parseId3(bytes: Uint8Array): Id3Tags | null {
  const total = id3TagSize(bytes)
  if (!total) return null
  const version = bytes[3]
  if (version < 2 || version > 4) return null
  const flags = bytes[5]
  const v22 = version === 2
  let tag = bytes.subarray(10, Math.min(bytes.length, total))
  if (flags & 0x80 && version < 4) tag = deunsync(tag)
  let pos = 0
  // 延伸標頭
  if (flags & 0x40 && !v22) {
    const extSize = version === 4 ? synchsafe(tag, 0) : u32(tag, 0) + 4
    pos = extSize
  }
  const out: Id3Tags = {}
  const headerLen = v22 ? 6 : 10
  while (pos + headerLen <= tag.length) {
    const id = String.fromCharCode(...tag.subarray(pos, pos + (v22 ? 3 : 4)))
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break
    const size = v22
      ? u24(tag, pos + 3)
      : version === 4
        ? synchsafe(tag, pos + 4)
        : u32(tag, pos + 4)
    const frameFlags = v22 ? 0 : tag[pos + 9]
    const start = pos + headerLen
    const end = start + size
    if (size <= 0 || end > tag.length) break
    let body = tag.subarray(start, end)
    if (version === 4 && frameFlags & 0x02) body = deunsync(body)
    if (version === 4 && frameFlags & 0x01) body = body.subarray(4) // 資料長度指示
    if (id === 'TIT2' || id === 'TT2') out.title ||= decodeString(body[0], body.subarray(1))
    else if (id === 'TPE1' || id === 'TP1') out.artist ||= decodeString(body[0], body.subarray(1))
    else if (id === 'TALB' || id === 'TAL') out.album ||= decodeString(body[0], body.subarray(1))
    else if ((id === 'APIC' || id === 'PIC') && !out.picture) out.picture = parsePicture(body, v22)
    pos = end
  }
  return out
}

/** 從檔案讀取 ID3（最多讀 8 MB） */
export async function readId3(file: Blob): Promise<Id3Tags | null> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer())
  const size = id3TagSize(head)
  if (!size) return null
  const bytes = new Uint8Array(await file.slice(0, Math.min(size, 8 * 1024 * 1024)).arrayBuffer())
  return parseId3(bytes)
}
