import { zip, unzip, type Zippable } from 'fflate'
import { createDeduper, sanitizeFilename } from './filename'

export interface ZipEntry {
  name: string
  data: Blob | Uint8Array
}

/** 把多個檔案打包成 ZIP（同名自動去重）；已壓縮格式不再壓縮以節省時間 */
export async function createZip(entries: ZipEntry[], signal?: AbortSignal): Promise<Blob> {
  const dedupe = createDeduper()
  const files: Zippable = {}
  for (const e of entries) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const data = e.data instanceof Uint8Array ? e.data : new Uint8Array(await e.data.arrayBuffer())
    const name = dedupe(sanitizeFilename(e.name))
    const compressed = /\.(jpe?g|png|webp|avif|gif|mp4|webm|zip|pdf|heic)$/i.test(name)
    files[name] = [data, { level: compressed ? 0 : 6 }]
  }
  return new Promise((resolve, reject) => {
    const term = zip(files, (err, out) => {
      if (err) reject(err)
      else resolve(new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))
    })
    signal?.addEventListener('abort', () => {
      term()
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

export function readZip(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) =>
    unzip(data, (err, out) => (err ? reject(err) : resolve(out))),
  )
}
