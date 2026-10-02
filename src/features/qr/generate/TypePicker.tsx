import { LayoutGroup, motion } from 'motion/react'
import {
  CalendarDays,
  Contact,
  Link2,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Type,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'
import { spring } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { CONTENT_TYPES, type ContentType } from '../lib/content'

export const TYPE_ICONS: Record<ContentType, LucideIcon> = {
  url: Link2,
  text: Type,
  wifi: Wifi,
  vcard: Contact,
  email: Mail,
  tel: Phone,
  sms: MessageSquareText,
  geo: MapPin,
  event: CalendarDays,
}

/** 內容類型選擇：radiogroup，選取底板以彈簧在項目間滑動 */
export function TypePicker({
  value,
  onChange,
}: {
  value: ContentType
  onChange: (t: ContentType) => void
}) {
  const t = useT()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!dir) return
    e.preventDefault()
    const j = (i + dir + CONTENT_TYPES.length) % CONTENT_TYPES.length
    onChange(CONTENT_TYPES[j])
    refs.current[j]?.focus()
  }
  return (
    <LayoutGroup id="qr-type-picker">
      <div
        role="radiogroup"
        aria-label={t('qr.types.label')}
        className="grid grid-cols-3 gap-1.5 rounded-xl bg-[color-mix(in_srgb,var(--text)_5%,transparent)] p-1.5 sm:grid-cols-5 xl:grid-cols-9"
      >
        {CONTENT_TYPES.map((type, i) => {
          const Icon = TYPE_ICONS[type]
          const selected = type === value
          return (
            <button
              key={type}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(type)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'relative z-0 flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-caption font-medium transition-colors duration-(--dur-fast)',
                selected ? 'text-text' : 'text-text-2 hover:text-text',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="qr-type-pill"
                  className="absolute inset-0 -z-10 rounded-[inherit] bg-surface shadow-e2 dark:bg-surface-3"
                  transition={spring.snappy}
                />
              )}
              <Icon
                size={20}
                aria-hidden
                className={cn(
                  'transition-colors duration-(--dur-fast)',
                  selected ? 'text-accent-ink' : 'text-text-3',
                )}
              />
              <span className="max-w-full truncate leading-4">{t(`qr.types.${type}.label`)}</span>
            </button>
          )
        })}
      </div>
    </LayoutGroup>
  )
}
