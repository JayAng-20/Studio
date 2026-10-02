/**
 * 文字編碼偵測：BOM（UTF‑8／UTF‑16LE／BE）→ UTF‑8 嚴格解碼 → Big5 → GB18030。
 * Big5 與 GB18030 的位元組範圍高度重疊（兩者常常都能「成功」解碼），
 * 所以兩者都成功時，用常用字比例判斷哪一個比較像正常文字。
 */

export type TextEncodingId =
  'utf-8' | 'utf-16le' | 'utf-16be' | 'big5' | 'gb18030' | 'shift_jis' | 'windows-1252'

export const ENCODINGS: TextEncodingId[] = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'big5',
  'gb18030',
  'shift_jis',
  'windows-1252',
]

export const ENCODING_LABEL: Record<TextEncodingId, string> = {
  'utf-8': 'UTF‑8',
  'utf-16le': 'UTF‑16 LE',
  'utf-16be': 'UTF‑16 BE',
  big5: 'Big5',
  gb18030: 'GB18030',
  shift_jis: 'Shift_JIS',
  'windows-1252': 'Windows‑1252',
}

export interface DecodeResult {
  text: string
  encoding: TextEncodingId
  /** 是否有 BOM */
  bom: boolean
  /** 解碼時遇到無效位元組（用了替代字元） */
  lossy: boolean
}

// 繁體與簡體最常用的字（各約 300 字）：誤用編碼解出的多半是罕用字
const COMMON =
  '的一是不了人我在有他這个個們中來上大為和國地到以說時要就出會可也你對生能而子那得於著下自之年過發後作裡用道行所然家種事成方多經麼去法學如都同現當沒動面起看定天分還進好小部其些主樣理心她本前開但因只從想實日軍者意無力它與長把機十民第公此已工使情明性知全三又關點正業外將兩高間由問很最重並物手應戰向頭文體政美相見被利什二等產或新己制身果加西斯月話合回特代內信表化老給世位次度門任常先海通教兒原東聲提立及比員解水名真論處走義各入幾口認條平系氣題活爾更別打女變四神總何電數安少報才結反受目太量再感建務做接必場件計管期市直德資命山金指克許統區保至隊形社便空決治展馬科司五基眼書非則聽白卻界達光放強即像難且權思王象完設式色路記南品住告類求據程北邊死張該交規萬取拉格望覺術領共確傳師觀清今切院讓識候帶導爭運笑飛風步改收根造言聯持組每濟車親極林服快辦議往元英士證近失轉夫令準布始怎呢存未遠叫台單影具羅字愛擊流備兵連調深商算質團集百需價花黨華城石級整府離況請技際約示復病息究線似官火斷精滿支視消越器容照須九增研寫稱企八功嗎包片史委乎查輕易早曾除農找裝廣顯吧阿李標談吃圖念六引歷首醫局突專費號盡另周較注語僅考落青隨選列武紅響雖推勢參希古眾構房半節土投某案黑維革劃敵致陳律足態護七興派孩驗責營星夠章音跟志底站嚴巴例防族供效續施留講型料終答緊黃絕奇察母京段依批群項故按河米圍江織害雙境客紀舉殺攻父蘇密低朝友訴止細願千值仍男錢破網熱助倒育屬坐帝限船臉職速刻樂否剛威毛狀率甚獨球般普怕彈校苦創假久錯承印晚蘭試股拿腦預誰益陽若哪微尼繼送急血驚藥適波夜省初喜衛源食險待述陸習置居勞財環排福納歡' +
  '这个们来为国说时会对于着过发后里么种经学现没动还进样实军无与长机关点业将两间问应战头体产新制话见被产员义各几认条气题变总电数报结务样计场资话图权觉术领观师识带争笑飞风转亲极车联证远叫单爱击团质专号尽周较语仅历医选红响虽势参众构划敌态护兴验责营阶际约顺复处视须线断满视听记书则边张该规万观传达领导统区党华县级广显标谈数据开门东乐兰补别让钱网热护强难协卫码处设诉买卖读请调试误认为终给结组织'
const COMMON_SET = new Set(Array.from(COMMON))

/** 中日韓字元中「常用字」的比例（0 到 1）；沒有中文字時回傳 1 */
export function commonHanRatio(text: string): number {
  let han = 0
  let common = 0
  const sample = text.length > 200_000 ? text.slice(0, 200_000) : text
  for (const ch of sample) {
    const cp = ch.codePointAt(0)!
    if (cp >= 0x3400 && cp <= 0x9fff) {
      han++
      if (COMMON_SET.has(ch)) common++
    }
  }
  return han === 0 ? 1 : common / han
}

function tryDecode(bytes: Uint8Array, enc: TextEncodingId, fatal: boolean): string | null {
  try {
    return new TextDecoder(enc, { fatal, ignoreBOM: false }).decode(bytes)
  } catch {
    return null
  }
}

/** 以指定編碼解碼（無效位元組以替代字元顯示） */
export function decodeWith(bytes: Uint8Array, enc: TextEncodingId): DecodeResult {
  const bom = detectBom(bytes)
  const strict = tryDecode(bytes, enc, true)
  const text = strict ?? tryDecode(bytes, enc, false) ?? ''
  return { text: stripBom(text), encoding: enc, bom: bom === enc, lossy: strict === null }
}

function detectBom(b: Uint8Array): TextEncodingId | null {
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return 'utf-8'
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return 'utf-16le'
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return 'utf-16be'
  return null
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

/** 沒有 BOM 的 UTF‑16：偶數／奇數位置大量 0x00 */
function sniffUtf16(b: Uint8Array): TextEncodingId | null {
  const n = Math.min(b.length, 4096) & ~1
  if (n < 8) return null
  let evenZero = 0
  let oddZero = 0
  for (let i = 0; i < n; i += 2) {
    if (b[i] === 0) evenZero++
    if (b[i + 1] === 0) oddZero++
  }
  const half = n / 2
  if (oddZero > half * 0.4 && evenZero < half * 0.05) return 'utf-16le'
  if (evenZero > half * 0.4 && oddZero < half * 0.05) return 'utf-16be'
  return null
}

/** 自動偵測編碼並解碼 */
export function detectAndDecode(bytes: Uint8Array): DecodeResult {
  const bom = detectBom(bytes)
  if (bom) return decodeWith(bytes, bom)
  const u16 = sniffUtf16(bytes)
  if (u16) return decodeWith(bytes, u16)
  const utf8 = tryDecode(bytes, 'utf-8', true)
  if (utf8 !== null) return { text: stripBom(utf8), encoding: 'utf-8', bom: false, lossy: false }
  const big5 = tryDecode(bytes, 'big5', true)
  const gb = tryDecode(bytes, 'gb18030', true)
  if (big5 !== null && gb !== null) {
    // 兩者都能解：比常用字比例（GB 編碼的檔案被當成 Big5 解，會出現大量罕用字，反之亦然）
    return commonHanRatio(gb) > commonHanRatio(big5) + 0.05
      ? { text: gb, encoding: 'gb18030', bom: false, lossy: false }
      : { text: big5, encoding: 'big5', bom: false, lossy: false }
  }
  if (big5 !== null) return { text: big5, encoding: 'big5', bom: false, lossy: false }
  if (gb !== null) return { text: gb, encoding: 'gb18030', bom: false, lossy: false }
  // 都失敗：退回 UTF‑8（替代字元），讓使用者手動切換
  return { ...decodeWith(bytes, 'utf-8'), lossy: true }
}
