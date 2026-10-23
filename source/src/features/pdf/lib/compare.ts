/**
 * 文件比較：文字以 Myers 差異演算法比對（中日韓逐字、其他語言逐詞），
 * 畫面以兩頁同寬渲染後逐像素比較，標出差異區域。
 */

export type DiffOp = { type: 'eq' | 'del' | 'ins'; text: string }

const TOKEN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]|[^\s\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]+|\s+/g

export function tokenize(s: string): string[] {
  return s.match(TOKEN) ?? []
}

/** Myers O(ND) 差異；回傳合併後的片段 */
export function diffTokens(a: string[], b: string[], maxD = 4000): DiffOp[] {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, maxD)
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = false
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
  }
  if (!found) {
    // 差異太大：整段視為刪除＋新增
    return merge([
      ...a.map((text) => ({ type: 'del' as const, text })),
      ...b.map((text) => ({ type: 'ins' as const, text })),
    ])
  }
  // 回溯
  const ops: DiffOp[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1
    const px = vv[off + prevK]
    const py = px - prevK
    while (x > px && y > py) {
      ops.push({ type: 'eq', text: a[--x] })
      y--
    }
    if (d > 0) {
      if (x === px) ops.push({ type: 'ins', text: b[--y] })
      else ops.push({ type: 'del', text: a[--x] })
    }
  }
  return merge(ops.reverse())
}

function merge(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = []
  for (const o of ops) {
    const last = out[out.length - 1]
    if (last && last.type === o.type) last.text += o.text
    else out.push({ ...o })
  }
  return out
}

export interface PageDiff {
  index: number
  ops: DiffOp[]
  inserted: number
  deleted: number
  /** 只有其中一份有這一頁 */
  missing?: 'a' | 'b'
}

export function diffPage(index: number, ta: string | null, tb: string | null): PageDiff {
  if (ta === null || tb === null) {
    const text = ta ?? tb ?? ''
    const count = tokenize(text).filter((x) => x.trim()).length
    return {
      index,
      ops: text ? [{ type: ta === null ? 'ins' : 'del', text }] : [],
      inserted: ta === null ? count : 0,
      deleted: tb === null ? count : 0,
      missing: ta === null ? 'a' : 'b',
    }
  }
  const ops = diffTokens(tokenize(ta), tokenize(tb))
  const count = (t: DiffOp['type']) =>
    ops.filter((o) => o.type === t).reduce((n, o) => n + tokenize(o.text).filter((x) => x.trim()).length, 0)
  return { index, ops, inserted: count('ins'), deleted: count('del') }
}

/** 兩張同尺寸影像的差異遮罩（RGBA，差異處為半透明紅色），回傳差異像素比例 */
export function pixelDiff(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  out: Uint8ClampedArray,
  threshold = 48,
): number {
  let changed = 0
  const px = Math.min(a.length, b.length) / 4
  for (let i = 0; i < px; i++) {
    const j = i * 4
    const d = Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) + Math.abs(a[j + 2] - b[j + 2])
    if (d > threshold) {
      out[j] = 239
      out[j + 1] = 68
      out[j + 2] = 68
      out[j + 3] = 150
      changed++
    } else out[j + 3] = 0
  }
  return changed / Math.max(1, px)
}
