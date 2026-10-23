/** 位元組格式化：1536 → "1.5 KB" */
export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const fixed = v >= 100 ? v.toFixed(0) : v.toFixed(digits)
  return `${fixed.replace(/\.0+$/, '')} ${units[i]}`
}

/** 時間碼：秒 → "1:02:03" 或 "02:03"；withTenths 時加上 ".4" */
export function formatTime(
  seconds: number,
  opts: { tenths?: boolean; forceHours?: boolean } = {},
): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const totalTenths = Math.floor(seconds * 10 + 1e-6)
  const tenths = totalTenths % 10
  const total = Math.floor(totalTenths / 10)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  const base = h > 0 || opts.forceHours ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
  return opts.tenths ? `${base}.${tenths}` : base
}

/** 百分比變化：(after - before) / before */
export function percentChange(before: number, after: number): number {
  if (before <= 0) return 0
  return ((after - before) / before) * 100
}

export function formatPercent(v: number, digits = 0): string {
  return `${Math.abs(v).toFixed(digits)}%`
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
