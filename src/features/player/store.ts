/**
 * 播放器狀態（模組層級 zustand store）：播放清單在切換頁面後仍保留，
 * 回來時可以接著播；媒體元素本身隨頁面掛載／卸載。
 */
import { create } from 'zustand'
import type { ABRange } from './logic/ab'
import type { Cue } from './logic/subtitles'
import type { TextEncodingName } from './logic/encoding'
import type { Diagnosis } from './logic/formats'
import type { RepeatMode } from './logic/playlist'
import { DEFAULT_FRAME } from './logic/speed'

export type ItemKind = 'video' | 'audio'

export interface SubtitleTrack {
  id: string
  name: string
  bytes: Uint8Array
  /** 自動偵測的編碼 */
  detected: TextEncodingName
  /** 使用中的編碼（使用者可改） */
  encoding: TextEncodingName
  cues: Cue[]
}

export interface Chapter {
  id: string
  t: number
  name: string
}

export interface ItemMeta {
  title?: string
  artist?: string
  album?: string
  coverUrl?: string
}

export interface PlayItem {
  id: string
  name: string
  kind: ItemKind
  source: 'file' | 'url'
  file?: File
  /** 物件 URL 或串流網址 */
  url: string
  /** 記住進度用的 key（fileKey 或 url:） */
  key: string
  hls: boolean
  size?: number
  type: string
  duration?: number
  width?: number
  height?: number
  error?: Diagnosis | null
  /** 影片載入後沒有畫面（多半是 HEVC） */
  noVideo?: boolean
  /** 副檔名看起來不支援 */
  suspect?: boolean
  meta?: ItemMeta
  subtitles: SubtitleTrack[]
  activeSub: string | null
  chapters: Chapter[]
  ab: ABRange
  /** 估計的單格時長（秒） */
  frameDur?: number
  /** 已在背景讀過長度 */
  probed?: boolean
}

export type PanelTab = 'playlist' | 'subtitles' | 'ab' | 'info' | 'audio'
export type SubBg = 'none' | 'shadow' | 'box'

export interface SubStyle {
  /** 相對大小 0.6–2 */
  size: number
  /** 距離底部（畫面高度 %）0–40 */
  position: number
  bg: SubBg
}

export const DEFAULT_SUB_STYLE: SubStyle = { size: 1, position: 6, bg: 'shadow' }
export const EQ_FLAT = [0, 0, 0, 0, 0]

export interface Snapshot {
  blob: Blob
  url: string
  time: number
  name: string
  n: number
}

export interface PlayerState {
  items: PlayItem[]
  currentId: string | null
  order: string[]
  shuffle: boolean
  repeat: RepeatMode
  autoNext: boolean

  el: HTMLVideoElement | null
  stageEl: HTMLDivElement | null
  paused: boolean
  time: number
  duration: number
  buffered: Array<[number, number]>
  rate: number
  /** 0–2（> 1 由 GainNode 放大） */
  volume: number
  muted: boolean
  waiting: boolean
  ready: boolean
  /** 回到頁面時要恢復的位置 */
  restore: { id: string; t: number; play: boolean } | null

  abLoop: boolean
  subsOn: boolean
  subDelay: number
  subStyle: SubStyle
  eqEnabled: boolean
  eqGains: number[]
  waveformOn: boolean
  visualizer: 'bars' | 'wave'
  peaks: Record<string, Float32Array | 'busy' | 'error' | 'large'>
  webAudio: boolean

  fullscreen: boolean
  pip: boolean
  controlsVisible: boolean
  /** 控制列上的選單開啟中（不自動隱藏） */
  menuOpen: boolean
  infoOverlay: boolean
  drawerOpen: boolean
  tab: PanelTab
  holding2x: boolean
  flash: { kind: 'play' | 'pause'; n: number } | null
  ripple: { side: 'left' | 'right'; amount: number; n: number } | null
  osd: { text: string; warn?: boolean; n: number } | null
  snapshot: Snapshot | null

  set: (patch: Partial<PlayerState>) => void
  updateItem: (id: string, patch: Partial<PlayItem> | ((it: PlayItem) => Partial<PlayItem>)) => void
}

export const usePlayer = create<PlayerState>((set) => ({
  items: [],
  currentId: null,
  order: [],
  shuffle: false,
  repeat: 'off',
  autoNext: true,

  el: null,
  stageEl: null,
  paused: true,
  time: 0,
  duration: 0,
  buffered: [],
  rate: 1,
  volume: 1,
  muted: false,
  waiting: false,
  ready: false,
  restore: null,

  abLoop: true,
  subsOn: true,
  subDelay: 0,
  subStyle: DEFAULT_SUB_STYLE,
  eqEnabled: false,
  eqGains: EQ_FLAT,
  waveformOn: true,
  visualizer: 'bars',
  peaks: {},
  webAudio: true,

  fullscreen: false,
  pip: false,
  controlsVisible: true,
  menuOpen: false,
  infoOverlay: false,
  drawerOpen: false,
  tab: 'playlist',
  holding2x: false,
  flash: null,
  ripple: null,
  osd: null,
  snapshot: null,

  set: (patch) => set(patch),
  updateItem: (id, patch) =>
    set((s) => ({
      items: s.items.map((it) =>
        it.id === id ? { ...it, ...(typeof patch === 'function' ? patch(it) : patch) } : it,
      ),
    })),
}))

export const selectCurrent = (s: PlayerState) =>
  s.currentId ? (s.items.find((i) => i.id === s.currentId) ?? null) : null

export const useCurrent = () => usePlayer(selectCurrent)

export const frameOf = (it: PlayItem | null) => it?.frameDur ?? DEFAULT_FRAME
