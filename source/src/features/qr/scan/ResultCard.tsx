import { motion } from 'motion/react'
import {
  AlertTriangle,
  CalendarPlus,
  Camera,
  ExternalLink,
  Eye,
  EyeOff,
  ImageIcon,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  UserPlus,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge, Button, Callout, CopyButton } from '@/components/ui'
import { copyText, downloadBlob } from '@/lib/download'
import { sanitizeFilename } from '@/lib/filename'
import { spring } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useLang, useT } from '@/i18n'
import { buildMailto, buildVCard, defaultValues, escapeVText } from '../lib/content'
import type {
  ContactResult,
  EmailResult,
  EventResult,
  GeoResult,
  ScanResult,
  SmsResult,
  TelResult,
  TextResult,
  UrlResult,
  WifiResult,
} from '../lib/parse'
import { KIND_ICONS } from './kindIcons'

export interface ResultEntry {
  id: string
  result: ScanResult
  source: 'camera' | 'image'
  at: number
}

/** 一列欄位：標籤＋值＋複製 */
function Row({
  label,
  value,
  mono,
  copy = true,
  children,
}: {
  label: string
  value: string
  mono?: boolean
  copy?: boolean
  children?: ReactNode
}) {
  const t = useT()
  if (!value && !children) return null
  return (
    <div className="flex items-start gap-2 border-t border-border py-2.5 first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <dt className="text-caption text-text-3">{label}</dt>
        <dd
          className={cn(
            'mt-0.5 whitespace-pre-wrap break-words text-body text-text',
            mono && 'font-mono text-small',
          )}
        >
          {children ?? value}
        </dd>
      </div>
      {copy && value && (
        <CopyButton
          iconOnly
          size="sm"
          variant="ghost"
          label={t('qr.result.copyField', { field: label })}
          onCopy={() => copyText(value)}
          className="max-sm:size-11"
        />
      )}
    </div>
  )
}

function useDateFormat() {
  const lang = useLang()
  return (d: Date, allDay: boolean) =>
    new Intl.DateTimeFormat(lang === 'en' ? 'en' : 'zh-TW', {
      dateStyle: 'medium',
      ...(allDay ? {} : { timeStyle: 'short' }),
    }).format(d)
}

export function ResultCard({ entry, className }: { entry: ResultEntry; className?: string }) {
  const t = useT()
  const lang = useLang()
  const r = entry.result
  const Icon = KIND_ICONS[r.kind]
  const time = new Intl.DateTimeFormat(lang === 'en' ? 'en' : 'zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(entry.at)
  return (
    <motion.article
      initial={{ opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={spring.bouncy}
      className={cn('card flex flex-col gap-4 p-4', className)}
      aria-label={t('qr.result.title')}
    >
      <header className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
          <Icon size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-caption text-text-3">{t('qr.result.title')}</p>
          <h3 className="text-h3 font-semibold">{t(`qr.result.kinds.${r.kind}`)}</h3>
        </div>
        <Badge
          tone="neutral"
          icon={
            entry.source === 'camera' ? (
              <Camera size={12} aria-hidden />
            ) : (
              <ImageIcon size={12} aria-hidden />
            )
          }
          className="tabular-nums"
        >
          {time}
        </Badge>
      </header>
      <Body r={r} />
      {r.kind !== 'text' && (
        <details className="group rounded-md bg-surface-2 px-3 py-2 text-small">
          <summary className="flex min-h-8 cursor-pointer select-none items-center justify-between gap-2 text-text-2 marker:content-none">
            {t('qr.result.raw')}
            <span
              aria-hidden
              className="text-text-3 transition-transform duration-(--dur-fast) group-open:rotate-90"
            >
              ›
            </span>
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-caption text-text-2">
            {r.raw}
          </pre>
          <div className="mt-2">
            <CopyButton
              size="sm"
              variant="secondary"
              label={t('qr.result.copyRaw')}
              onCopy={() => copyText(r.raw)}
            />
          </div>
        </details>
      )}
    </motion.article>
  )
}

function Body({ r }: { r: ScanResult }) {
  switch (r.kind) {
    case 'url':
      return <UrlBody r={r} />
    case 'wifi':
      return <WifiBody r={r} />
    case 'contact':
      return <ContactBody r={r} />
    case 'email':
      return <EmailBody r={r} />
    case 'tel':
      return <TelBody r={r} />
    case 'sms':
      return <SmsBody r={r} />
    case 'geo':
      return <GeoBody r={r} />
    case 'event':
      return <EventBody r={r} />
    case 'text':
      return <TextBody r={r} />
  }
}

function UrlBody({ r }: { r: UrlResult }) {
  const t = useT()
  const warnings: string[] = []
  if (r.userinfo) {
    const fake = r.raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('@')[0]
    warnings.push(t('qr.result.warnUserinfo', { fake, host: r.hostname }))
  }
  if (r.punycode) warnings.push(t('qr.result.warnPunycode', { host: r.hostname }))
  if (r.ip) warnings.push(t('qr.result.warnIp'))
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-caption text-text-3">{t('qr.result.domain')}</p>
        <p className="break-all text-h2 font-semibold text-text">{r.hostname}</p>
      </div>
      <div>
        <p className="text-caption text-text-3">{t('qr.result.fullUrl')}</p>
        <p className="mt-0.5 max-h-32 overflow-auto break-all rounded-sm bg-surface-2 px-2.5 py-2 font-mono text-small text-text">
          {r.href}
        </p>
      </div>
      {warnings.map((w) => (
        <Callout key={w} tone="warning" icon={<AlertTriangle size={16} aria-hidden />}>
          {w}
        </Callout>
      ))}
      {r.unsafeScheme ? (
        <Callout tone="neutral">{t('qr.result.warnScheme', { scheme: r.protocol })}</Callout>
      ) : (
        <p className="text-caption text-text-3">{t('qr.result.openConfirm')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {!r.unsafeScheme && (
          <Button asChild variant="primary" className="max-sm:h-11">
            <a href={r.href} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} aria-hidden />
              {t('qr.result.openUrl')}
            </a>
          </Button>
        )}
        <CopyButton variant="secondary" className="max-sm:h-11" onCopy={() => copyText(r.href)} />
      </div>
    </div>
  )
}

function WifiBody({ r }: { r: WifiResult }) {
  const t = useT()
  const [shown, setShown] = useState(false)
  const security = r.security === 'nopass' ? t('qr.result.noPassword') : r.security
  return (
    <dl className="flex flex-col">
      <Row label={t('qr.result.ssid')} value={r.ssid} />
      {r.password ? (
        <div className="flex items-start gap-1 border-t border-border py-2.5">
          <div className="min-w-0 flex-1">
            <dt className="text-caption text-text-3">{t('qr.result.password')}</dt>
            <dd className="mt-0.5 break-all font-mono text-small text-text">
              {shown ? r.password : '•'.repeat(Math.min(16, r.password.length))}
            </dd>
          </div>
          <Button
            icon
            size="sm"
            variant="ghost"
            aria-pressed={shown}
            aria-label={shown ? t('qr.result.hidePassword') : t('qr.result.showPassword')}
            onClick={() => setShown((s) => !s)}
            className="max-sm:size-11"
          >
            {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </Button>
          <CopyButton
            iconOnly
            size="sm"
            variant="ghost"
            label={t('qr.result.copyPassword')}
            onCopy={() => copyText(r.password)}
            className="max-sm:size-11"
          />
        </div>
      ) : null}
      <Row label={t('qr.result.security')} value={security} copy={false}>
        <span className="flex flex-wrap items-center gap-2">
          {security}
          {r.hidden && <Badge tone="neutral">{t('qr.result.hiddenNetwork')}</Badge>}
        </span>
      </Row>
    </dl>
  )
}

/** 把聯絡人存成 .vcf（MECARD 轉成 vCard） */
function contactVcf(r: ContactResult): string {
  if (r.format === 'vcard') return r.raw
  const lines = buildVCard({ ...defaultValues().vcard, firstName: r.name, org: r.org }).split(
    '\r\n',
  )
  const extra = [
    ...r.phones.map((p) => `TEL:${p}`),
    ...r.emails.map((e) => `EMAIL:${e}`),
    ...r.urls.map((u) => `URL:${u}`),
    ...(r.address ? [`ADR:;;${escapeVText(r.address)};;;;`] : []),
    ...(r.note ? [`NOTE:${escapeVText(r.note)}`] : []),
  ]
  lines.splice(lines.length - 1, 0, ...extra)
  return lines.join('\r\n')
}

function ContactBody({ r }: { r: ContactResult }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col">
        <Row label={t('qr.result.name')} value={r.name} />
        <Row label={t('qr.result.org')} value={r.org} />
        <Row label={t('qr.result.jobTitle')} value={r.title} />
        {r.phones.map((p, i) => (
          <Row key={`p${i}`} label={t('qr.result.phone')} value={p}>
            <a
              className="text-accent-ink underline-offset-2 hover:underline"
              href={`tel:${p.replace(/[^\d+*#]/g, '')}`}
            >
              {p}
            </a>
          </Row>
        ))}
        {r.emails.map((e, i) => (
          <Row key={`e${i}`} label={t('qr.result.email')} value={e}>
            <a className="text-accent-ink underline-offset-2 hover:underline" href={`mailto:${e}`}>
              {e}
            </a>
          </Row>
        ))}
        {r.urls.map((u, i) => (
          <Row key={`u${i}`} label={t('qr.result.website')} value={u} />
        ))}
        <Row label={t('qr.result.address')} value={r.address} />
        <Row label={t('qr.result.note')} value={r.note} />
      </dl>
      <div>
        <Button
          variant="primary"
          leading={<UserPlus size={16} aria-hidden />}
          onClick={() =>
            downloadBlob(
              new Blob([contactVcf(r)], { type: 'text/vcard' }),
              `${sanitizeFilename(r.name || r.org || 'contact', 'contact')}.vcf`,
            )
          }
        >
          {t('qr.result.saveContact')}
        </Button>
      </div>
    </div>
  )
}

function EmailBody({ r }: { r: EmailResult }) {
  const t = useT()
  const href = /^mailto:/i.test(r.raw)
    ? r.raw
    : buildMailto({ to: r.to, subject: r.subject, body: r.body })
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col">
        <Row label={t('qr.result.to')} value={r.to} />
        <Row label={t('qr.result.subject')} value={r.subject} />
        <Row label={t('qr.result.body')} value={r.body} />
      </dl>
      <div>
        <Button asChild variant="primary">
          <a href={href}>
            <Mail size={16} aria-hidden />
            {t('qr.result.compose')}
          </a>
        </Button>
      </div>
    </div>
  )
}

function TelBody({ r }: { r: TelResult }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <p className="break-all text-h2 font-semibold tabular-nums">{r.phone}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="primary">
          <a href={`tel:${r.phone.replace(/[^\d+*#,;]/g, '')}`}>
            <Phone size={16} aria-hidden />
            {t('qr.result.call')}
          </a>
        </Button>
        <CopyButton variant="secondary" onCopy={() => copyText(r.phone)} />
      </div>
    </div>
  )
}

function SmsBody({ r }: { r: SmsResult }) {
  const t = useT()
  const href = `sms:${r.phone.replace(/[^\d+*#]/g, '')}${r.message ? `?body=${encodeURIComponent(r.message)}` : ''}`
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col">
        <Row label={t('qr.result.phone')} value={r.phone} />
        <Row label={t('qr.result.message')} value={r.message} />
      </dl>
      <div>
        <Button asChild variant="primary">
          <a href={href}>
            <MessageSquareText size={16} aria-hidden />
            {t('qr.result.sendSms')}
          </a>
        </Button>
      </div>
    </div>
  )
}

function GeoBody({ r }: { r: GeoResult }) {
  const t = useT()
  const coords = `${r.lat}, ${r.lng}`
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col">
        <Row label={t('qr.result.lat')} value={String(r.lat)} mono />
        <Row label={t('qr.result.lng')} value={String(r.lng)} mono />
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="primary">
          <a href={`geo:${r.lat},${r.lng}`}>
            <MapPin size={16} aria-hidden />
            {t('qr.result.openMap')}
          </a>
        </Button>
        <CopyButton variant="secondary" onCopy={() => copyText(coords)} />
      </div>
    </div>
  )
}

/** 包成完整的 .ics（行事曆 App 需要 VCALENDAR 外框） */
function eventIcs(r: EventResult): string {
  if (/BEGIN:VCALENDAR/i.test(r.raw)) return r.raw
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//JayAng Studio Web//QR//EN',
    r.raw.trim(),
    'END:VCALENDAR',
  ].join('\r\n')
}

function EventBody({ r }: { r: EventResult }) {
  const t = useT()
  const fmt = useDateFormat()
  const when = r.start ? fmt(r.start, r.allDay) : ''
  const until = r.end ? fmt(r.allDay ? new Date(r.end.getTime() - 86400_000) : r.end, r.allDay) : ''
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col">
        <Row label={t('qr.result.eventTitle')} value={r.title} />
        <Row label={t('qr.result.start')} value={when} copy={false}>
          <span className="flex flex-wrap items-center gap-2 tabular-nums">
            {when}
            {r.allDay && <Badge tone="neutral">{t('qr.result.allDay')}</Badge>}
          </span>
        </Row>
        {until && until !== when && <Row label={t('qr.result.end')} value={until} copy={false} />}
        <Row label={t('qr.result.location')} value={r.location} />
        <Row label={t('qr.result.description')} value={r.description} />
      </dl>
      <div>
        <Button
          variant="primary"
          leading={<CalendarPlus size={16} aria-hidden />}
          onClick={() =>
            downloadBlob(
              new Blob([eventIcs(r)], { type: 'text/calendar' }),
              `${sanitizeFilename(r.title || 'event', 'event')}.ics`,
            )
          }
        >
          {t('qr.result.addCalendar')}
        </Button>
      </div>
    </div>
  )
}

function TextBody({ r }: { r: TextResult }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <p className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-2 px-3 py-2.5 text-body text-text">
        {r.raw}
      </p>
      <div>
        <CopyButton
          variant="secondary"
          label={t('qr.result.copyText')}
          onCopy={() => copyText(r.raw)}
        />
      </div>
    </div>
  )
}
