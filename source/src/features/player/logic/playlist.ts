/** 播放清單邏輯：下一首／上一首、隨機順序、循環、移除與排序（純函式） */

export type RepeatMode = 'off' | 'all' | 'one'

export interface QueueState {
  /** 清單順序（使用者看到的順序） */
  ids: string[]
  /** 隨機播放順序（shuffle 開啟時使用） */
  order: string[]
  currentId: string | null
  shuffle: boolean
  repeat: RepeatMode
}

/** Fisher–Yates；目前曲目放在第一個，讓隨機順序從這首開始 */
export function makeShuffleOrder(
  ids: string[],
  currentId: string | null,
  rand: () => number = Math.random,
): string[] {
  const rest = ids.filter((id) => id !== currentId)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return currentId && ids.includes(currentId) ? [currentId, ...rest] : rest
}

/** 清單變動後同步隨機順序：移除不存在的、新加入的隨機插入目前曲目之後 */
export function syncOrder(
  order: string[],
  ids: string[],
  currentId: string | null,
  rand: () => number = Math.random,
): string[] {
  const set = new Set(ids)
  const kept = order.filter((id) => set.has(id))
  const keptSet = new Set(kept)
  const added = ids.filter((id) => !keptSet.has(id))
  const ci = currentId ? kept.indexOf(currentId) : -1
  const out = [...kept]
  for (const id of added) {
    const min = ci + 1
    const pos = min + Math.floor(rand() * (out.length - min + 1))
    out.splice(pos, 0, id)
  }
  return out
}

const sequence = (s: QueueState) => (s.shuffle ? s.order : s.ids)

/**
 * 下一首。reason = 'ended'（自動播完）時，單曲循環回傳同一首；
 * 使用者按「下一首」時，單曲循環視同全部循環（不會卡在同一首）。
 * 沒有下一首時回傳 null。
 */
export function nextId(s: QueueState, reason: 'ended' | 'user' = 'user'): string | null {
  const seq = sequence(s)
  if (!seq.length) return null
  if (reason === 'ended' && s.repeat === 'one') return s.currentId
  const i = s.currentId ? seq.indexOf(s.currentId) : -1
  if (i < 0) return seq[0]
  if (i + 1 < seq.length) return seq[i + 1]
  return s.repeat !== 'off' ? seq[0] : null
}

/** 上一首；在第一首且全部循環時回到最後一首 */
export function prevId(s: QueueState): string | null {
  const seq = sequence(s)
  if (!seq.length) return null
  const i = s.currentId ? seq.indexOf(s.currentId) : -1
  if (i < 0) return seq[0]
  if (i > 0) return seq[i - 1]
  return s.repeat !== 'off' ? seq[seq.length - 1] : null
}

/** 移除一首：若移除的是目前曲目，改選清單中的下一首（沒有就上一首） */
export function removeFromQueue(s: QueueState, id: string): QueueState {
  const idx = s.ids.indexOf(id)
  if (idx < 0) return s
  const ids = s.ids.filter((x) => x !== id)
  const order = s.order.filter((x) => x !== id)
  let currentId = s.currentId
  if (currentId === id) {
    const seq = s.shuffle ? s.order : s.ids
    const si = seq.indexOf(id)
    currentId = seq[si + 1] ?? seq[si - 1] ?? null
    if (currentId === id) currentId = null
  }
  return { ...s, ids, order, currentId }
}

/** 搬移：from → to（索引） */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list
  const out = list.slice()
  const [it] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it)
  return out
}

/** 依已儲存的檔名順序排列選到的檔案；回傳排列結果與找不到的檔名 */
export function orderByNames<T extends { name: string }>(
  files: T[],
  names: string[],
): { ordered: T[]; missing: string[]; extra: T[] } {
  const pool = files.slice()
  const ordered: T[] = []
  const missing: string[] = []
  for (const n of names) {
    const i = pool.findIndex((f) => f.name === n)
    if (i >= 0) ordered.push(pool.splice(i, 1)[0])
    else missing.push(n)
  }
  return { ordered, missing, extra: pool }
}
