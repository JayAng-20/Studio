/** A–B 區間邏輯（純函式） */

export interface ABRange {
  a: number | null
  b: number | null
}

/** 區間最短長度（秒） */
export const AB_MIN = 0.2

export const emptyAB: ABRange = { a: null, b: null }

export type ABWarning = 'bBeforeA' | 'tooShort' | null

const clampT = (t: number, duration: number) =>
  Math.max(0, Number.isFinite(duration) && duration > 0 ? Math.min(t, duration) : t)

/** 設定 A：若已有 B 且 A 不在 B 之前，清掉 B（使用者重新開始選區間） */
export function setA(ab: ABRange, t: number, duration: number): ABRange {
  const a = clampT(t, duration)
  if (ab.b !== null && a > ab.b - AB_MIN) return { a, b: null }
  return { ...ab, a }
}

/** 設定 B：沒有 A 時 A 視為 0；B 必須在 A 之後至少 AB_MIN 秒 */
export function setB(
  ab: ABRange,
  t: number,
  duration: number,
): { ab: ABRange; warning: ABWarning } {
  const b = clampT(t, duration)
  const a = ab.a ?? 0
  if (b <= a) return { ab, warning: 'bBeforeA' }
  if (b - a < AB_MIN) return { ab, warning: 'tooShort' }
  return { ab: { a, b }, warning: null }
}

/** 拖曳把手：A 不得超過 B − AB_MIN，B 不得小於 A + AB_MIN */
export function dragHandle(ab: ABRange, which: 'a' | 'b', t: number, duration: number): ABRange {
  const v = clampT(t, duration)
  if (which === 'a') {
    const max = ab.b !== null ? ab.b - AB_MIN : Infinity
    return { ...ab, a: Math.min(v, max) }
  }
  const min = (ab.a ?? 0) + AB_MIN
  return { ...ab, b: Math.max(v, min) }
}

export const isComplete = (ab: ABRange): ab is { a: number; b: number } =>
  ab.a !== null && ab.b !== null

export const abLength = (ab: ABRange) => (isComplete(ab) ? ab.b - ab.a : 0)

/**
 * 區間循環：播放到 B（或之後）時回到 A。回傳要跳到的時間，或 null。
 * 若使用者自己跳到區間外很遠的地方（> B + 1 秒），尊重使用者，不拉回。
 */
export function loopTarget(ab: ABRange, t: number, loop: boolean): number | null {
  if (!loop || !isComplete(ab)) return null
  if (t >= ab.b && t < ab.b + 1) return ab.a
  return null
}
