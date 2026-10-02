/**
 * 文字檔轉 PDF 的工作狀態（模組層級：在 PDF 工具內切換工具再回來，檔案與設定仍在）。
 * 設定值另外記在 localStorage（只存版面偏好，不存檔案內容）。
 */
import { create } from 'zustand'
import { uid } from '@/lib/files'
import { readJSON, writeJSON } from '@/lib/storage'
import { DEFAULT_OPTIONS, type ConvertOptions } from './engine/options'
import { decodeWith, detectAndDecode, type TextEncodingId } from './engine/encoding'
import { docStats, type DocModel, type DocStats, type SourceKind } from './engine/model'
import { EngineError, parseSource } from './lib/client'
import { t } from '@/i18n'

export const TEXT_ACCEPT = '.md,.markdown,.mdown,.mkd,.txt,.text,.rtf,text/plain,text/markdown,application/rtf,text/rtf'
export const IMAGE_ACCEPT = 'image/*,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.avif'
export const ACCEPT = `${TEXT_ACCEPT},${IMAGE_ACCEPT}`
/** 超過這個大小的文字檔先提醒 */
export const BIG_TEXT_BYTES = 5 * 1024 * 1024

export type SourceError = 'empty' | 'decode' | 'notRtf' | 'parse'

export interface Source {
  id: string
  name: string
  kind: SourceKind
  size: number
  bytes: Uint8Array
  /** md／txt 目前使用的編碼 */
  encoding: TextEncodingId | null
  /** 自動偵測的結果 */
  detected: TextEncodingId | null
  /** 解碼時有無效位元組 */
  lossy: boolean
  /** TXT：保持原樣（不辨識結構） */
  raw: boolean
  status: 'parsing' | 'ready' | 'error'
  error?: SourceError
  doc?: DocModel
  stats?: DocStats
  pasted?: boolean
  version: number
}

export interface Attachment {
  id: string
  name: string
  /** 拖入資料夾時的相對路徑 */
  path?: string
  bytes: Uint8Array
  mime: string
  url: string
}

export interface Output {
  name: string
  blob: Blob
  pages: number
  missing: number
  title: string
}

const OPTIONS_KEY = 'jayang:doc2pdf:options'

type PersistedOptions = Omit<ConvertOptions, 'exclude' | 'title' | 'date'>

function loadOptions(): ConvertOptions {
  const saved = readJSON<Partial<PersistedOptions>>(OPTIONS_KEY, {})
  const o = { ...DEFAULT_OPTIONS }
  for (const k of Object.keys(DEFAULT_OPTIONS) as (keyof ConvertOptions)[]) {
    if (k === 'exclude' || k === 'title' || k === 'date') continue
    const v = saved[k as keyof PersistedOptions]
    if (v !== undefined && typeof v === typeof DEFAULT_OPTIONS[k]) (o as Record<string, unknown>)[k] = v
  }
  return o
}

export function kindOf(name: string, mime = ''): SourceKind | null {
  const n = name.toLowerCase()
  if (/\.(md|markdown|mdown|mkd)$/.test(n) || mime === 'text/markdown') return 'md'
  if (/\.rtf$/.test(n) || mime === 'application/rtf' || mime === 'text/rtf') return 'rtf'
  if (/\.(txt|text)$/.test(n) || mime === 'text/plain') return 'txt'
  return null
}

export const isImageFile = (f: { name: string; type: string }) =>
  f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name)

/** 貼上的文字是否像 Markdown */
export function looksLikeMarkdown(text: string): boolean {
  let score = 0
  if (/^#{1,6}\s+\S/m.test(text)) score += 2
  if (/^\s*\|.*\|\s*$/m.test(text) && /^\s*\|?\s*:?-{3,}/m.test(text)) score += 2
  if (/^\s*[-*+]\s+\S/m.test(text)) score += 1
  if (/^\s*\d+\.\s+\S/m.test(text)) score += 1
  if (/\*\*[^*\n]+\*\*|__[^_\n]+__/.test(text)) score += 1
  if (/\[[^\]\n]+\]\([^)\s]+\)/.test(text)) score += 2
  if (/^```/m.test(text)) score += 2
  if (/^>\s/m.test(text)) score += 1
  return score >= 2
}

interface State {
  sources: Source[]
  attachments: Attachment[]
  options: ConvertOptions
  merge: boolean
  /** 不納入目錄的標題 id */
  exclude: string[]
  outputs: Output[] | null
  pasteCount: number
  addFiles: (files: File[]) => Promise<void>
  addText: (text: string, kind: 'md' | 'txt') => void
  remove: (id: string) => void
  removeAttachment: (id: string) => void
  reorder: (sources: Source[]) => void
  setEncoding: (id: string, enc: TextEncodingId) => void
  setRaw: (id: string, raw: boolean) => void
  setOption: <K extends keyof ConvertOptions>(k: K, v: ConvertOptions[K]) => void
  setMerge: (v: boolean) => void
  setExcluded: (ids: string[], excluded: boolean) => void
  setOutputs: (o: Output[] | null) => void
  clear: () => void
}

let parseSeq = 0

export const useDoc2Pdf = create<State>((set, get) => {
  const patch = (id: string, p: Partial<Source>) =>
    set((s) => ({ sources: s.sources.map((x) => (x.id === id ? { ...x, ...p } : x)) }))

  /** 解碼＋解析（Worker）；version 防止舊結果覆蓋新結果 */
  const parse = async (id: string) => {
    const src = get().sources.find((x) => x.id === id)
    if (!src) return
    const version = ++parseSeq
    patch(id, { status: 'parsing', version, error: undefined })
    try {
      let text: string | undefined
      if (src.kind !== 'rtf') {
        const dec = src.encoding ? decodeWith(src.bytes, src.encoding) : detectAndDecode(src.bytes)
        if (!src.encoding) patch(id, { encoding: dec.encoding, detected: dec.encoding })
        patch(id, { lossy: dec.lossy })
        text = dec.text
        if (!text.trim()) {
          patch(id, { status: 'error', error: 'empty' })
          return
        }
      } else if (!src.bytes.length) {
        patch(id, { status: 'error', error: 'empty' })
        return
      }
      const doc = await parseSource({
        kind: src.kind,
        name: src.name,
        text,
        bytes: src.kind === 'rtf' ? src.bytes : undefined,
        raw: src.raw,
        idPrefix: `${src.id}-`,
      })
      const cur = get().sources.find((x) => x.id === id)
      if (!cur || cur.version !== version) return
      if (!doc.blocks.length) {
        patch(id, { status: 'error', error: 'empty' })
        return
      }
      // 重新解析後標題 id 可能改變：清掉這份文件的排除設定
      set((s) => ({ exclude: s.exclude.filter((e) => !e.startsWith(`${id}-`)) }))
      patch(id, { status: 'ready', doc, stats: docStats(doc) })
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return
      console.error(e)
      const cur = get().sources.find((x) => x.id === id)
      if (!cur || cur.version !== version) return
      patch(id, { status: 'error', error: e instanceof EngineError && e.code === 'notRtf' ? 'notRtf' : 'parse' })
    }
  }

  return {
    sources: [],
    attachments: [],
    options: loadOptions(),
    merge: false,
    exclude: [],
    outputs: null,
    pasteCount: 0,

    addFiles: async (files) => {
      const newSources: Source[] = []
      const newAtt: Attachment[] = []
      for (const f of files) {
        const kind = kindOf(f.name, f.type)
        const bytes = new Uint8Array(await f.arrayBuffer())
        const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || undefined
        if (kind) {
          newSources.push({
            id: uid('src'),
            name: f.name,
            kind,
            size: f.size,
            bytes,
            encoding: null,
            detected: null,
            lossy: false,
            raw: false,
            status: 'parsing',
            version: 0,
          })
        } else if (isImageFile(f)) {
          newAtt.push({
            id: uid('img'),
            name: f.name,
            path,
            bytes,
            mime: f.type || 'image/png',
            url: URL.createObjectURL(f),
          })
        }
      }
      set((s) => ({
        sources: [...s.sources, ...newSources],
        attachments: [...s.attachments, ...newAtt],
        outputs: null,
      }))
      for (const s of newSources) void parse(s.id)
    },

    addText: (text, kind) => {
      const n = get().pasteCount + 1
      const name = `${t('doc2pdf.pastedName', { n })}.${kind}`
      const bytes = new TextEncoder().encode(text)
      const src: Source = {
        id: uid('src'),
        name,
        kind,
        size: bytes.length,
        bytes,
        encoding: 'utf-8',
        detected: 'utf-8',
        lossy: false,
        raw: false,
        status: 'parsing',
        pasted: true,
        version: 0,
      }
      set((s) => ({ sources: [...s.sources, src], pasteCount: n, outputs: null }))
      void parse(src.id)
    },

    remove: (id) =>
      set((s) => ({
        sources: s.sources.filter((x) => x.id !== id),
        exclude: s.exclude.filter((e) => !e.startsWith(`${id}-`)),
        outputs: null,
      })),

    removeAttachment: (id) =>
      set((s) => {
        const a = s.attachments.find((x) => x.id === id)
        if (a) URL.revokeObjectURL(a.url)
        return { attachments: s.attachments.filter((x) => x.id !== id) }
      }),

    reorder: (sources) => set({ sources }),

    setEncoding: (id, enc) => {
      patch(id, { encoding: enc })
      void parse(id)
    },

    setRaw: (id, raw) => {
      patch(id, { raw })
      void parse(id)
    },

    setOption: (k, v) => {
      set((s) => ({ options: { ...s.options, [k]: v } }))
      const { exclude: _e, title: _t, date: _d, ...persist } = get().options
      writeJSON(OPTIONS_KEY, persist)
    },

    setMerge: (merge) => set({ merge }),

    setExcluded: (ids, excluded) =>
      set((s) => {
        const cur = new Set(s.exclude)
        for (const id of ids) {
          if (excluded) cur.add(id)
          else cur.delete(id)
        }
        return { exclude: [...cur] }
      }),

    setOutputs: (outputs) => set({ outputs }),

    clear: () => {
      for (const a of get().attachments) URL.revokeObjectURL(a.url)
      set({ sources: [], attachments: [], exclude: [], outputs: null })
    },
  }
})
