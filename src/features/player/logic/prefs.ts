/**
 * 播放器偏好（STORAGE_KEYS.playerPrefs）：音量、循環模式、字幕樣式、等化器、頻譜樣式等。
 * 讀取時逐欄驗證型別與範圍，壞資料或缺欄位一律退回預設值。
 */
import { STORAGE_KEYS, readJSON, writeJSON } from '@/lib/storage'
import type { RepeatMode } from './playlist'

export type SubBg = 'none' | 'shadow' | 'box'

export interface SubStyle {
  /** 相對大小 0.6–2 */
  size: number
  /** 距離底部（畫面高度 %）0–40 */
  position: number
  bg: SubBg
}

export interface PlayerPrefs {
  /** 0–1；超過 100% 的增強音量不會被恢復，避免下次開檔突然很大聲 */
  volume: number
  repeat: RepeatMode
  shuffle: boolean
  autoNext: boolean
  abLoop: boolean
  subsOn: boolean
  subStyle: SubStyle
  eqEnabled: boolean
  /** 5 段，−12 到 +12 dB */
  eqGains: number[]
  visualizer: 'bars' | 'wave'
  waveformOn: boolean
}

export const SUB_SIZE = { min: 0.6, max: 2 } as const
export const SUB_POSITION = { min: 0, max: 40 } as const
export const EQ_RANGE = { min: -12, max: 12, bands: 5 } as const

export const DEFAULT_SUB_STYLE: SubStyle = { size: 1, position: 6, bg: 'shadow' }
export const EQ_FLAT = [0, 0, 0, 0, 0]

export const DEFAULT_PREFS: PlayerPrefs = {
  volume: 1,
  repeat: 'off',
  shuffle: false,
  autoNext: true,
  abLoop: true,
  subsOn: true,
  subStyle: DEFAULT_SUB_STYLE,
  eqEnabled: false,
  eqGains: EQ_FLAT,
  visualizer: 'bars',
  waveformOn: true,
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)

const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback

/** 驗證並補齊偏好；任何不合法的欄位退回預設 */
export function sanitizePrefs(raw: unknown): PlayerPrefs {
  const d = DEFAULT_PREFS
  if (!isObj(raw)) return { ...d, subStyle: { ...d.subStyle }, eqGains: [...d.eqGains] }
  const sub = isObj(raw.subStyle) ? raw.subStyle : {}
  const gains =
    Array.isArray(raw.eqGains) &&
    raw.eqGains.length === EQ_RANGE.bands &&
    raw.eqGains.every((g) => typeof g === 'number' && Number.isFinite(g))
      ? (raw.eqGains as number[]).map((g) => Math.round(num(g, EQ_RANGE.min, EQ_RANGE.max, 0)))
      : [...d.eqGains]
  return {
    volume: num(raw.volume, 0, 1, d.volume),
    repeat: oneOf(raw.repeat, ['off', 'all', 'one'] as const, d.repeat),
    shuffle: bool(raw.shuffle, d.shuffle),
    autoNext: bool(raw.autoNext, d.autoNext),
    abLoop: bool(raw.abLoop, d.abLoop),
    subsOn: bool(raw.subsOn, d.subsOn),
    subStyle: {
      size: num(sub.size, SUB_SIZE.min, SUB_SIZE.max, d.subStyle.size),
      position: num(sub.position, SUB_POSITION.min, SUB_POSITION.max, d.subStyle.position),
      bg: oneOf(sub.bg, ['none', 'shadow', 'box'] as const, d.subStyle.bg),
    },
    eqEnabled: bool(raw.eqEnabled, d.eqEnabled),
    eqGains: gains,
    visualizer: oneOf(raw.visualizer, ['bars', 'wave'] as const, d.visualizer),
    waveformOn: bool(raw.waveformOn, d.waveformOn),
  }
}

/** 從狀態取出要儲存的欄位 */
export function pickPrefs(s: PlayerPrefs): PlayerPrefs {
  return sanitizePrefs({
    volume: s.volume,
    repeat: s.repeat,
    shuffle: s.shuffle,
    autoNext: s.autoNext,
    abLoop: s.abLoop,
    subsOn: s.subsOn,
    subStyle: s.subStyle,
    eqEnabled: s.eqEnabled,
    eqGains: s.eqGains,
    visualizer: s.visualizer,
    waveformOn: s.waveformOn,
  })
}

export const PREF_KEYS = Object.keys(DEFAULT_PREFS) as Array<keyof PlayerPrefs>

export function loadPrefs(): PlayerPrefs {
  return sanitizePrefs(readJSON<unknown>(STORAGE_KEYS.playerPrefs, null))
}

export function savePrefs(p: PlayerPrefs) {
  writeJSON(STORAGE_KEYS.playerPrefs, pickPrefs(p))
}
