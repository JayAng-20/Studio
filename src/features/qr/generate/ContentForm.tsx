import { Eye, EyeOff, LocateFixed } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Button, Field, Select, Switch, toast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import {
  isValidUrl,
  normalizeUrl,
  parseCoord,
  splitLatLng,
  toLocalInput,
  parseLocalInput,
  type ContentType,
  type ContentValues,
  type WifiSecurity,
} from '../lib/content'
import { useQrStore } from '../store'

/** 文字輸入欄（含標籤與提示） */
function TextInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  invalid,
  type = 'text',
  inputMode,
  autoComplete = 'off',
  className,
  trailing,
  onPaste,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: ReactNode
  invalid?: boolean
  type?: string
  inputMode?: 'text' | 'url' | 'email' | 'tel' | 'decimal'
  autoComplete?: string
  className?: string
  trailing?: ReactNode
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void
}) {
  const id = useId()
  return (
    <Field
      label={label}
      htmlFor={id}
      className={className}
      hint={
        hint ? (
          <span id={`${id}-h`} className={cn(invalid && 'text-warning-ink')}>
            {hint}
          </span>
        ) : undefined
      }
    >
      <div className="relative">
        <input
          id={id}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          spellCheck={false}
          className={cn('field', trailing && 'pr-11')}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-h` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
        />
        {trailing && <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>}
      </div>
    </Field>
  )
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  hint?: ReactNode
}) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <textarea
        id={id}
        rows={rows}
        className="field"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

/** 依內容類型顯示專屬表單 */
export function ContentForm({ type }: { type: ContentType }) {
  switch (type) {
    case 'url':
      return <UrlForm />
    case 'text':
      return <TextForm />
    case 'wifi':
      return <WifiForm />
    case 'vcard':
      return <VCardForm />
    case 'email':
      return <EmailForm />
    case 'tel':
      return <TelForm />
    case 'sms':
      return <SmsForm />
    case 'geo':
      return <GeoForm />
    case 'event':
      return <EventForm />
  }
}

function useValues<T extends ContentType>(type: T) {
  const v = useQrStore((s) => s.values[type]) as ContentValues[T]
  const setValues = useQrStore((s) => s.setValues)
  return [v, (patch: Partial<ContentValues[T]>) => setValues(type, patch)] as const
}

function UrlForm() {
  const t = useT()
  const [v, set] = useValues('url')
  const n = normalizeUrl(v.url)
  const invalid = !!v.url.trim() && !isValidUrl(v.url)
  const hint = invalid
    ? t('qr.form.urlInvalid')
    : n && n !== v.url.trim()
      ? t('qr.form.urlWillEncode', { url: n })
      : undefined
  return (
    <TextInput
      label={t('qr.form.url')}
      value={v.url}
      onChange={(url) => set({ url })}
      placeholder={t('qr.form.urlPlaceholder')}
      type="url"
      inputMode="url"
      autoComplete="url"
      hint={hint}
      invalid={invalid}
    />
  )
}

function TextForm() {
  const t = useT()
  const [v, set] = useValues('text')
  return (
    <TextArea
      label={t('qr.form.text')}
      value={v.text}
      onChange={(text) => set({ text })}
      placeholder={t('qr.form.textPlaceholder')}
      rows={6}
    />
  )
}

function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={shown ? t('qr.form.hidePassword') : t('qr.form.showPassword')}
      title={shown ? t('qr.form.hidePassword') : t('qr.form.showPassword')}
      className="grid size-9 place-items-center rounded-sm text-text-3 hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-text"
    >
      {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
    </button>
  )
}

function WifiForm() {
  const t = useT()
  const [v, set] = useValues('wifi')
  const [shown, setShown] = useState(false)
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextInput
        label={t('qr.form.ssid')}
        value={v.ssid}
        onChange={(ssid) => set({ ssid })}
        placeholder={t('qr.form.ssidPlaceholder')}
      />
      <Select<WifiSecurity>
        label={t('qr.form.security')}
        value={v.security}
        onChange={(security) => set({ security })}
        options={[
          { value: 'WPA', label: t('qr.form.securityWpa') },
          { value: 'WEP', label: t('qr.form.securityWep') },
          { value: 'nopass', label: t('qr.form.securityNone') },
        ]}
      />
      {v.security !== 'nopass' && (
        <TextInput
          label={t('qr.form.password')}
          value={v.password}
          onChange={(password) => set({ password })}
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          className="sm:col-span-2"
          trailing={<PasswordToggle shown={shown} onToggle={() => setShown((s) => !s)} />}
        />
      )}
      <Switch
        className="sm:col-span-2"
        checked={v.hidden}
        onChange={(hidden) => set({ hidden })}
        label={t('qr.form.hidden')}
        description={t('qr.form.hiddenDesc')}
      />
    </div>
  )
}

function VCardForm() {
  const t = useT()
  const [v, set] = useValues('vcard')
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextInput
        label={t('qr.form.lastName')}
        value={v.lastName}
        onChange={(lastName) => set({ lastName })}
        autoComplete="family-name"
      />
      <TextInput
        label={t('qr.form.firstName')}
        value={v.firstName}
        onChange={(firstName) => set({ firstName })}
        autoComplete="given-name"
      />
      <TextInput
        label={t('qr.form.org')}
        value={v.org}
        onChange={(org) => set({ org })}
        autoComplete="organization"
      />
      <TextInput
        label={t('qr.form.jobTitle')}
        value={v.title}
        onChange={(title) => set({ title })}
        autoComplete="organization-title"
      />
      <TextInput
        label={t('qr.form.mobile')}
        value={v.mobile}
        onChange={(mobile) => set({ mobile })}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
      />
      <TextInput
        label={t('qr.form.phone')}
        value={v.phone}
        onChange={(phone) => set({ phone })}
        type="tel"
        inputMode="tel"
      />
      <TextInput
        label={t('qr.form.email')}
        value={v.email}
        onChange={(email) => set({ email })}
        type="email"
        inputMode="email"
        autoComplete="email"
      />
      <TextInput
        label={t('qr.form.website')}
        value={v.website}
        onChange={(website) => set({ website })}
        inputMode="url"
        placeholder={t('qr.form.urlPlaceholder')}
      />
      <TextInput
        label={t('qr.form.address')}
        value={v.address}
        onChange={(address) => set({ address })}
        autoComplete="street-address"
        className="sm:col-span-2"
      />
      <div className="sm:col-span-2">
        <TextArea label={t('qr.form.note')} value={v.note} onChange={(note) => set({ note })} rows={2} />
      </div>
    </div>
  )
}

function EmailForm() {
  const t = useT()
  const [v, set] = useValues('email')
  return (
    <div className="grid gap-4">
      <TextInput
        label={t('qr.form.to')}
        value={v.to}
        onChange={(to) => set({ to })}
        placeholder={t('qr.form.toPlaceholder')}
        inputMode="email"
        hint={t('qr.form.toHint')}
      />
      <TextInput label={t('qr.form.subject')} value={v.subject} onChange={(subject) => set({ subject })} />
      <TextArea label={t('qr.form.body')} value={v.body} onChange={(body) => set({ body })} />
    </div>
  )
}

function TelForm() {
  const t = useT()
  const [v, set] = useValues('tel')
  return (
    <TextInput
      label={t('qr.form.phoneNumber')}
      value={v.phone}
      onChange={(phone) => set({ phone })}
      placeholder={t('qr.form.phonePlaceholder')}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
    />
  )
}

function SmsForm() {
  const t = useT()
  const [v, set] = useValues('sms')
  return (
    <div className="grid gap-4">
      <TextInput
        label={t('qr.form.phoneNumber')}
        value={v.phone}
        onChange={(phone) => set({ phone })}
        placeholder={t('qr.form.phonePlaceholder')}
        type="tel"
        inputMode="tel"
      />
      <TextArea
        label={t('qr.form.message')}
        value={v.message}
        onChange={(message) => set({ message })}
        rows={3}
      />
    </div>
  )
}

function GeoForm() {
  const t = useT()
  const [v, set] = useValues('geo')
  const [locating, setLocating] = useState(false)
  const latBad = !!v.lat.trim() && parseCoord(v.lat, 'lat') === null
  const lngBad = !!v.lng.trim() && parseCoord(v.lng, 'lng') === null
  const geoSupported = typeof navigator !== 'undefined' && !!navigator.geolocation
  // 貼上「緯度, 經度」時自動拆到兩個欄位
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pair = splitLatLng(e.clipboardData.getData('text'))
    if (pair) {
      e.preventDefault()
      set(pair)
    }
  }
  const locate = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        set({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) })
      },
      (err) => {
        console.error(err)
        setLocating(false)
        toast.error(t('qr.form.locationFailed'), { description: t('qr.form.locationFailedDesc') })
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextInput
        label={t('qr.form.lat')}
        value={v.lat}
        onChange={(lat) => set({ lat })}
        placeholder={t('qr.form.latPlaceholder')}
        inputMode="decimal"
        invalid={latBad}
        onPaste={onPaste}
      />
      <TextInput
        label={t('qr.form.lng')}
        value={v.lng}
        onChange={(lng) => set({ lng })}
        placeholder={t('qr.form.lngPlaceholder')}
        inputMode="decimal"
        invalid={lngBad}
        onPaste={onPaste}
      />
      <p
        className={cn('text-caption sm:col-span-2', latBad || lngBad ? 'text-warning-ink' : 'text-text-3')}
        aria-live="polite"
      >
        {latBad || lngBad ? t('qr.form.geoInvalid') : t('qr.form.geoHint')}
      </p>
      {geoSupported && (
        <div className="sm:col-span-2">
          <Button
            variant="secondary"
            size="sm"
            loading={locating}
            leading={<LocateFixed size={16} aria-hidden />}
            onClick={locate}
          >
            {locating ? t('qr.form.locating') : t('qr.form.useLocation')}
          </Button>
        </div>
      )}
    </div>
  )
}

function EventForm() {
  const t = useT()
  const [v, set] = useValues('event')
  const startId = useId()
  const endId = useId()
  // 切換全天：在 date 與 datetime-local 之間轉換，保留日期
  const toggleAllDay = (allDay: boolean) => {
    const s = parseLocalInput(v.start)
    const e = parseLocalInput(v.end)
    if (allDay) {
      set({
        allDay,
        start: s ? toLocalInput(s, false) : v.start,
        end: e ? toLocalInput(e, false) : v.end,
      })
    } else {
      // 從全天改回一般活動：預設 09:00–10:00
      const base = s ? new Date(s) : new Date()
      base.setHours(9, 0, 0, 0)
      const end = e && e.getTime() >= base.getTime() ? new Date(e) : new Date(base)
      end.setHours(10, 0, 0, 0)
      set({ allDay, start: toLocalInput(base), end: toLocalInput(end) })
    }
  }
  const inputType = v.allDay ? 'date' : 'datetime-local'
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextInput
        label={t('qr.form.eventTitle')}
        value={v.title}
        onChange={(title) => set({ title })}
        className="sm:col-span-2"
      />
      <TextInput
        label={t('qr.form.location')}
        value={v.location}
        onChange={(location) => set({ location })}
        className="sm:col-span-2"
      />
      <Switch
        className="sm:col-span-2"
        checked={v.allDay}
        onChange={toggleAllDay}
        label={t('qr.form.allDay')}
      />
      <Field label={t('qr.form.start')} htmlFor={startId}>
        <input
          id={startId}
          type={inputType}
          className="field tabular-nums"
          value={v.start}
          onChange={(e) => set({ start: e.target.value })}
        />
      </Field>
      <Field label={t('qr.form.end')} htmlFor={endId}>
        <input
          id={endId}
          type={inputType}
          className="field tabular-nums"
          value={v.end}
          min={v.start}
          onChange={(e) => set({ end: e.target.value })}
        />
      </Field>
      <div className="sm:col-span-2">
        <TextArea
          label={t('qr.form.description')}
          value={v.description}
          onChange={(description) => set({ description })}
          rows={3}
        />
      </div>
    </div>
  )
}
