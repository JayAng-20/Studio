// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseIcsDate, parseScan, scanSummary, splitEscaped } from '@/features/qr/lib/parse'
import {
  buildEvent,
  buildMailto,
  buildSms,
  buildVCard,
  buildWifi,
  defaultValues,
} from '@/features/qr/lib/content'

describe('結果類型解析', () => {
  it('網址：網域、可疑特徵', () => {
    const r = parseScan('https://www.example.com/a?b=1')
    expect(r.kind).toBe('url')
    if (r.kind !== 'url') return
    expect(r.hostname).toBe('www.example.com')
    expect(r.punycode || r.userinfo || r.ip || r.unsafeScheme).toBe(false)

    const fake = parseScan('https://bank.com@evil.example/login')
    expect(fake.kind === 'url' && fake.userinfo && fake.hostname === 'evil.example').toBe(true)

    const puny = parseScan('https://xn--pple-43d.com/')
    expect(puny.kind === 'url' && puny.punycode).toBe(true)

    const ip = parseScan('http://192.168.0.1/admin')
    expect(ip.kind === 'url' && ip.ip).toBe(true)

    expect(parseScan('www.example.com').kind).toBe('url')
    expect(parseScan('example.com').kind).toBe('text')
  })

  it('Wi‑Fi：含跳脫字元的來回', () => {
    const v = { ssid: 'My;Net:"5G"', password: 'p\\a,ss', security: 'WPA' as const, hidden: true }
    const r = parseScan(buildWifi(v))
    expect(r).toMatchObject({ kind: 'wifi', ssid: v.ssid, password: v.password, security: 'WPA', hidden: true })
  })
  it('Wi‑Fi：欄位順序不同、不加密', () => {
    expect(parseScan('WIFI:S:Cafe;T:nopass;;')).toMatchObject({
      kind: 'wifi',
      ssid: 'Cafe',
      security: 'nopass',
      password: '',
      hidden: false,
    })
  })

  it('vCard 來回', () => {
    const s = buildVCard({
      ...defaultValues().vcard,
      firstName: '小明',
      lastName: '王',
      org: '佳昂, 工作室',
      mobile: '+886 912 345 678',
      email: 'ming@example.com',
      address: '台北市; 信義區',
      note: 'a\nb',
    })
    const r = parseScan(s)
    expect(r).toMatchObject({
      kind: 'contact',
      format: 'vcard',
      name: '王小明',
      org: '佳昂, 工作室',
      phones: ['+886912345678'],
      emails: ['ming@example.com'],
      address: '台北市; 信義區',
      note: 'a\nb',
    })
  })
  it('vCard：折行與 LF 換行、無 FN 時用 N', () => {
    const r = parseScan('BEGIN:VCARD\nVERSION:3.0\nN:Doe;Jane;;;\nTEL;TYPE=CELL:123\nNOTE:long\n  line\nEND:VCARD')
    expect(r).toMatchObject({ kind: 'contact', name: 'Jane Doe', phones: ['123'], note: 'long line' })
  })
  it('MECARD', () => {
    expect(parseScan('MECARD:N:Doe,John;TEL:0912345678;EMAIL:j@d.com;;')).toMatchObject({
      kind: 'contact',
      format: 'mecard',
      name: 'John Doe',
      phones: ['0912345678'],
      emails: ['j@d.com'],
    })
  })

  it('mailto 來回', () => {
    const r = parseScan(buildMailto({ to: 'a@b.com', subject: '主旨 & 測試', body: '第一行\n第二行' }))
    expect(r).toMatchObject({ kind: 'email', to: 'a@b.com', subject: '主旨 & 測試', body: '第一行\n第二行' })
  })
  it('MATMSG', () => {
    expect(parseScan('MATMSG:TO:a@b.com;SUB:Hi;BODY:Yo;;')).toMatchObject({
      kind: 'email',
      to: 'a@b.com',
      subject: 'Hi',
      body: 'Yo',
    })
  })

  it('tel', () => {
    expect(parseScan('tel:+886212345678')).toMatchObject({ kind: 'tel', phone: '+886212345678' })
  })
  it('sms：SMSTO 與 sms: URI', () => {
    expect(parseScan(buildSms({ phone: '0912345678', message: '時間:10:30' }))).toMatchObject({
      kind: 'sms',
      phone: '0912345678',
      message: '時間:10:30',
    })
    expect(parseScan('sms:+886912345678?body=hello%20world')).toMatchObject({
      kind: 'sms',
      phone: '+886912345678',
      message: 'hello world',
    })
  })
  it('geo', () => {
    expect(parseScan('geo:25.033964,121.564472')).toMatchObject({ kind: 'geo', lat: 25.033964, lng: 121.564472 })
    expect(parseScan('geo:25,121,10?q=Taipei')).toMatchObject({ kind: 'geo', query: 'Taipei' })
    expect(parseScan('geo:999,0').kind).toBe('text')
  })

  it('行事曆來回（UTC）', () => {
    const s = buildEvent({
      title: '審查, 第一輪',
      location: 'A; 3F',
      start: '2026-10-02T09:30',
      end: '2026-10-02T11:00',
      allDay: false,
      description: '帶筆電',
    })
    const r = parseScan(s)
    expect(r.kind).toBe('event')
    if (r.kind !== 'event') return
    expect(r.title).toBe('審查, 第一輪')
    expect(r.location).toBe('A; 3F')
    expect(r.start?.getTime()).toBe(new Date(2026, 9, 2, 9, 30).getTime())
    expect(r.end?.getTime()).toBe(new Date(2026, 9, 2, 11, 0).getTime())
    expect(r.allDay).toBe(false)
  })
  it('行事曆：包在 VCALENDAR 內、全天', () => {
    const r = parseScan(
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:連假\r\nDTSTART;VALUE=DATE:20261009\r\nDTEND;VALUE=DATE:20261012\r\nEND:VEVENT\r\nEND:VCALENDAR',
    )
    expect(r).toMatchObject({ kind: 'event', title: '連假', allDay: true })
  })
  it('iCalendar 時間格式', () => {
    expect(parseIcsDate('20261002T010509Z').date?.toISOString()).toBe('2026-10-02T01:05:09.000Z')
    expect(parseIcsDate('20261002').allDay).toBe(true)
    expect(parseIcsDate('bad').date).toBeNull()
  })

  it('其他文字', () => {
    const r = parseScan('就是一段文字')
    expect(r.kind).toBe('text')
    expect(scanSummary(r)).toBe('就是一段文字')
  })
  it('splitEscaped 不切跳脫的分隔符', () => {
    expect(splitEscaped('a\\;b;c', ';')).toEqual(['a\\;b', 'c'])
  })
})
