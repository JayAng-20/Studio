/**
 * QR 內容組字：九種內容類型各自的表單值 → 標準格式字串。
 * 純函式，不依賴 DOM，供產生、批次與測試共用。
 */

export const CONTENT_TYPES = [
  'url',
  'text',
  'wifi',
  'vcard',
  'email',
  'tel',
  'sms',
  'geo',
  'event',
] as const

export type ContentType = (typeof CONTENT_TYPES)[number]

export type WifiSecurity = 'WPA' | 'WEP' | 'nopass'

export interface UrlValues {
  url: string
}
export interface TextValues {
  text: string
}
export interface WifiValues {
  ssid: string
  password: string
  security: WifiSecurity
  hidden: boolean
}
export interface VCardValues {
  firstName: string
  lastName: string
  org: string
  title: string
  mobile: string
  phone: string
  email: string
  website: string
  address: string
  note: string
}
export interface EmailValues {
  to: string
  subject: string
  body: string
}
export interface TelValues {
  phone: string
}
export interface SmsValues {
  phone: string
  message: string
}
export interface GeoValues {
  lat: string
  lng: string
}
export interface EventValues {
  title: string
  location: string
  /** 本地時間，格式 YYYY-MM-DDTHH:mm（datetime-local）或 YYYY-MM-DD（全天） */
  start: string
  end: string
  allDay: boolean
  description: string
}

export interface ContentValues {
  url: UrlValues
  text: TextValues
  wifi: WifiValues
  vcard: VCardValues
  email: EmailValues
  tel: TelValues
  sms: SmsValues
  geo: GeoValues
  event: EventValues
}

/** 兩位數補零 */
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Date → datetime-local 字串（本地時間） */
export function toLocalInput(d: Date, withTime = true): string {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date
}

/** 預設的活動時間：下一個整點起一小時 */
function defaultEventRange(now = new Date()) {
  const start = new Date(now)
  start.setMinutes(0, 0, 0)
  start.setHours(start.getHours() + 1)
  const end = new Date(start)
  end.setHours(end.getHours() + 1)
  return { start: toLocalInput(start), end: toLocalInput(end) }
}

export function defaultValues(): ContentValues {
  return {
    url: { url: '' },
    text: { text: '' },
    wifi: { ssid: '', password: '', security: 'WPA', hidden: false },
    vcard: {
      firstName: '',
      lastName: '',
      org: '',
      title: '',
      mobile: '',
      phone: '',
      email: '',
      website: '',
      address: '',
      note: '',
    },
    email: { to: '', subject: '', body: '' },
    tel: { phone: '' },
    sms: { phone: '', message: '' },
    geo: { lat: '', lng: '' },
    event: { title: '', location: '', ...defaultEventRange(), allDay: false, description: '' },
  }
}

// ───────────────────────── 跳脫 ─────────────────────────

/** Wi‑Fi（ZXing 格式）：\ ; , : " 前面加反斜線 */
export function escapeWifi(s: string): string {
  return s.replace(/([\\;,:"])/g, '\\$1')
}

/** vCard 3.0／iCalendar 文字值：\ ; , 與換行 */
export function escapeVText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

// ───────────────────────── 正規化 ─────────────────────────

/**
 * 網址正規化：去除前後空白；沒有協定時補 https://；協定轉小寫。
 * 「localhost:5173」這種主機加埠號不算協定。
 */
export function normalizeUrl(input: string): string {
  const s = input.trim()
  if (!s) return ''
  if (s.startsWith('//')) return `https:${s}`
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)
  // 主機:埠號（冒號後面接數字）不是協定
  if (scheme && !/^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(s)) {
    return scheme[1].toLowerCase() + s.slice(scheme[1].length)
  }
  return `https://${s}`
}

/** 網址是否可用（http／https 且有主機名稱） */
export function isValidUrl(input: string): boolean {
  const n = normalizeUrl(input)
  if (!n) return false
  try {
    const u = new URL(n)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true
    return !!u.hostname && (u.hostname.includes('.') || u.hostname === 'localhost')
  } catch {
    return false
  }
}

/** 電話正規化：只留數字、開頭的 +、* 與 #；全形數字轉半形 */
export function normalizePhone(input: string): string {
  const half = input.replace(/[０-９＋]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  const trimmed = half.trim()
  const plus = trimmed.startsWith('+') ? '+' : ''
  return plus + trimmed.replace(/[^0-9*#]/g, '')
}

/** 緯度、經度字串 → 數字；超出範圍或格式錯誤回傳 null */
export function parseCoord(value: string, kind: 'lat' | 'lng'): number | null {
  const s = value.trim()
  if (!s || !/^[-+]?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  const limit = kind === 'lat' ? 90 : 180
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null
}

/** 從「25.0330, 121.5654」這類貼上的文字拆出經緯度 */
export function splitLatLng(input: string): { lat: string; lng: string } | null {
  const m = /^\s*([-+]?\d+(?:\.\d+)?)\s*[,，\s]\s*([-+]?\d+(?:\.\d+)?)\s*$/.exec(input)
  if (!m) return null
  if (parseCoord(m[1], 'lat') === null || parseCoord(m[2], 'lng') === null) return null
  return { lat: m[1], lng: m[2] }
}

/** 去掉多餘的尾零（最多 6 位小數） */
const coordText = (n: number) => String(Number(n.toFixed(6)))

const CJK = /[぀-ヿ㐀-鿿가-힯]/

/** 顯示名稱：中日韓姓名不加空格且姓在前，其他用「名 姓」 */
export function displayName(first: string, last: string): string {
  const f = first.trim()
  const l = last.trim()
  if (CJK.test(f + l)) return `${l}${f}`
  return [f, l].filter(Boolean).join(' ')
}

// ───────────────────────── 組字 ─────────────────────────

export function buildWifi(v: WifiValues): string {
  const parts = [`T:${v.security}`, `S:${escapeWifi(v.ssid)}`]
  if (v.security !== 'nopass') parts.push(`P:${escapeWifi(v.password)}`)
  parts.push(`H:${v.hidden ? 'true' : 'false'}`)
  return `WIFI:${parts.join(';')};;`
}

const CRLF = '\r\n'

export function buildVCard(v: VCardValues): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0']
  const fn = displayName(v.firstName, v.lastName)
  lines.push(`N:${escapeVText(v.lastName.trim())};${escapeVText(v.firstName.trim())};;;`)
  lines.push(`FN:${escapeVText(fn || v.org.trim())}`)
  if (v.org.trim()) lines.push(`ORG:${escapeVText(v.org.trim())}`)
  if (v.title.trim()) lines.push(`TITLE:${escapeVText(v.title.trim())}`)
  if (v.mobile.trim()) lines.push(`TEL;TYPE=CELL:${normalizePhone(v.mobile)}`)
  if (v.phone.trim()) lines.push(`TEL;TYPE=WORK,VOICE:${normalizePhone(v.phone)}`)
  if (v.email.trim()) lines.push(`EMAIL;TYPE=INTERNET:${v.email.trim()}`)
  if (v.website.trim()) lines.push(`URL:${normalizeUrl(v.website)}`)
  if (v.address.trim()) lines.push(`ADR;TYPE=WORK:;;${escapeVText(v.address.trim())};;;;`)
  if (v.note.trim()) lines.push(`NOTE:${escapeVText(v.note.trim())}`)
  lines.push('END:VCARD')
  return lines.join(CRLF)
}

export function buildMailto(v: EmailValues): string {
  const to = v.to
    .split(/[,;，；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => encodeURI(s))
    .join(',')
  const q: string[] = []
  if (v.subject.trim()) q.push(`subject=${encodeURIComponent(v.subject.trim())}`)
  if (v.body.trim()) q.push(`body=${encodeURIComponent(v.body.replace(/\r?\n/g, '\r\n').trim())}`)
  return `mailto:${to}${q.length ? `?${q.join('&')}` : ''}`
}

export function buildTel(v: TelValues): string {
  return `tel:${normalizePhone(v.phone)}`
}

/** 簡訊用 ZXing 的 SMSTO 格式（Android 與 iOS 相機都認得） */
export function buildSms(v: SmsValues): string {
  const phone = normalizePhone(v.phone)
  const msg = v.message.trim()
  return msg ? `SMSTO:${phone}:${msg}` : `SMSTO:${phone}:`
}

export function buildGeo(v: GeoValues): string {
  const lat = parseCoord(v.lat, 'lat')
  const lng = parseCoord(v.lng, 'lng')
  if (lat === null || lng === null) return ''
  return `geo:${coordText(lat)},${coordText(lng)}`
}

/** 本地 datetime-local 字串 → Date；格式錯誤回傳 null */
export function parseLocalInput(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(s.trim())
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Date → iCalendar UTC 時間（20261002T010000Z） */
export function icsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

/** Date → iCalendar 日期（全天活動，本地日期） */
export function icsDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

/**
 * 行事曆活動（VEVENT）。時間一律轉成 UTC（結尾 Z），避免時區誤會；
 * 全天活動用 VALUE=DATE，結束日依規範為「隔天」（不含）。
 */
export function buildEvent(v: EventValues): string {
  const lines = ['BEGIN:VEVENT']
  lines.push(`SUMMARY:${escapeVText(v.title.trim())}`)
  const start = parseLocalInput(v.start)
  let end = parseLocalInput(v.end)
  if (start) {
    if (v.allDay) {
      const s = new Date(start.getFullYear(), start.getMonth(), start.getDate())
      const e0 = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()) : s
      const e = new Date(Math.max(e0.getTime(), s.getTime()))
      e.setDate(e.getDate() + 1)
      lines.push(`DTSTART;VALUE=DATE:${icsDate(s)}`)
      lines.push(`DTEND;VALUE=DATE:${icsDate(e)}`)
    } else {
      if (!end || end.getTime() < start.getTime()) end = new Date(start.getTime() + 3600_000)
      lines.push(`DTSTART:${icsUtc(start)}`)
      lines.push(`DTEND:${icsUtc(end)}`)
    }
  }
  if (v.location.trim()) lines.push(`LOCATION:${escapeVText(v.location.trim())}`)
  if (v.description.trim()) lines.push(`DESCRIPTION:${escapeVText(v.description.trim())}`)
  lines.push('END:VEVENT')
  return lines.join(CRLF)
}

/** 依內容類型組出最終字串；必要欄位未填時回傳空字串（預覽顯示提示） */
export function buildContent<T extends ContentType>(type: T, values: ContentValues[T]): string {
  switch (type) {
    case 'url': {
      const v = values as UrlValues
      return normalizeUrl(v.url)
    }
    case 'text':
      return (values as TextValues).text
    case 'wifi': {
      const v = values as WifiValues
      return v.ssid.trim() ? buildWifi(v) : ''
    }
    case 'vcard': {
      const v = values as VCardValues
      const any =
        v.firstName.trim() || v.lastName.trim() || v.org.trim() || v.mobile.trim() || v.email.trim()
      return any ? buildVCard(v) : ''
    }
    case 'email': {
      const v = values as EmailValues
      return v.to.trim() ? buildMailto(v) : ''
    }
    case 'tel': {
      const v = values as TelValues
      return normalizePhone(v.phone).replace('+', '') ? buildTel(v) : ''
    }
    case 'sms': {
      const v = values as SmsValues
      return normalizePhone(v.phone).replace('+', '') ? buildSms(v) : ''
    }
    case 'geo':
      return buildGeo(values as GeoValues)
    case 'event': {
      const v = values as EventValues
      return v.title.trim() && parseLocalInput(v.start) ? buildEvent(v) : ''
    }
    default:
      return ''
  }
}

/** 給檔名用的簡短描述（例如 Wi‑Fi 名稱、網域） */
export function contentSlug<T extends ContentType>(type: T, values: ContentValues[T]): string {
  const clip = (s: string) => s.trim().slice(0, 40)
  switch (type) {
    case 'url': {
      try {
        return new URL(normalizeUrl((values as UrlValues).url)).hostname.replace(/^www\./, '')
      } catch {
        return ''
      }
    }
    case 'text':
      return clip((values as TextValues).text.split(/\r?\n/)[0] ?? '')
    case 'wifi':
      return clip((values as WifiValues).ssid)
    case 'vcard': {
      const v = values as VCardValues
      return clip(displayName(v.firstName, v.lastName) || v.org)
    }
    case 'email':
      return clip((values as EmailValues).to.split(/[,;\s]/)[0] ?? '')
    case 'tel':
      return normalizePhone((values as TelValues).phone)
    case 'sms':
      return normalizePhone((values as SmsValues).phone)
    case 'geo': {
      const v = values as GeoValues
      return `${v.lat.trim()}_${v.lng.trim()}`
    }
    case 'event':
      return clip((values as EventValues).title)
    default:
      return ''
  }
}

/** QR Code 位元組容量上限（版本 40、位元組模式），依錯誤修正等級 */
export const BYTE_CAPACITY = { L: 2953, M: 2331, Q: 1663, H: 1273 } as const

export const utf8Length = (s: string) => new TextEncoder().encode(s).length
