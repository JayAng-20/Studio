/**
 * 匯出動作：建立匯出工作、快取結果、下載／ZIP／複製／傳送、批次處理。
 * 長時間作業一律走任務中心（runTask）。
 */
import { runTask, isAbortError } from '@/stores/tasks'
import { useSettings } from '@/stores/settings'
import { asFile } from '@/stores/fileBus'
import { outputName, splitExt } from '@/lib/filename'
import { copyBlob, downloadBlob } from '@/lib/download'
import { createZip } from '@/lib/zip'
import { formatBytes } from '@/lib/format'
import { canEncode } from '@/lib/image'
import { toast } from '@/components/ui'
import { t } from '@/i18n'
import { runPool, sharedEngine, type ExportEngine } from './engine'
import { EncodeError, GpsLeakError, type ExportJob, type ExportResult } from './lib/export'
import { CanvasMemoryError } from './lib/render'
import { effectiveMime, extOfMime, stateKey } from './lib/state'
import type { EditState } from './lib/types'
import { useTools, type Doc } from './store'
import { resetBatch, useBatch } from './batch'

/** 可編碼格式（啟動時偵測一次） */
let encodable: Set<string> = new Set(['image/jpeg', 'image/png'])
export async function detectEncoders(): Promise<Set<string>> {
  const list = ['image/webp', 'image/avif'] as const
  const ok = await Promise.all(list.map((m) => canEncode(m)))
  encodable = new Set(['image/jpeg', 'image/png', ...list.filter((_, i) => ok[i])])
  return encodable
}
export const getEncodable = () => encodable

export function buildJob(doc: Doc, state: EditState): ExportJob {
  return {
    key: doc.id,
    source: doc.source ?? doc.file,
    original: doc.file,
    container: doc.container,
    srcW: doc.srcW,
    srcH: doc.srcH,
    state,
    mime: effectiveMime(state.output.format, doc.container, encodable),
  }
}

/** 結果快取：同一張圖、同一組設定不重算（估算後下載可以直接沿用） */
const cache = new Map<string, ExportResult>()
const CACHE_MAX = 24
export const cacheKey = (doc: Doc, state: EditState) => `${doc.id}|${stateKey(state)}`
export const cachedResult = (doc: Doc, state: EditState) => cache.get(cacheKey(doc, state))

export async function exportDoc(
  doc: Doc,
  state: EditState,
  signal?: AbortSignal,
  engine: ExportEngine = sharedEngine(),
): Promise<ExportResult> {
  const key = cacheKey(doc, state)
  const hit = cache.get(key)
  if (hit) return hit
  const r = await engine.run(buildJob(doc, state), signal)
  cache.set(key, r)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return r
}

export function resultName(doc: Doc, r: ExportResult): string {
  const pattern = useSettings.getState().filenamePattern
  const ext = r.passthrough ? splitExt(doc.name).ext || extOfMime(r.mime) : extOfMime(r.mime)
  return outputName(doc.name, t('tools.fileAction'), ext, pattern, { w: r.width, h: r.height })
}

/** 把錯誤轉成「發生什麼事＋可以怎麼辦」 */
export function reportError(e: unknown) {
  if (isAbortError(e)) return
  console.error(e)
  if (e instanceof GpsLeakError || (e as Error)?.name === 'GpsLeakError')
    toast.error(t('tools.errors.gpsLeak'), { description: t('tools.errors.gpsLeakDesc') })
  else if (e instanceof EncodeError || (e as Error)?.name === 'EncodeError')
    toast.error(t('tools.errors.encode'), { description: t('tools.errors.encodeDesc') })
  else if (
    e instanceof CanvasMemoryError ||
    (e as Error)?.name === 'CanvasMemoryError' ||
    (e as Error)?.name === 'RangeError'
  )
    toast.error(t('tools.errors.memory'), { description: t('tools.errors.memoryDesc') })
  else toast.error(t('tools.errors.export'), { description: t('tools.errors.exportDesc') })
}

const readyDocs = () => useTools.getState().docs.filter((d) => d.status === 'ready')
const stateOf = (id: string) => useTools.getState().history.present[id]

function markExported(doc: Doc, state: EditState) {
  useTools.getState().patchDoc(doc.id, { exportedKey: stateKey(state) })
}

function noteMeta(r: ExportResult) {
  if (r.metaNote === 'too-large') toast.warning(t('tools.errors.metaTooLarge'))
}

/** 下載單張 */
export async function downloadDoc(doc: Doc) {
  const state = stateOf(doc.id)
  if (!state) return
  try {
    await runTask(
      'tools',
      t('tools.batch.taskExport', { name: doc.name }),
      async ({ signal, progress }) => {
        progress(null)
        const r = await exportDoc(doc, state, signal)
        const name = resultName(doc, r)
        downloadBlob(r.blob, name)
        noteMeta(r)
        markExported(doc, state)
        return [{ blob: r.blob, name }]
      },
    )
  } catch (e) {
    reportError(e)
  }
}

/** 複製到剪貼簿 */
export async function copyDoc(doc: Doc): Promise<boolean> {
  const state = stateOf(doc.id)
  if (!state) return false
  try {
    const r = await exportDoc(doc, state)
    return await copyBlob(r.blob)
  } catch (e) {
    reportError(e)
    return false
  }
}

/** 處理多張（平行），回傳每張的結果；onEach 回報進度 */
async function processDocs(
  docs: Doc[],
  signal: AbortSignal,
  progress: (p: number) => void,
): Promise<Array<{ doc: Doc; result: ExportResult; name: string }>> {
  const out: Array<{ doc: Doc; result: ExportResult; name: string }> = new Array(docs.length)
  let done = 0
  await runPool(
    docs,
    async (doc, engine, i) => {
      const state = stateOf(doc.id)
      if (!state) return
      const result = await exportDoc(doc, state, signal, engine)
      out[i] = { doc, result, name: resultName(doc, result) }
      done++
      progress(done / docs.length)
    },
    signal,
  )
  return out.filter(Boolean)
}

/**
 * 走任務中心，同時把進度同步到工作區的批次狀態列（可在工作區直接取消）。
 */
async function trackedTask<T extends Array<{ blob: Blob; name: string }> | void>(
  label: string,
  fn: (ctx: { signal: AbortSignal; progress: (p: number | null) => void }) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  useBatch.setState({
    status: 'running',
    label,
    progress: 0,
    summary: '',
    offerZip: false,
    controller,
  })
  try {
    return await runTask(
      'tools',
      label,
      ({ signal, progress }) =>
        fn({
          signal,
          progress: (p) => {
            progress(p)
            useBatch.setState({ progress: p })
          },
        }),
      { signal: controller.signal },
    )
  } catch (e) {
    resetBatch()
    throw e
  }
}

/** 全部打包成 ZIP 下載 */
export async function downloadAllZip() {
  const docs = readyDocs()
  if (!docs.length) return
  try {
    await trackedTask(
      t('tools.batch.taskZip', { count: docs.length }),
      async ({ signal, progress }) => {
        const items = await processDocs(docs, signal, (p) => progress(p * 0.9))
        const zip = await createZip(
          items.map((x) => ({ name: x.name, data: x.result.blob })),
          signal,
        )
        progress(1)
        const name = `${t('tools.batch.zipName')}.zip`
        downloadBlob(zip, name)
        items.forEach((x) => markExported(x.doc, stateOf(x.doc.id)))
        return [{ blob: zip, name }]
      },
    )
    resetBatch()
  } catch (e) {
    reportError(e)
  }
}

/** 傳送到其他模組：匯出全部（或目前）圖片成 File[] */
export async function filesForSend(onlyCurrent: Doc | null): Promise<File[]> {
  const docs = onlyCurrent ? [onlyCurrent] : readyDocs()
  let files: File[] = []
  try {
    await trackedTask(
      t('tools.batch.taskSend', { count: docs.length }),
      async ({ signal, progress }) => {
        const items = await processDocs(docs, signal, progress)
        files = items.map((x) => asFile(x.result.blob, x.name))
      },
    )
    resetBatch()
    return files
  } catch (e) {
    reportError(e)
    return []
  }
}

/**
 * 批次「套用到全部」之後：在任務中心處理全部圖片（結果可在任務中心下載），
 * 完成時顯示總大小變化，並提供「下載 ZIP」。
 */
export async function processAllAfterApply(label: string) {
  const docs = readyDocs()
  if (!docs.length) return
  try {
    const results = await trackedTask(label, async ({ signal, progress }) => {
      const items = await processDocs(docs, signal, progress)
      return items.map((x) => ({ blob: x.result.blob, name: x.name }))
    })
    const before = docs.reduce((n, d) => n + d.file.size, 0)
    const after = results.reduce((n, r) => n + r.blob.size, 0)
    useBatch.setState({
      status: 'done',
      progress: 1,
      label: t('tools.batch.done', { count: results.length }),
      summary: t('tools.batch.summary', { before: formatBytes(before), after: formatBytes(after) }),
      offerZip: results.length > 0,
      controller: null,
    })
  } catch (e) {
    reportError(e)
  }
}
