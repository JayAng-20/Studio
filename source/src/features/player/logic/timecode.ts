/** 時間碼：解析使用者輸入、ffmpeg 參數、精確顯示 */

/**
 * 解析使用者輸入的時間：`75`、`75.5`、`1:15`、`01:15.5`、`1:02:03`、`1:02:03,250`。
 * 無法解析時回傳 null。
 */
export function parseTimecode(input: string): number | null {
  const s = input.trim().replace(',', '.')
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s)
  if (!m) return null
  const h = m[1] ? Number(m[1]) : 0
  const min = Number(m[2])
  const sec = Number(m[3])
  if (min >= 60 || sec >= 60) return null
  return h * 3600 + min * 60 + sec
}

/** ffmpeg 的時間參數（秒，三位小數） */
export function ffmpegTime(seconds: number): string {
  return Math.max(0, seconds).toFixed(3)
}

/** 精確時間（顯示到百分之一秒）：`01:02.35`、`1:01:02.35` */
export function formatPrecise(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const cs = Math.round(seconds * 100)
  const frac = cs % 100
  const total = Math.floor(cs / 100)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return `${h > 0 ? `${h}:${p(m)}` : p(m)}:${p(s)}.${p(frac)}`
}

/** 帶正負號的相對時間：+5、−10、+1:05 */
export function formatDelta(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+'
  const a = Math.abs(Math.round(seconds))
  if (a < 60) return `${sign}${a}`
  const m = Math.floor(a / 60)
  const s = a % 60
  return `${sign}${m}:${String(s).padStart(2, '0')}`
}

/** 檔名用的時間：`00-12-34` */
export function fileTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${p(h)}-${p(m)}-${p(s)}` : `${p(m)}-${p(s)}`
}
