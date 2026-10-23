/**
 * 復原／重做堆疊（純函式）。
 * - 每一筆記錄「造成這個狀態的動作名稱」，用來顯示「復原：裁切」。
 * - coalesce：同一個 key 在短時間內連續變更（例如拖曳滑桿）合併成一步。
 * - 超過上限時丟掉最舊的記錄。
 */

export const HISTORY_LIMIT = 100
export const COALESCE_MS = 800

export interface HistoryEntry<T> {
  value: T
  label: string
}

export interface History<T> {
  past: HistoryEntry<T>[]
  present: T
  /** 造成 present 的動作 */
  presentLabel: string
  future: HistoryEntry<T>[]
  /** 最後一次變更的合併 key 與時間 */
  lastKey: string | null
  lastAt: number
}

export function createHistory<T>(value: T, label = ''): History<T> {
  return { past: [], present: value, presentLabel: label, future: [], lastKey: null, lastAt: 0 }
}

export interface PushOptions {
  label: string
  /** 相同 key 且在 COALESCE_MS 內的變更合併成一步 */
  coalesce?: string
  now?: number
  limit?: number
}

export function pushHistory<T>(h: History<T>, value: T, opts: PushOptions): History<T> {
  if (Object.is(value, h.present)) return h
  const now = opts.now ?? Date.now()
  const limit = opts.limit ?? HISTORY_LIMIT
  if (opts.coalesce && opts.coalesce === h.lastKey && now - h.lastAt <= COALESCE_MS) {
    // 合併：只替換 present，不新增步驟；但重做堆疊仍然失效
    return { ...h, present: value, presentLabel: opts.label, future: [], lastAt: now }
  }
  const past = [...h.past, { value: h.present, label: h.presentLabel }]
  if (past.length > limit) past.splice(0, past.length - limit)
  return {
    past,
    present: value,
    presentLabel: opts.label,
    future: [],
    lastKey: opts.coalesce ?? null,
    lastAt: now,
  }
}

/** 直接替換 present，不留下步驟（例如載入新圖片時補上預設狀態） */
export function replacePresent<T>(h: History<T>, value: T): History<T> {
  return { ...h, present: value }
}

/** 對所有快照套用同一個轉換（例如刪除圖片時，從每筆記錄移除它） */
export function mapHistory<T>(h: History<T>, fn: (v: T) => T): History<T> {
  return {
    ...h,
    past: h.past.map((e) => ({ ...e, value: fn(e.value) })),
    present: fn(h.present),
    future: h.future.map((e) => ({ ...e, value: fn(e.value) })),
  }
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0
export const canRedo = <T>(h: History<T>) => h.future.length > 0

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h
  const prev = h.past[h.past.length - 1]
  return {
    past: h.past.slice(0, -1),
    present: prev.value,
    presentLabel: prev.label,
    future: [{ value: h.present, label: h.presentLabel }, ...h.future],
    lastKey: null,
    lastAt: 0,
  }
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h
  const [next, ...rest] = h.future
  return {
    past: [...h.past, { value: h.present, label: h.presentLabel }],
    present: next.value,
    presentLabel: next.label,
    future: rest,
    lastKey: null,
    lastAt: 0,
  }
}

/** 「復原：xxx」要顯示的動作名稱 */
export const undoLabel = <T>(h: History<T>) => (h.past.length ? h.presentLabel : '')
/** 「重做：xxx」要顯示的動作名稱 */
export const redoLabel = <T>(h: History<T>) => h.future[0]?.label ?? ''
