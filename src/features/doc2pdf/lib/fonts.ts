/**
 * 中文字型（思源黑體 400／700）：打包進站，只在真的要轉檔時才下載（各約 7 MB）。
 * 用 fetch 的 ReadableStream 計算下載進度；下載後存進 Cache Storage，之後直接讀取。
 */
import regularUrl from '@expo-google-fonts/noto-sans-tc/400Regular/NotoSansTC_400Regular.ttf?url'
import boldUrl from '@expo-google-fonts/noto-sans-tc/700Bold/NotoSansTC_700Bold.ttf?url'

const CACHE = 'jayang-doc2pdf-fonts-v1'
/** 未取得 Content-Length 時的估計大小 */
const APPROX = { regular: 7_109_460, bold: 7_200_000 }
export const FONT_TOTAL_BYTES = APPROX.regular + APPROX.bold

export interface FontBytes {
  regular: Uint8Array
  bold: Uint8Array
}

let memory: FontBytes | null = null
let inflight: Promise<FontBytes> | null = null

export class FontLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FontLoadError'
  }
}

const hasCaches = () => typeof caches !== 'undefined'

/** 字型是否已經在本機（記憶體或 Cache Storage） */
export async function fontsCached(): Promise<boolean> {
  if (memory) return true
  if (!hasCaches()) return false
  try {
    const c = await caches.open(CACHE)
    return !!(await c.match(regularUrl)) && !!(await c.match(boldUrl))
  } catch {
    return false
  }
}

async function fetchOne(
  url: string,
  approx: number,
  onBytes: (n: number) => void,
  signal: AbortSignal,
): Promise<Uint8Array> {
  // 先找快取
  if (hasCaches()) {
    try {
      const c = await caches.open(CACHE)
      const hit = await c.match(url)
      if (hit) {
        const buf = new Uint8Array(await hit.arrayBuffer())
        onBytes(buf.length)
        return buf
      }
    } catch (e) {
      console.error(e)
    }
  }
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new FontLoadError(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || approx
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    onBytes(Math.min(got, total))
  }
  const out = new Uint8Array(got)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  // 基本檢查：TrueType 檔頭
  if (!(out[0] === 0 && out[1] === 1 && out[2] === 0 && out[3] === 0))
    throw new FontLoadError('invalid font')
  if (hasCaches()) {
    try {
      const c = await caches.open(CACHE)
      await c.put(url, new Response(out.slice(), { headers: { 'content-type': 'font/ttf' } }))
    } catch (e) {
      // 快取空間不足等：不影響這次轉檔
      console.error(e)
    }
  }
  return out
}

/**
 * 取得字型；onProgress(已下載位元組, 總位元組)。已快取時立即完成。
 * 同時多次呼叫會共用同一次下載。
 */
export function loadFonts(
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<FontBytes> {
  if (memory) {
    onProgress(1, 1)
    return Promise.resolve(memory)
  }
  if (!inflight) {
    const ctrl = new AbortController()
    let a = 0
    let b = 0
    const listeners = new Set<(l: number, t: number) => void>()
    const report = () => listeners.forEach((fn) => fn(a + b, FONT_TOTAL_BYTES))
    const p = Promise.all([
      fetchOne(regularUrl, APPROX.regular, (n) => ((a = n), report()), ctrl.signal),
      fetchOne(boldUrl, APPROX.bold, (n) => ((b = n), report()), ctrl.signal),
    ])
      .then(([regular, bold]) => {
        memory = { regular, bold }
        return memory
      })
      .finally(() => {
        inflight = null
      })
    const shared = Object.assign(p, { listeners, ctrl, users: 0 })
    inflight = shared
  }
  const shared = inflight as Promise<FontBytes> & {
    listeners: Set<(l: number, t: number) => void>
    ctrl: AbortController
    users: number
  }
  shared.users++
  shared.listeners.add(onProgress)
  return new Promise<FontBytes>((resolve, reject) => {
    const onAbort = () => {
      shared.listeners.delete(onProgress)
      shared.users--
      // 沒有人在等了就停止下載
      if (shared.users <= 0) shared.ctrl.abort()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    shared.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        shared.listeners.delete(onProgress)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        shared.listeners.delete(onProgress)
        reject(e)
      },
    )
  })
}
