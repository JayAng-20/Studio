/**
 * GIF 影格時間軸（純函式，無 DOM 依賴）。
 *
 * 名詞：
 * - 來源時間（source time）：影片中的秒數，決定要擷取哪一格。
 * - 輸出時間（output time）：在 GIF 裡播放到的秒數，用於文字疊加的顯示區間。
 * - 延遲（delay）：GIF 以 1/100 秒（centisecond, cs）為單位。
 */

export const FPS_OPTIONS = [5, 8, 10, 12, 15, 20, 24, 30] as const
export type Fps = (typeof FPS_OPTIONS)[number]

export const SPEED_MIN = 0.5
export const SPEED_MAX = 3

/** 瀏覽器會把小於 2 cs 的延遲當成 10 cs 播放，因此最小值固定為 2 cs */
export const MIN_DELAY_CS = 2

export interface TimelineOptions {
  /** 區間起點（秒） */
  start: number
  /** 區間終點（秒） */
  end: number
  /** 輸出每秒影格數 */
  fps: number
  /** 播放速度（0.5–3） */
  speed: number
  /** 倒放 */
  reverse: boolean
  /** 來回播放（正放後再倒放回來） */
  pingpong: boolean
}

export interface VideoFrame {
  /** 來源時間（秒） */
  t: number
  /** 這一格的延遲（cs） */
  delayCs: number
}

export interface ImageFrame {
  /** 圖片索引 */
  index: number
  delayCs: number
}

/**
 * 產生 count 個延遲（cs），以累積誤差修正讓總長度精確：
 * 例如 24 fps → 4、4、5、4、4、4…（平均 4.1667 cs）。
 */
export function frameDelays(count: number, framesPerSecond: number): number[] {
  if (count <= 0 || !(framesPerSecond > 0)) return []
  const step = 100 / framesPerSecond
  const out: number[] = []
  let prev = 0
  for (let i = 1; i <= count; i++) {
    const edge = Math.round(i * step)
    out.push(Math.max(MIN_DELAY_CS, edge - prev))
    prev = edge
  }
  return out
}

/**
 * 依區間、fps 與速度算出要擷取的來源時間（未套用倒放／來回）。
 * 速度 2 倍時，每輸出一格來源前進 2/fps 秒。
 */
export function sampleTimes(start: number, end: number, fps: number, speed: number): number[] {
  const s = Math.min(start, end)
  const e = Math.max(start, end)
  const dt = Math.max(speed, 1e-6) / Math.max(fps, 1e-6)
  const span = e - s
  // 至少一格；避免浮點誤差多算一格（例如 2 秒 ÷ 0.1 = 20.000000004）
  const n = Math.max(1, Math.ceil(span / dt - 1e-6))
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(roundTime(s + i * dt))
  return out
}

/** 套用倒放與來回：來回時不重複兩端點（0 1 2 3 2 1） */
export function applyOrder<T>(items: readonly T[], reverse: boolean, pingpong: boolean): T[] {
  const base = reverse ? [...items].reverse() : [...items]
  if (!pingpong || base.length < 3) return base
  const back = base.slice(1, -1).reverse()
  return [...base, ...back]
}

/** 影片模式的完整時間軸 */
export function buildVideoTimeline(o: TimelineOptions): VideoFrame[] {
  const times = applyOrder(sampleTimes(o.start, o.end, o.fps, o.speed), o.reverse, o.pingpong)
  const delays = frameDelays(times.length, o.fps)
  return times.map((t, i) => ({ t, delayCs: delays[i] }))
}

/** 圖片模式：每張圖停留 1/(fps × 速度) 秒 */
export function buildImageTimeline(
  count: number,
  fps: number,
  speed: number,
  reverse: boolean,
  pingpong: boolean,
): ImageFrame[] {
  if (count <= 0) return []
  const indices = applyOrder(
    Array.from({ length: count }, (_, i) => i),
    reverse,
    pingpong,
  )
  const delays = frameDelays(indices.length, fps * Math.max(speed, 1e-6))
  return indices.map((index, i) => ({ index, delayCs: delays[i] }))
}

/** 每格的輸出起始時間（秒） */
export function outputStartTimes(delaysCs: readonly number[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const d of delaysCs) {
    out.push(acc / 100)
    acc += d
  }
  return out
}

/** 總長度（秒） */
export function totalDuration(delaysCs: readonly number[]): number {
  return delaysCs.reduce((a, b) => a + b, 0) / 100
}

/** 只計數不建陣列：預估影格數用 */
export function countFrames(o: TimelineOptions): number {
  const span = Math.abs(o.end - o.start)
  const dt = Math.max(o.speed, 1e-6) / Math.max(o.fps, 1e-6)
  const n = Math.max(1, Math.ceil(span / dt - 1e-6))
  return o.pingpong && n >= 3 ? n * 2 - 2 : n
}

/**
 * 把手吸附：距離整數秒小於 threshold 時吸到整數秒。
 * 回傳 { value, snapped }，snapped 為吸附到的秒數（未吸附為 null）。
 */
export function snapToSecond(
  v: number,
  threshold: number,
): { value: number; snapped: number | null } {
  const r = Math.round(v)
  if (Math.abs(v - r) <= threshold) return { value: r, snapped: r }
  return { value: v, snapped: null }
}

/** 依影片長度決定吸附範圍：長影片用較大的範圍，但不超過 0.08 秒（避免鍵盤 0.1 秒微調被吸回） */
export function snapThreshold(duration: number): number {
  return Math.min(0.08, Math.max(0.03, duration * 0.004))
}

/** 把時間修正到 0.001 秒，避免 0.30000000000000004 之類的浮點尾數 */
export function roundTime(t: number): number {
  return Math.round(t * 1000) / 1000
}

/** 預設選取區間：有傳入區間就用它，否則從頭取最多 maxLen 秒 */
export function defaultRange(
  duration: number,
  incoming?: { start: number; end: number } | null,
  maxLen = 5,
): [number, number] {
  // 以 0.1 秒為格（與把手的微調步進一致）
  const d = Number.isFinite(duration) && duration > 0 ? Math.max(0.1, gridMax(duration)) : maxLen
  if (incoming && Number.isFinite(incoming.start) && Number.isFinite(incoming.end)) {
    const s = clampNum(Math.min(incoming.start, incoming.end), 0, d)
    const e = clampNum(Math.max(incoming.start, incoming.end), 0, d)
    if (e - s >= 0.1) return [roundTime(s), roundTime(e)]
  }
  return [0, roundTime(Math.min(d, maxLen))]
}

/** 影片長度向下取到 0.1 秒（區間把手的上限） */
export function gridMax(duration: number): number {
  return Math.max(0.1, Math.floor(duration * 10 + 1e-6) / 10)
}

function clampNum(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

/** GIF 的 NETSCAPE 迴圈欄位：0＝無限，-1＝只播一次（不寫迴圈擴充），N＝額外重播 N 次 */
export function repeatField(loop: 'infinite' | number): number {
  if (loop === 'infinite') return 0
  const plays = Math.max(1, Math.round(loop))
  return plays === 1 ? -1 : plays - 1
}
