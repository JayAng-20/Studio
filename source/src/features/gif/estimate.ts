/**
 * 檔案大小預估與超量建議（純函式）。
 * 預估方式：在 Worker 實際編碼幾格樣本，取得「第一格（完整畫面）」與「後續格（差異）」的平均位元組，
 * 再乘上影格數。
 */

export const FRAME_LIMIT = 200
export const BYTES_LIMIT = 50 * 1024 * 1024

export interface SampleStats {
  /** 完整畫面一格的平均大小（bytes） */
  fullAvg: number
  /** 後續影格（套用差異最佳化後）的平均大小；未最佳化時等於 fullAvg */
  deltaAvg: number
  /** 樣本編碼時的輸出寬高（用於換算其他尺寸） */
  width: number
  height: number
}

/** 容器的固定開銷：檔頭、調色盤、迴圈擴充等 */
export function headerBytes(format: 'gif' | 'apng' | 'webp', globalPalette: boolean): number {
  if (format === 'gif') return 13 + 19 + 1 + (globalPalette ? 768 : 0)
  if (format === 'apng') return 8 + 25 + 20 + 12
  return 12 + 18 + 14
}

/** 預估總大小 */
export function projectSize(
  frames: number,
  stats: Pick<SampleStats, 'fullAvg' | 'deltaAvg'>,
  header = 0,
): number {
  if (frames <= 0) return 0
  return Math.round(header + stats.fullAvg + (frames - 1) * stats.deltaAvg)
}

/** 換算到另一個輸出尺寸：位元組約略與像素數成正比 */
export function scaleStats(stats: SampleStats, width: number, height: number): SampleStats {
  const k = (width * height) / Math.max(1, stats.width * stats.height)
  return { fullAvg: stats.fullAvg * k, deltaAvg: stats.deltaAvg * k, width, height }
}

export type SuggestionKind = 'fps' | 'width' | 'range'

export interface Suggestion {
  kind: SuggestionKind
  /** fps：建議的 fps；width：建議的寬度；range：建議的區間長度（秒） */
  value: number
  frames: number
  bytes: number
}

export interface SuggestInput {
  frames: number
  bytes: number
  fps: number
  width: number
  height: number
  /** 目前區間長度（秒）；圖片模式為 null（不建議縮短區間） */
  rangeLength: number | null
  fpsOptions: readonly number[]
  widthOptions: readonly number[]
  pingpong: boolean
  stats: SampleStats | null
  header: number
}

/** 是否超過門檻 */
export function overLimit(frames: number, bytes: number) {
  return { frames: frames > FRAME_LIMIT, bytes: bytes > BYTES_LIMIT }
}

/**
 * 超過門檻時的具體建議：
 * - 降低 fps：找出能讓影格數與大小都在門檻內的最高 fps；找不到就給最低的那個
 * - 降低寬度：找出能讓大小在門檻內的最大寬度（只在大小超標時）
 * - 縮短區間：算出在目前 fps 下維持門檻內的最長區間
 */
export function suggestFixes(i: SuggestInput): Suggestion[] {
  const over = overLimit(i.frames, i.bytes)
  if (!over.frames && !over.bytes) return []
  const out: Suggestion[] = []
  const perFrame = i.frames > 0 ? i.bytes / i.frames : 0
  const ok = (f: number, b: number) => f <= FRAME_LIMIT && b <= BYTES_LIMIT

  // 降低 fps（影格數等比例下降）
  const lower = i.fpsOptions.filter((f) => f < i.fps).sort((a, b) => b - a)
  if (lower.length) {
    let pick = lower[lower.length - 1]
    for (const f of lower) {
      const frames = Math.max(1, Math.round((i.frames * f) / i.fps))
      if (ok(frames, frames * perFrame)) {
        pick = f
        break
      }
    }
    const frames = Math.max(1, Math.round((i.frames * pick) / i.fps))
    out.push({ kind: 'fps', value: pick, frames, bytes: Math.round(frames * perFrame) })
  }

  // 降低寬度（只影響大小）
  if (over.bytes) {
    const smaller = i.widthOptions.filter((w) => w < i.width).sort((a, b) => b - a)
    if (smaller.length) {
      let pick = smaller[smaller.length - 1]
      let bytes = i.bytes * (pick / i.width) ** 2
      for (const w of smaller) {
        const b = i.bytes * (w / i.width) ** 2
        if (b <= BYTES_LIMIT) {
          pick = w
          bytes = b
          break
        }
      }
      if (i.stats) {
        const h = Math.round((i.height * pick) / i.width)
        const s = scaleStats(i.stats, pick, h)
        bytes = projectSize(i.frames, s, i.header)
      }
      out.push({ kind: 'width', value: pick, frames: i.frames, bytes: Math.round(bytes) })
    }
  }

  // 縮短區間
  if (i.rangeLength !== null && i.rangeLength > 0) {
    const maxFramesByBytes = perFrame > 0 ? Math.floor(BYTES_LIMIT / perFrame) : Infinity
    const target = Math.min(FRAME_LIMIT, maxFramesByBytes)
    if (target >= 1 && target < i.frames) {
      const len = Math.max(0.1, Math.floor(((i.rangeLength * target) / i.frames) * 10) / 10)
      const frames = Math.max(1, Math.round((i.frames * len) / i.rangeLength))
      out.push({ kind: 'range', value: len, frames, bytes: Math.round(frames * perFrame) })
    }
  }
  return out
}
