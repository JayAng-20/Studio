// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildContent,
  buildEvent,
  buildGeo,
  buildMailto,
  buildSms,
  buildTel,
  buildVCard,
  buildWifi,
  contentSlug,
  defaultValues,
  displayName,
  escapeVText,
  escapeWifi,
  icsUtc,
  isValidUrl,
  normalizePhone,
  normalizeUrl,
  parseCoord,
  parseLocalInput,
  splitLatLng,
  type EventValues,
  type VCardValues,
} from '@/features/qr/lib/content'

describe('Wi‑Fi', () => {
  it('標準格式', () => {
    expect(buildWifi({ ssid: 'Home', password: 'secret123', security: 'WPA', hidden: false })).toBe(
      'WIFI:T:WPA;S:Home;P:secret123;H:false;;',
    )
  })
  it('跳脫 \\ ; , : "', () => {
    expect(escapeWifi('a\\b;c,d:e"f')).toBe('a\\\\b\\;c\\,d\\:e\\"f')
    expect(
      buildWifi({ ssid: 'My;Net', password: 'p:a,s"s\\', security: 'WPA', hidden: true }),
    ).toBe('WIFI:T:WPA;S:My\\;Net;P:p\\:a\\,s\\"s\\\\;H:true;;')
  })
  it('不加密時不帶密碼', () => {
    expect(buildWifi({ ssid: 'Cafe', password: 'ignored', security: 'nopass', hidden: false })).toBe(
      'WIFI:T:nopass;S:Cafe;H:false;;',
    )
  })
  it('WEP', () => {
    expect(buildWifi({ ssid: 'Old', password: '12345', security: 'WEP', hidden: false })).toBe(
      'WIFI:T:WEP;S:Old;P:12345;H:false;;',
    )
  })
  it('中文 SSID 原樣保留', () => {
    expect(buildWifi({ ssid: '咖啡店', password: '', security: 'WPA', hidden: false })).toBe(
      'WIFI:T:WPA;S:咖啡店;P:;H:false;;',
    )
  })
  it('沒有 SSID 時不產生', () => {
    expect(buildContent('wifi', { ...defaultValues().wifi, password: 'x' })).toBe('')
  })
})

const card = (patch: Partial<VCardValues>): VCardValues => ({ ...defaultValues().vcard, ...patch })

describe('vCard', () => {
  it('基本欄位與 CRLF', () => {
    const s = buildVCard(
      card({
        firstName: 'Mei',
        lastName: 'Lin',
        org: 'JayAng',
        title: 'Designer',
        mobile: '0912-345-678',
        email: 'mei@example.com',
        website: 'example.com',
      }),
    )
    expect(s.split('\r\n')).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Lin;Mei;;;',
      'FN:Mei Lin',
      'ORG:JayAng',
      'TITLE:Designer',
      'TEL;TYPE=CELL:0912345678',
      'EMAIL;TYPE=INTERNET:mei@example.com',
      'URL:https://example.com',
      'END:VCARD',
    ])
  })
  it('中文姓名姓在前、不加空格', () => {
    expect(displayName('小明', '王')).toBe('王小明')
    expect(buildVCard(card({ firstName: '小明', lastName: '王' }))).toContain('FN:王小明')
  })
  it('跳脫逗號、分號、換行與反斜線', () => {
    expect(escapeVText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
    const s = buildVCard(card({ firstName: 'A', address: '台北市, 信義區;1F', note: '第一行\n第二行' }))
    expect(s).toContain('ADR;TYPE=WORK:;;台北市\\, 信義區\\;1F;;;;')
    expect(s).toContain('NOTE:第一行\\n第二行')
  })
  it('只有公司名稱時 FN 用公司', () => {
    expect(buildVCard(card({ org: 'ACME' }))).toContain('FN:ACME')
  })
  it('全部空白時不產生', () => {
    expect(buildContent('vcard', card({}))).toBe('')
  })
})

describe('mailto', () => {
  it('收件人＋主旨＋內文', () => {
    expect(buildMailto({ to: 'a@b.com', subject: '你好 & 再見', body: 'line1\nline2' })).toBe(
      'mailto:a@b.com?subject=%E4%BD%A0%E5%A5%BD%20%26%20%E5%86%8D%E8%A6%8B&body=line1%0D%0Aline2',
    )
  })
  it('只有收件人', () => {
    expect(buildMailto({ to: ' a@b.com ', subject: '', body: '' })).toBe('mailto:a@b.com')
  })
  it('多位收件人', () => {
    expect(buildMailto({ to: 'a@b.com; c@d.com，e@f.com', subject: '', body: '' })).toBe(
      'mailto:a@b.com,c@d.com,e@f.com',
    )
  })
})

describe('tel／sms', () => {
  it('電話正規化', () => {
    expect(normalizePhone('+886 (2) 1234-5678')).toBe('+886212345678')
    expect(normalizePhone('０９１２３４５６７８')).toBe('0912345678')
    expect(normalizePhone('*123#')).toBe('*123#')
  })
  it('tel', () => {
    expect(buildTel({ phone: '02-1234 5678' })).toBe('tel:0212345678')
    expect(buildContent('tel', { phone: '+' })).toBe('')
  })
  it('sms', () => {
    expect(buildSms({ phone: '0912 345 678', message: '我到了' })).toBe('SMSTO:0912345678:我到了')
    expect(buildSms({ phone: '0912345678', message: '' })).toBe('SMSTO:0912345678:')
  })
})

describe('geo', () => {
  it('組字並去掉多餘小數', () => {
    expect(buildGeo({ lat: '25.0339640', lng: '121.5644720' })).toBe('geo:25.033964,121.564472')
    expect(buildGeo({ lat: '-33.8568', lng: '151.2153' })).toBe('geo:-33.8568,151.2153')
  })
  it('超出範圍或格式錯誤', () => {
    expect(buildGeo({ lat: '91', lng: '0' })).toBe('')
    expect(buildGeo({ lat: '25', lng: 'abc' })).toBe('')
    expect(parseCoord('-180', 'lng')).toBe(-180)
    expect(parseCoord('180.1', 'lng')).toBeNull()
  })
  it('貼上「緯度, 經度」', () => {
    expect(splitLatLng('25.0330, 121.5654')).toEqual({ lat: '25.0330', lng: '121.5654' })
    expect(splitLatLng('25.0330，121.5654')).toEqual({ lat: '25.0330', lng: '121.5654' })
    expect(splitLatLng('hello')).toBeNull()
  })
})

const ev = (patch: Partial<EventValues>): EventValues => ({
  title: '',
  location: '',
  start: '',
  end: '',
  allDay: false,
  description: '',
  ...patch,
})

describe('行事曆 VEVENT', () => {
  it('時間轉 UTC 並跳脫文字', () => {
    const start = '2026-10-02T09:30'
    const end = '2026-10-02T11:00'
    const s = buildEvent(
      ev({ title: '設計審查; 第一輪', location: '會議室 A, 3F', start, end, description: '帶筆電\n準時' }),
    )
    const lines = s.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VEVENT')
    expect(lines).toContain('SUMMARY:設計審查\\; 第一輪')
    expect(lines).toContain(`DTSTART:${icsUtc(parseLocalInput(start)!)}`)
    expect(lines).toContain(`DTEND:${icsUtc(parseLocalInput(end)!)}`)
    expect(lines).toContain('LOCATION:會議室 A\\, 3F')
    expect(lines).toContain('DESCRIPTION:帶筆電\\n準時')
    expect(lines.at(-1)).toBe('END:VEVENT')
  })
  it('icsUtc 格式', () => {
    expect(icsUtc(new Date(Date.UTC(2026, 9, 2, 1, 5, 9)))).toBe('20261002T010509Z')
  })
  it('全天活動：DTEND 為隔天', () => {
    const s = buildEvent(ev({ title: '連假', start: '2026-10-09', end: '2026-10-11', allDay: true }))
    expect(s).toContain('DTSTART;VALUE=DATE:20261009')
    expect(s).toContain('DTEND;VALUE=DATE:20261012')
  })
  it('結束早於開始時改為一小時', () => {
    const s = buildEvent(ev({ title: 'x', start: '2026-10-02T10:00', end: '2026-10-02T09:00' }))
    const start = parseLocalInput('2026-10-02T10:00')!
    expect(s).toContain(`DTEND:${icsUtc(new Date(start.getTime() + 3600_000))}`)
  })
  it('沒有標題時不產生', () => {
    expect(buildContent('event', ev({ start: '2026-10-02T10:00' }))).toBe('')
  })
})

describe('網址正規化', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  example.com/path?q=1  ', 'https://example.com/path?q=1'],
    ['HTTP://Example.com', 'http://Example.com'],
    ['https://a.tw', 'https://a.tw'],
    ['//cdn.example.com/x', 'https://cdn.example.com/x'],
    ['localhost:5173/app', 'https://localhost:5173/app'],
    ['example.com:8080', 'https://example.com:8080'],
    ['ftp://files.example.com', 'ftp://files.example.com'],
    ['', ''],
  ])('%s → %s', (a, b) => expect(normalizeUrl(a)).toBe(b))
  it('有效性', () => {
    expect(isValidUrl('example.com')).toBe(true)
    expect(isValidUrl('localhost:3000')).toBe(true)
    expect(isValidUrl('hello')).toBe(false)
    expect(isValidUrl('')).toBe(false)
  })
  it('buildContent 使用正規化後的網址', () => {
    expect(buildContent('url', { url: 'jayang.app' })).toBe('https://jayang.app')
  })
})

describe('其他', () => {
  it('文字原樣保留', () => {
    expect(buildContent('text', { text: '  多行\n文字  ' })).toBe('  多行\n文字  ')
  })
  it('檔名摘要', () => {
    expect(contentSlug('url', { url: 'https://www.example.com/a' })).toBe('example.com')
    expect(contentSlug('wifi', { ssid: 'Home', password: '', security: 'WPA', hidden: false })).toBe(
      'Home',
    )
  })
})
