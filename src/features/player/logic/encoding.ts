/**
 * 文字編碼偵測：BOM → UTF‑8（嚴格）→ Big5 → 其他常見編碼，取替換字元最少的結果。
 */

export type TextEncodingName =
  'utf-8' | 'utf-16le' | 'utf-16be' | 'big5' | 'gb18030' | 'shift_jis' | 'windows-1252'

export const MANUAL_ENCODINGS: TextEncodingName[] = [
  'utf-8',
  'big5',
  'gb18030',
  'shift_jis',
  'utf-16le',
  'windows-1252',
]

export interface DecodedText {
  text: string
  encoding: TextEncodingName
  /** 是否由自動偵測退回（非 UTF‑8／BOM） */
  fallback: boolean
}

function tryDecode(bytes: Uint8Array, enc: TextEncodingName, fatal = false): string | null {
  try {
    return new TextDecoder(enc, { fatal }).decode(bytes)
  } catch {
    return null
  }
}

const countReplacement = (s: string) => {
  let n = 0
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xfffd) n++
  return n
}

/** 用指定編碼解碼（去除 BOM）；失敗時回傳 null */
export function decodeWith(bytes: Uint8Array, enc: TextEncodingName): string | null {
  const s = tryDecode(bytes, enc)
  return s === null ? null : s.replace(new RegExp('^\\ufeff'), '')
}

/** 自動偵測並解碼 */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: tryDecode(bytes.subarray(3), 'utf-8') ?? '', encoding: 'utf-8', fallback: false }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: tryDecode(bytes.subarray(2), 'utf-16le') ?? '',
      encoding: 'utf-16le',
      fallback: false,
    }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: tryDecode(bytes.subarray(2), 'utf-16be') ?? '',
      encoding: 'utf-16be',
      fallback: false,
    }
  }
  const utf8 = tryDecode(bytes, 'utf-8', true)
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8', fallback: false }

  // UTF‑8 失敗：優先 Big5（台灣常見），替換字元太多時再比較其他編碼
  let best: DecodedText | null = null
  let bestBad = Infinity
  for (const enc of ['big5', 'gb18030', 'shift_jis', 'windows-1252'] as const) {
    const s = tryDecode(bytes, enc)
    if (s === null) continue
    const bad = countReplacement(s)
    if (bad < bestBad) {
      best = { text: s, encoding: enc, fallback: true }
      bestBad = bad
    }
    if (bad === 0) break
  }
  return best ?? { text: tryDecode(bytes, 'utf-8') ?? '', encoding: 'utf-8', fallback: true }
}
