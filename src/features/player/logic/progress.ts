/** 記住播放進度：key = fileKey(file)，存在 localStorage（STORAGE_KEYS.progress） */
import { STORAGE_KEYS, readJSON, writeJSON } from '@/lib/storage'

export interface ProgressEntry {
  /** 秒 */
  t: number
  /** 總長（秒） */
  d: number
  /** 更新時間（ms） */
  at: number
}

export type ProgressMap = Record<string, ProgressEntry>

/** 最多記住幾個檔案 */
export const PROGRESS_MAX = 100
/** 開頭幾秒內不記 */
export const PROGRESS_HEAD = 5
/** 結尾幾秒內視為看完 */
export const PROGRESS_TAIL = 5
/** 太短的媒體不記 */
export const PROGRESS_MIN_DURATION = 20

export function isValidEntry(e: unknown): e is ProgressEntry {
  if (!e || typeof e !== 'object') return false
  const o = e as Record<string, unknown>
  return (
    typeof o.t === 'number' &&
    typeof o.d === 'number' &&
    typeof o.at === 'number' &&
    Number.isFinite(o.t) &&
    Number.isFinite(o.d)
  )
}

/**
 * 更新一筆進度（回傳新物件）：
 * - 開頭 PROGRESS_HEAD 秒內、或距結尾 PROGRESS_TAIL 秒內 → 移除該筆（看完或剛開始）
 * - 媒體短於 PROGRESS_MIN_DURATION → 不記
 * - 超過 PROGRESS_MAX 筆時移除最舊的
 */
export function updateProgress(
  map: ProgressMap,
  key: string,
  t: number,
  d: number,
  now: number,
  max = PROGRESS_MAX,
): ProgressMap {
  const next: ProgressMap = { ...map }
  if (
    !Number.isFinite(d) ||
    d < PROGRESS_MIN_DURATION ||
    t < PROGRESS_HEAD ||
    t > d - PROGRESS_TAIL
  ) {
    delete next[key]
    return next
  }
  next[key] = { t: Math.round(t * 10) / 10, d: Math.round(d * 10) / 10, at: now }
  const keys = Object.keys(next)
  if (keys.length > max) {
    keys
      .sort((x, y) => next[x].at - next[y].at)
      .slice(0, keys.length - max)
      .forEach((k) => delete next[k])
  }
  return next
}

/** 可以從哪裡繼續（秒），沒有紀錄或不適合繼續時回傳 null */
export function resumePoint(map: ProgressMap, key: string, duration?: number): number | null {
  const e = map[key]
  if (!isValidEntry(e)) return null
  const d = duration && Number.isFinite(duration) ? duration : e.d
  if (e.t < PROGRESS_HEAD || e.t > d - PROGRESS_TAIL) return null
  return e.t
}

export function loadProgress(): ProgressMap {
  const raw = readJSON<unknown>(STORAGE_KEYS.progress, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ProgressMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidEntry(v)) out[k] = v
  }
  return out
}

export function saveProgressEntry(key: string, t: number, d: number) {
  writeJSON(STORAGE_KEYS.progress, updateProgress(loadProgress(), key, t, d, Date.now()))
}
