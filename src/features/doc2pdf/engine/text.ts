/** 字元分類：中日韓判斷、避頭尾標點、東亞字寬、HTML 實體解碼 */

/** 可逐字斷行的中日韓文字與全形符號 */
export function isCJK(cp: number): boolean {
  return (
    (cp >= 0x2e80 && cp <= 0x2fdf) || // 部首
    (cp >= 0x3000 && cp <= 0x303f) || // 中日韓符號與標點
    (cp >= 0x3040 && cp <= 0x30ff) || // 平假名、片假名
    (cp >= 0x3100 && cp <= 0x312f) || // 注音
    (cp >= 0x3130 && cp <= 0x318f) || // 韓文相容字母
    (cp >= 0x31a0 && cp <= 0x31ff) ||
    (cp >= 0x3200 && cp <= 0x33ff) || // 圈字、相容字
    (cp >= 0x3400 && cp <= 0x4dbf) || // 擴充 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // 基本漢字
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7af) || // 韓文音節
    (cp >= 0xf900 && cp <= 0xfaff) || // 相容漢字
    (cp >= 0xfe10 && cp <= 0xfe1f) || // 直排形式
    (cp >= 0xfe30 && cp <= 0xfe4f) || // 相容形式
    (cp >= 0xff00 && cp <= 0xff60) || // 全形 ASCII 與標點
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3134f) // 擴充 B 以後
  )
}

/** 是否含有中日韓文字 */
export const hasCJK = (s: string) => /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/.test(s)

/** 東亞字寬：在等寬排版中佔兩格的字 */
export function isWide(cp: number): boolean {
  return (
    isCJK(cp) ||
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2329 && cp <= 0x232a) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff)
  )
}

/** 字串的等寬顯示寬度（中日韓字算 2 格；Tab 以 tabSize 對齊） */
export function displayWidth(s: string, tabSize = 8): number {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (ch === '\t') w += tabSize - (w % tabSize)
    else w += isWide(cp) ? 2 : 1
  }
  return w
}

/** 不可出現在行首的字（避頭）：句讀、收尾括號、長音、小假名 */
export const NO_LINE_START = new Set(
  Array.from(
    '，。、；：？！）」』》〉】〕〗〙〛｝］〞〟’”…‥・ー―ゝゞヽヾ々〻ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ％‰℃°′″．｡｣､･' +
      ',.;:!?)]}%',
  ),
)

/** 不可出現在行尾的字（避尾）：開頭括號、引號、貨幣符號 */
export const NO_LINE_END = new Set(Array.from('（「『《〈【〔〖〘〚｛［〝‘“([{$£¥€＄￥'))

/** 句末標點（用來判斷「這行是不是一句話的結尾」） */
export const SENTENCE_END = /[。．.！!？?；;…」』”"）)]$/

/** 拉丁文字中可斷行的空白 */
export const isSpace = (ch: string) => ch === ' ' || ch === '\u00a0' || ch === '\t' || ch === '\u3000'

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  deg: '°',
  times: '×',
  divide: '÷',
  plusmn: '±',
  para: '¶',
  sect: '§',
  euro: '€',
  yen: '¥',
  pound: '£',
  cent: '¢',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwj: '\u200d',
  zwnj: '\u200c',
  shy: '',
}

/** 解碼 HTML 實體（具名常用表＋十進位／十六進位） */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return m
      return String.fromCodePoint(cp)
    }
    const v = NAMED[body.toLowerCase()]
    return v === undefined ? m : v
  })
}

/** 去除 HTML 標籤（保留換行語意：<br>、</p>、</div>、</li> 轉成換行） */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|table|ul|ol)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
