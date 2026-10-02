/**
 * 掃描結果解析：把 QR 內容字串辨識成類型與欄位，供結果卡顯示。
 * 純函式；支援 ZXing 常見格式（WIFI、MECARD、MATMSG、SMSTO）與 URI（mailto、tel、sms、geo）。
 */

export interface UrlResult {
  kind: 'url'
  raw: string
  href: string
  protocol: string
  hostname: string
  /** 網域含 punycode（xn--）：可能是用相似字元假冒的網域 */
  punycode: boolean
  /** 網址含帳號資訊（https://a.com@b.com），真正的網域是 @ 之後 */
  userinfo: boolean
  /** 主機是 IP 位址 */
  ip: boolean
  /** 非 http／https 協定 */
  unsafeScheme: boolean
}
export interface WifiResult {
  kind: 'wifi'
  raw: string
  ssid: string
  password: string
  security: string
  hidden: boolean
}
export interface ContactResult {
  kind: 'contact'
  raw: string
  format: 'vcard' | 'mecard'
  name: string
  org: string
  title: string
  phones: string[]
  emails: string[]
  urls: string[]
  address: string
  note: string
}
export interface EmailResult {
  kind: 'email'
  raw: string
  to: string
  subject: string
  body: string
}
export interface TelResult {
  kind: 'tel'
  raw: string
  phone: string
}
export interface SmsResult {
  kind: 'sms'
  raw: string
  phone: string
  message: string
}
export interface GeoResult {
  kind: 'geo'
  raw: string
  lat: number
  lng: number
  query: string
}
export interface EventResult {
  kind: 'event'
  raw: string
  title: string
  location: string
  description: string
  start: Date | null
  end: Date | null
  allDay: boolean
}
export interface TextResult {
  kind: 'text'
  raw: string
}

export type ScanResult =
  | UrlResult
  | WifiResult
  | ContactResult
  | EmailResult
  | TelResult
  | SmsResult
  | GeoResult
  | EventResult
  | TextResult

export type ScanKind = ScanResult['kind']

/** URI 路徑部分解碼（+ 保留原樣，電話號碼會用到） */
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * 依 ZXing 規則切開「KEY:value;KEY:value;;」：反斜線跳脫的分隔符不切。
 */
export function splitEscaped(s: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      cur += c + s[i + 1]
      i++
    } else if (c === sep) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** 移除反斜線跳脫 */
export const unescapeBackslash = (s: string) => s.replace(/\\(.)/g, '$1')

/** vCard／iCalendar 文字值反跳脫（\n 轉換行） */
export const unescapeVText = (s: string) =>
  s.replace(/\\([nN\\;,:])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c))

/** 「KEY:value;KEY:value」→ 物件（同名鍵收集成陣列） */
function zxingFields(body: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const part of splitEscaped(body, ';')) {
    const i = part.indexOf(':')
    if (i <= 0) continue
    const key = part.slice(0, i).toUpperCase()
    ;(out[key] ??= []).push(unescapeBackslash(part.slice(i + 1)))
  }
  return out
}

function parseWifi(raw: string): WifiResult {
  const f = zxingFields(raw.slice(5))
  return {
    kind: 'wifi',
    raw,
    ssid: f.S?.[0] ?? '',
    password: f.P?.[0] ?? '',
    security: (f.T?.[0] ?? '').trim() || 'nopass',
    hidden: (f.H?.[0] ?? '').toLowerCase() === 'true',
  }
}

/** 展開 vCard／iCalendar 的折行（下一行以空白或 tab 開頭） */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((l) => l.trim())
}

/** 「NAME;PARAM=1:value」→ { name, params, value } */
function contentLine(line: string) {
  const i = line.indexOf(':')
  if (i < 0) return null
  const head = line.slice(0, i)
  const [name, ...params] = head.split(';')
  return { name: name.toUpperCase().replace(/^ITEM\d+\./, ''), params, value: line.slice(i + 1) }
}

function parseVCard(raw: string): ContactResult {
  const r: ContactResult = {
    kind: 'contact',
    raw,
    format: 'vcard',
    name: '',
    org: '',
    title: '',
    phones: [],
    emails: [],
    urls: [],
    address: '',
    note: '',
  }
  let n = ''
  for (const line of unfold(raw)) {
    const cl = contentLine(line)
    if (!cl) continue
    const v = cl.value
    switch (cl.name) {
      case 'FN':
        r.name = unescapeVText(v)
        break
      case 'N':
        n = v
        break
      case 'ORG':
        r.org = splitEscaped(v, ';').map(unescapeVText).filter(Boolean).join(' ')
        break
      case 'TITLE':
        r.title = unescapeVText(v)
        break
      case 'TEL':
        if (v.trim()) r.phones.push(v.replace(/^tel:/i, '').trim())
        break
      case 'EMAIL':
        if (v.trim()) r.emails.push(v.trim())
        break
      case 'URL':
        if (v.trim()) r.urls.push(unescapeVText(v.trim()))
        break
      case 'ADR':
        r.address = splitEscaped(v, ';')
          .map(unescapeVText)
          .map((s) => s.trim())
          .filter(Boolean)
          .join(', ')
        break
      case 'NOTE':
        r.note = unescapeVText(v)
        break
    }
  }
  if (!r.name && n) {
    const [last = '', first = ''] = splitEscaped(n, ';').map(unescapeVText)
    r.name = /[㐀-鿿]/.test(first + last) ? `${last}${first}` : [first, last].filter(Boolean).join(' ')
  }
  return r
}

function parseMecard(raw: string): ContactResult {
  const f = zxingFields(raw.slice(7))
  const nameParts = (f.N?.[0] ?? '').split(',').map((s) => s.trim())
  const name =
    nameParts.length === 2
      ? /[㐀-鿿]/.test(nameParts.join(''))
        ? `${nameParts[0]}${nameParts[1]}`
        : `${nameParts[1]} ${nameParts[0]}`
      : nameParts.join(' ')
  return {
    kind: 'contact',
    raw,
    format: 'mecard',
    name: name.trim(),
    org: f.ORG?.[0] ?? '',
    title: '',
    phones: f.TEL ?? [],
    emails: f.EMAIL ?? [],
    urls: f.URL ?? [],
    address: f.ADR?.[0] ?? '',
    note: f.NOTE?.[0] ?? '',
  }
}

function parseMailto(raw: string): EmailResult {
  const rest = raw.slice(7)
  const q = rest.indexOf('?')
  const to = safeDecode(q < 0 ? rest : rest.slice(0, q))
  const params = new URLSearchParams(q < 0 ? '' : rest.slice(q + 1))
  return {
    kind: 'email',
    raw,
    to,
    subject: params.get('subject') ?? '',
    body: (params.get('body') ?? '').replace(/\r\n/g, '\n'),
  }
}

function parseMatmsg(raw: string): EmailResult {
  const f = zxingFields(raw.slice(7))
  return {
    kind: 'email',
    raw,
    to: f.TO?.[0] ?? '',
    subject: f.SUB?.[0] ?? '',
    body: f.BODY?.[0] ?? '',
  }
}

function parseSms(raw: string): SmsResult {
  if (/^smsto:/i.test(raw) || /^mmsto:/i.test(raw)) {
    const rest = raw.slice(6)
    const i = rest.indexOf(':')
    return {
      kind: 'sms',
      raw,
      phone: (i < 0 ? rest : rest.slice(0, i)).trim(),
      message: i < 0 ? '' : rest.slice(i + 1),
    }
  }
  // sms:+886912345678?body=hello
  const rest = raw.slice(4)
  const q = rest.indexOf('?')
  const params = new URLSearchParams(q < 0 ? '' : rest.slice(q + 1))
  return {
    kind: 'sms',
    raw,
    phone: safeDecode(q < 0 ? rest : rest.slice(0, q)).trim(),
    message: params.get('body') ?? '',
  }
}

function parseGeo(raw: string): GeoResult | null {
  const m = /^geo:\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)(?:,[-+]?\d+(?:\.\d+)?)?(?:\?(.*))?$/i.exec(
    raw.trim(),
  )
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const params = new URLSearchParams(m[3] ?? '')
  return { kind: 'geo', raw, lat, lng, query: params.get('q') ?? '' }
}

/** iCalendar 時間 → Date（UTC「Z」、浮動本地時間、全天日期） */
export function parseIcsDate(value: string): { date: Date | null; allDay: boolean } {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!m) return { date: null, allDay: false }
  const [, y, mo, d, h, mi, s, z] = m
  if (h === undefined) return { date: new Date(+y, +mo - 1, +d), allDay: true }
  const args = [+y, +mo - 1, +d, +h, +mi, s ? +s : 0] as const
  return { date: z ? new Date(Date.UTC(...args)) : new Date(...args), allDay: false }
}

function parseEvent(raw: string): EventResult {
  const r: EventResult = {
    kind: 'event',
    raw,
    title: '',
    location: '',
    description: '',
    start: null,
    end: null,
    allDay: false,
  }
  let inEvent = false
  for (const line of unfold(raw)) {
    const cl = contentLine(line)
    if (!cl) continue
    if (cl.name === 'BEGIN' && cl.value.toUpperCase() === 'VEVENT') inEvent = true
    if (cl.name === 'END' && cl.value.toUpperCase() === 'VEVENT') inEvent = false
    if (!inEvent) continue
    switch (cl.name) {
      case 'SUMMARY':
        r.title = unescapeVText(cl.value)
        break
      case 'LOCATION':
        r.location = unescapeVText(cl.value)
        break
      case 'DESCRIPTION':
        r.description = unescapeVText(cl.value)
        break
      case 'DTSTART': {
        const p = parseIcsDate(cl.value)
        r.start = p.date
        r.allDay = p.allDay
        break
      }
      case 'DTEND':
        r.end = parseIcsDate(cl.value).date
        break
    }
  }
  return r
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

function parseUrl(raw: string): UrlResult | null {
  const s = raw.trim()
  let candidate = s
  // 沒有協定但看起來像網址（www.example.com）
  if (/^www\.[^\s]+\.[^\s]+$/i.test(s)) candidate = `https://${s}`
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) || /\s/.test(candidate)) return null
  try {
    const u = new URL(candidate)
    if (!u.hostname) return null
    const host = u.hostname
    return {
      kind: 'url',
      raw,
      href: u.href,
      protocol: u.protocol.replace(/:$/, ''),
      hostname: host,
      punycode: host.split('.').some((p) => p.startsWith('xn--')),
      userinfo: !!(u.username || u.password),
      ip: IPV4.test(host) || host.startsWith('['),
      unsafeScheme: u.protocol !== 'http:' && u.protocol !== 'https:',
    }
  } catch {
    return null
  }
}

/** 主要入口：判斷內容類型 */
export function parseScan(raw: string): ScanResult {
  const s = raw.trim()
  const upper = s.slice(0, 16).toUpperCase()
  if (upper.startsWith('WIFI:')) return parseWifi(s)
  if (upper.startsWith('BEGIN:VCARD')) return parseVCard(s)
  if (upper.startsWith('MECARD:')) return parseMecard(s)
  if (upper.startsWith('BEGIN:VEVENT') || (upper.startsWith('BEGIN:VCALENDAR') && /BEGIN:VEVENT/i.test(s)))
    return parseEvent(s)
  if (upper.startsWith('MAILTO:')) return parseMailto(s)
  if (upper.startsWith('MATMSG:')) return parseMatmsg(s)
  if (upper.startsWith('TEL:')) return { kind: 'tel', raw, phone: safeDecode(s.slice(4)).trim() }
  if (upper.startsWith('SMSTO:') || upper.startsWith('MMSTO:') || upper.startsWith('SMS:'))
    return parseSms(s)
  if (upper.startsWith('GEO:')) {
    const g = parseGeo(s)
    if (g) return g
  }
  const url = parseUrl(s)
  if (url) return url
  return { kind: 'text', raw }
}

/** 給清單顯示的一行摘要 */
export function scanSummary(r: ScanResult): string {
  switch (r.kind) {
    case 'url':
      return r.href
    case 'wifi':
      return r.ssid
    case 'contact':
      return r.name || r.org || r.phones[0] || r.emails[0] || ''
    case 'email':
      return r.to
    case 'tel':
      return r.phone
    case 'sms':
      return r.phone
    case 'geo':
      return `${r.lat}, ${r.lng}`
    case 'event':
      return r.title
    case 'text':
      return r.raw.replace(/\s+/g, ' ').slice(0, 120)
  }
}
