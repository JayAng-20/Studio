/**
 * 字幕：SRT → WebVTT 轉換、WebVTT 解析、cue 文字的安全切段（不使用 innerHTML）。
 * 全部是純函式，方便單元測試。
 */

export interface Cue {
  /** 秒 */
  start: number
  /** 秒 */
  end: number
  /** 原始文字（可能含 <i> 等簡單標籤），多行以 \n 分隔 */
  text: string
}

const BOM = new RegExp('^\\ufeff')

/** 統一換行並移除 BOM */
export function normalizeNewlines(s: string): string {
  return s.replace(BOM, '').replace(/\r\n?/g, '\n')
}

/**
 * 解析時間戳記為秒。可接受：
 * `00:01:02,345`（SRT）、`00:01:02.345`、`01:02.345`（VTT 省略小時）、`1:2:3,5`、`0:00:01`。
 */
export function parseTimestamp(raw: string): number | null {
  const s = raw.trim()
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s)
  if (!m) return null
  const h = m[1] ? Number(m[1]) : 0
  const min = Number(m[2])
  const sec = Number(m[3])
  if (min >= 60 || sec >= 60) return null
  // 小數部分：",5" 是 500 ms、",05" 是 50 ms
  const frac = m[4] ? Number(m[4].padEnd(3, '0')) / 1000 : 0
  return h * 3600 + min * 60 + sec + frac
}

/** 秒 → `HH:MM:SS.mmm`（WebVTT 標準格式） */
export function formatVttTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const ms = totalMs % 1000
  const total = Math.floor(totalMs / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`
}

const TIMING = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)(.*)$/

/** 移除 VTT 不支援的 SRT 標籤（<font>、{\an8} 之類的 ASS 覆寫碼） */
function cleanSrtText(line: string): string {
  return line
    .replace(/<\/?font[^>]*>/gi, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/-->/g, '→')
}

/**
 * SRT → WebVTT。
 * - 去除 BOM、統一 CRLF／CR 換行
 * - 去除編號行；逗號小數改成句點；時間補齊為 HH:MM:SS.mmm
 * - 保留多行文字與 <i><b><u>；移除 <font> 與 ASS 覆寫碼
 * - 沒有時間行或沒有文字的區塊略過
 */
export function srtToVtt(srt: string): string {
  const text = normalizeNewlines(srt).trim()
  const blocks = text.split(/\n[ \t]*\n+/)
  const out: string[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const ti = lines.findIndex((l) => l.includes('-->'))
    if (ti < 0) continue
    const m = TIMING.exec(lines[ti])
    if (!m) continue
    const start = parseTimestamp(m[1])
    const end = parseTimestamp(m[2])
    if (start === null || end === null) continue
    const body = lines
      .slice(ti + 1)
      .map((l) => cleanSrtText(l).trimEnd())
      .filter((l, i, arr) => l.trim() !== '' || (i > 0 && i < arr.length - 1))
    if (!body.length || body.every((l) => !l.trim())) continue
    out.push(`${formatVttTimestamp(start)} --> ${formatVttTimestamp(end)}\n${body.join('\n')}`)
  }
  return `WEBVTT\n\n${out.join('\n\n')}${out.length ? '\n' : ''}`
}

/** 解析 WebVTT（寬鬆）：略過 NOTE／STYLE／REGION 區塊，cue 依開始時間排序 */
export function parseVtt(vtt: string): Cue[] {
  const text = normalizeNewlines(vtt)
  const blocks = text.split(/\n[ \t]*\n+/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l, i) => i > 0 || l.trim() !== '')
    if (!lines.length) continue
    const first = lines[0].trim()
    if (/^WEBVTT/.test(first) && !lines.some((l) => l.includes('-->'))) continue
    if (/^(NOTE|STYLE|REGION)\b/.test(first)) continue
    const ti = lines.findIndex((l) => l.includes('-->'))
    if (ti < 0 || ti > 2) continue
    const m = TIMING.exec(lines[ti])
    if (!m) continue
    const start = parseTimestamp(m[1])
    const end = parseTimestamp(m[2])
    if (start === null || end === null || end < start) continue
    const body = lines.slice(ti + 1).join('\n').trim()
    if (!body) continue
    cues.push({ start, end, text: body })
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end)
}

/** 依副檔名或內容判斷格式並解析成 cue */
export function parseSubtitle(text: string, name = ''): Cue[] {
  const body = normalizeNewlines(text)
  const isVtt = /\.vtt$/i.test(name) || /^\s*WEBVTT/.test(body)
  return parseVtt(isVtt ? body : srtToVtt(body))
}

/**
 * 目前時間（加上延遲後）應顯示的 cue。delay 為正表示字幕延後出現。
 * cue 已排序：用二分搜尋找出開始時間 ≤ t 的最後一個，再往前找仍在顯示中的。
 */
export function activeCues(cues: Cue[], time: number, delay = 0): Cue[] {
  const t = time - delay
  let lo = 0
  let hi = cues.length - 1
  let last = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) {
      last = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  const out: Cue[] = []
  // 重疊的 cue 通常很少，往前最多看 20 個
  for (let i = last; i >= 0 && i > last - 20; i--) {
    if (cues[i].start <= t && t < cues[i].end) out.unshift(cues[i])
  }
  return out
}

export interface Segment {
  text: string
  italic?: boolean
  bold?: boolean
  underline?: boolean
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lrm: '‎',
  rlm: '‏',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k: string) => {
    if (k[0] === '#') {
      const code = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1))
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENTITIES[k.toLowerCase()] ?? m
  })
}

/**
 * cue 文字 → 行 × 片段（保留斜體、粗體、底線，其他標籤去除）。
 * 由 React 以文字節點渲染，不經過 innerHTML。
 */
export function cueToLines(text: string): Segment[][] {
  return text.split('\n').map((line) => {
    const segs: Segment[] = []
    const state = { italic: 0, bold: 0, underline: 0 }
    const re = /<\s*(\/?)\s*([a-z]+)[^>]*>/gi
    let lastIndex = 0
    let m: RegExpExecArray | null
    const push = (raw: string) => {
      if (!raw) return
      segs.push({
        text: decodeEntities(raw),
        italic: state.italic > 0 || undefined,
        bold: state.bold > 0 || undefined,
        underline: state.underline > 0 || undefined,
      })
    }
    while ((m = re.exec(line))) {
      push(line.slice(lastIndex, m.index))
      lastIndex = re.lastIndex
      const closing = m[1] === '/'
      const tag = m[2].toLowerCase()
      const key = tag === 'i' ? 'italic' : tag === 'b' ? 'bold' : tag === 'u' ? 'underline' : null
      if (key) state[key] = Math.max(0, state[key] + (closing ? -1 : 1))
    }
    push(line.slice(lastIndex))
    return segs
  })
}
