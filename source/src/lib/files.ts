/** 檔案輸入相關：類型判斷、資料夾展開、物件 URL 管理 */

export type FileKind = 'image' | 'pdf' | 'video' | 'audio' | 'subtitle' | 'text' | 'other'

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|svg|ico|tiff?)$/i
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|3gp)$/i
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|weba)$/i

export function fileKind(f: { name: string; type: string }): FileKind {
  const t = f.type
  if (t === 'application/pdf' || /\.pdf$/i.test(f.name)) return 'pdf'
  if (t.startsWith('image/') || IMAGE_EXT.test(f.name)) return 'image'
  if (t.startsWith('video/') || VIDEO_EXT.test(f.name)) return 'video'
  if (t.startsWith('audio/') || AUDIO_EXT.test(f.name)) return 'audio'
  if (/\.(srt|vtt)$/i.test(f.name)) return 'subtitle'
  if (
    /\.(md|markdown|txt|rtf)$/i.test(f.name) ||
    t === 'text/markdown' ||
    t === 'text/plain' ||
    t === 'application/rtf' ||
    t === 'text/rtf'
  )
    return 'text'
  return 'other'
}

/** 依 accept 字串（"image/*,.pdf"）判斷檔案是否可接受 */
export function matchesAccept(file: { name: string; type: string }, accept?: string): boolean {
  if (!accept) return true
  const parts = accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  return parts.some((p) => {
    if (p.startsWith('.')) return name.endsWith(p)
    if (p.endsWith('/*')) return type.startsWith(p.slice(0, -1))
    return type === p
  })
}

/** 從拖放事件取出檔案；支援資料夾（webkitGetAsEntry） */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items || [])
  const entries = items
    .filter((i) => i.kind === 'file')
    .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
  if (entries.length && entries.every(Boolean) && entries.some((e) => e!.isDirectory)) {
    const out: File[] = []
    await Promise.all(entries.map((e) => walkEntry(e!, out)))
    return out
  }
  return Array.from(dt.files || [])
}

async function walkEntry(entry: FileSystemEntry, out: File[], depth = 0): Promise<void> {
  if (depth > 8) return
  if (entry.isFile) {
    const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
    if (!f.name.startsWith('.')) out.push(f)
    return
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    let batch: FileSystemEntry[]
    do {
      batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      await Promise.all(batch.map((e) => walkEntry(e, out, depth + 1)))
    } while (batch.length)
  }
}

/** 從貼上事件取出檔案 */
export function filesFromClipboard(e: ClipboardEvent): File[] {
  const items = Array.from(e.clipboardData?.items || [])
  const files: File[] = []
  items.forEach((it, i) => {
    if (it.kind !== 'file') return
    const f = it.getAsFile()
    if (!f) return
    // 剪貼簿的圖片通常叫 image.png，補上時間讓檔名可區分
    if (/^image\.\w+$/.test(f.name)) {
      const ext = f.type.split('/')[1] || 'png'
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
      files.push(new File([f], `pasted_${stamp}${i ? `_${i}` : ''}.${ext}`, { type: f.type }))
    } else files.push(f)
  })
  return files
}

export const LARGE_FILE_BYTES = 200 * 1024 * 1024

/** 物件 URL 管理：集中建立、集中 revoke */
export class UrlPool {
  private urls = new Set<string>()
  create(b: Blob): string {
    const u = URL.createObjectURL(b)
    this.urls.add(u)
    return u
  }
  revoke(u: string) {
    if (this.urls.delete(u)) URL.revokeObjectURL(u)
  }
  revokeAll() {
    this.urls.forEach((u) => URL.revokeObjectURL(u))
    this.urls.clear()
  }
}

/** 一個檔案在記憶體中的唯一 key（記住播放進度等用途） */
export const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`

let idCounter = 0
export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`
