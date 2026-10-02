/**
 * PDF 模組狀態：已載入的 PDF（文件匣，所有工具共用）、圖片清單（圖片轉 PDF）、密碼請求。
 * pdf.js 文件物件不放進 store（不可序列化），以 id 對應存在 docs Map。
 */
import { create } from 'zustand'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { uid } from '@/lib/files'
import { toast } from '@/components/ui'
import { t } from '@/i18n'
import { useRecents } from '@/stores/recents'
import {
  PasswordCanceledError,
  destroyDoc,
  docFlags,
  dropThumbs,
  openPdf,
  pageSizes,
  type DocFlags,
} from './lib/pdfjs'

export interface PdfSource extends DocFlags {
  id: string
  file: File
  name: string
  size: number
  status: 'loading' | 'ready'
  pageCount: number
  password?: string
  /** 每頁尺寸（已套用 /Rotate；載入後背景補齊） */
  sizes: Array<{ w: number; h: number }>
  /** 來源（例如由「移除密碼」產生） */
  origin?: string
}

export interface PasswordRequest {
  /** 每次詢問遞增，讓表單重設 */
  seq: number
  name: string
  reason: number
  /** 已送出、等待驗證中 */
  verifying?: boolean
  resolve: (pw: string | null) => void
}

interface PdfState {
  sources: PdfSource[]
  activeId: string | null
  password: PasswordRequest | null
  setActive: (id: string) => void
  reorder: (ids: string[]) => void
  remove: (id: string) => void
  clear: () => void
  patch: (id: string, p: Partial<PdfSource>) => void
}

/** pdf.js 文件（依 source id） */
const docs = new Map<string, Promise<PDFDocumentProxy>>()

export const usePdf = create<PdfState>((set, get) => ({
  sources: [],
  activeId: null,
  password: null,
  setActive: (id) => set({ activeId: id }),
  reorder: (ids) =>
    set((s) => ({
      sources: ids.map((id) => s.sources.find((x) => x.id === id)!).filter(Boolean),
    })),
  remove: (id) => {
    releaseDoc(id)
    set((s) => {
      const sources = s.sources.filter((x) => x.id !== id)
      return {
        sources,
        activeId: s.activeId === id ? (sources[0]?.id ?? null) : s.activeId,
      }
    })
  },
  clear: () => {
    get().sources.forEach((s) => releaseDoc(s.id))
    set({ sources: [], activeId: null })
  },
  patch: (id, p) =>
    set((s) => ({ sources: s.sources.map((x) => (x.id === id ? { ...x, ...p } : x)) })),
}))

function releaseDoc(id: string) {
  const d = docs.get(id)
  docs.delete(id)
  dropThumbs(id)
  d?.then((doc) => destroyDoc(doc)).catch(() => {})
}

let passwordSeq = 0

/** 彈出密碼對話框，等待使用者輸入（null 表示取消） */
export function askPassword(name: string, reason: number): Promise<string | null> {
  return new Promise((resolve) => {
    usePdf.setState({
      password: {
        seq: ++passwordSeq,
        name,
        reason,
        resolve: (pw) => {
          // 送出後保持對話框開啟（顯示驗證中），密碼錯誤時會直接換成下一次詢問，避免閃爍
          const cur = usePdf.getState().password
          usePdf.setState({ password: pw === null || !cur ? null : { ...cur, verifying: true } })
          resolve(pw)
        },
      },
    })
  })
}

/** 取得某個來源的 pdf.js 文件（已開啟則共用） */
export function getDoc(id: string): Promise<PDFDocumentProxy> {
  const d = docs.get(id)
  if (d) return d
  const src = usePdf.getState().sources.find((s) => s.id === id)
  if (!src) return Promise.reject(new Error('source-missing'))
  const p = src.file
    .arrayBuffer()
    .then((buf) => openPdf(new Uint8Array(buf), { password: src.password }))
    .then((r) => r.doc)
  docs.set(id, p)
  p.catch(() => docs.delete(id))
  return p
}

export const getSource = (id: string | null | undefined) =>
  id ? usePdf.getState().sources.find((s) => s.id === id) : undefined

/** 讀取來源的原始位元組 */
export async function sourceBytes(src: PdfSource): Promise<Uint8Array> {
  return new Uint8Array(await src.file.arrayBuffer())
}

export const isPdfFile = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

/**
 * 加入 PDF：逐一開啟（需要密碼時詢問），讀出頁數與加密／表單資訊。
 * 回傳成功加入的 id。
 */
export async function addPdfFiles(
  files: File[],
  opts: { origin?: string } = {},
): Promise<string[]> {
  const added: string[] = []
  for (const file of files) {
    const id = uid('pdf')
    const base: PdfSource = {
      id,
      file,
      name: file.name,
      size: file.size,
      status: 'loading',
      pageCount: 0,
      sizes: [],
      encrypted: false,
      hasForm: false,
      hasXfa: false,
      hasSignatures: false,
      origin: opts.origin,
    }
    usePdf.setState((s) => ({
      sources: [...s.sources, base],
      activeId: s.activeId ?? id,
    }))
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { doc, password } = await openPdf(bytes, {
        ask: (reason) => askPassword(file.name, reason),
      }).finally(() => usePdf.setState({ password: null }))
      docs.set(id, Promise.resolve(doc))
      const flags = await docFlags(doc)
      const first = await doc.getPage(1)
      const vp = first.getViewport({ scale: 1 })
      const exists = usePdf.getState().sources.some((s) => s.id === id)
      if (!exists) {
        void destroyDoc(doc)
        docs.delete(id)
        continue
      }
      usePdf.getState().patch(id, {
        ...flags,
        status: 'ready',
        pageCount: doc.numPages,
        password,
        sizes: Array.from({ length: doc.numPages }, () => ({ w: vp.width, h: vp.height })),
      })
      added.push(id)
      useRecents.getState().visit('pdf', file.name)
      // 背景補齊每頁尺寸（混合尺寸的文件需要）
      if (doc.numPages > 1)
        pageSizes(doc)
          .then((sizes) => usePdf.getState().patch(id, { sizes }))
          .catch(() => {})
    } catch (e) {
      usePdf.getState().remove(id)
      if (e instanceof PasswordCanceledError) {
        toast(t('pdf.errors.passwordSkipped', { name: file.name }))
      } else {
        console.error(e)
        toast.error(t('pdf.errors.openFailed'), {
          description: t('pdf.errors.openFailedDesc', { name: file.name }),
        })
      }
    }
  }
  return added
}

/** 用新的檔案取代某個來源（例如「繼續編輯」結果） */
export async function replaceSource(id: string, file: File): Promise<string | null> {
  const st = usePdf.getState()
  const idx = st.sources.findIndex((s) => s.id === id)
  const [newId] = await addPdfFiles([file])
  if (!newId) return null
  const now = usePdf.getState()
  const added = now.sources.find((s) => s.id === newId)!
  const rest = now.sources.filter((s) => s.id !== newId && s.id !== id)
  if (idx >= 0) rest.splice(Math.min(idx, rest.length), 0, added)
  else rest.push(added)
  releaseDoc(id)
  usePdf.setState({ sources: rest, activeId: newId })
  return newId
}
