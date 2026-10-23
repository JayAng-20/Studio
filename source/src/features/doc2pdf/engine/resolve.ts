/**
 * 解析文件中的圖片：data URL 直接解碼；相對路徑比對同時拖入的圖片檔；外部網址不下載（顯示替代文字框）。
 * PNG／JPEG 直接嵌入；其他格式（GIF、WebP、SVG…）交給 convertOther（主執行緒用 canvas 轉 PNG）。
 */
import { decodeDataUrl, imageInfo, isExternalUrl, matchImageFile } from './images'
import { walkBlocks, type DocModel, type ImageBlock, type ImageData } from './model'

export interface ImageFile {
  name: string
  /** 拖入資料夾時的相對路徑 */
  path?: string
  bytes: Uint8Array
  mime: string
}

export type ConvertOther = (bytes: Uint8Array, mime: string) => Promise<ImageData | null>

async function toImageData(
  bytes: Uint8Array,
  mime: string,
  convertOther?: ConvertOther,
): Promise<ImageData | null> {
  const info = imageInfo(bytes)
  if (info) return { bytes, ...info }
  if (convertOther) {
    try {
      return await convertOther(bytes, mime)
    } catch (e) {
      console.error(e)
    }
  }
  return null
}

export async function resolveImages(
  doc: DocModel,
  files: ImageFile[],
  convertOther?: ConvertOther,
): Promise<DocModel> {
  const imgs: ImageBlock[] = []
  walkBlocks(doc.blocks, (b) => {
    if (b.type === 'image' && !b.data) imgs.push(b)
  })
  const cache = new Map<string, ImageData | null>()
  for (const b of imgs) {
    const src = b.src.trim()
    if (!src) {
      b.missing = 'notFound'
      continue
    }
    if (cache.has(src)) {
      const d = cache.get(src)
      if (d) b.data = d
      else b.missing = 'unsupported'
      continue
    }
    if (src.startsWith('data:')) {
      const dec = decodeDataUrl(src)
      const d = dec ? await toImageData(dec.bytes, dec.mime, convertOther) : null
      cache.set(src, d)
      if (d) b.data = d
      else b.missing = 'unsupported'
      continue
    }
    if (isExternalUrl(src)) {
      b.missing = 'external'
      continue
    }
    const f = matchImageFile(src, files)
    if (!f) {
      b.missing = 'notFound'
      continue
    }
    const d = await toImageData(f.bytes, f.mime, convertOther)
    cache.set(src, d)
    if (d) b.data = d
    else b.missing = 'unsupported'
  }
  return doc
}
