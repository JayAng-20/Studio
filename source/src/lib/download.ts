import { sanitizeFilename } from './filename'

/** 觸發瀏覽器下載；用完立刻 revoke */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = sanitizeFilename(filename)
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** 大檔：支援時用 showSaveFilePicker 串流寫入，否則退回一般下載。回傳 false 表示使用者取消 */
export async function saveLargeBlob(blob: Blob, filename: string): Promise<boolean> {
  const w = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{
      createWritable: () => Promise<WritableStream & { close(): Promise<void> }>
    }>
  }
  if (blob.size > 100 * 1024 * 1024 && typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: sanitizeFilename(filename) })
      const writable = await handle.createWritable()
      await blob.stream().pipeTo(writable)
      return true
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return false
      console.error(e)
    }
  }
  downloadBlob(blob, filename)
  return true
}

/** 複製圖片或文字到剪貼簿 */
export async function copyBlob(blob: Blob): Promise<boolean> {
  try {
    if (!('ClipboardItem' in window) || !navigator.clipboard?.write) return false
    let b = blob
    // 多數瀏覽器剪貼簿只接受 PNG
    if (b.type !== 'image/png' && b.type.startsWith('image/')) {
      const { toPngBlob } = await import('./image')
      b = await toPngBlob(b)
    }
    await navigator.clipboard.write([new ClipboardItem({ [b.type]: b })])
    return true
  } catch (e) {
    console.error(e)
    return false
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    console.error(e)
    return false
  }
}
