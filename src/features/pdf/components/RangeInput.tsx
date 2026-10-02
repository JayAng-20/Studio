import { AlertCircle } from 'lucide-react'
import { useId } from 'react'
import { cn } from '@/lib/cn'
import { t as tt, useT, type TKey } from '@/i18n'
import type { PageRangeError, PageRangeResult } from '../lib/pageRange'

/** 頁範圍錯誤 → 清楚的說明（發生什麼事＋怎麼改） */
export function rangeErrorText(
  e: PageRangeError,
  translate: (k: TKey, v?: Record<string, string | number>) => string = tt,
) {
  return translate(`pdf.range.errors.${e.code}` as TKey, {
    token: e.token ?? '',
    max: e.max ?? 0,
  })
}

/** 頁範圍輸入欄：即時驗證，錯誤時顯示原因與範例 */
export function RangeInput({
  value,
  onChange,
  result,
  label,
  hideLabel,
  placeholder,
  className,
  size = 'md',
  hint,
}: {
  value: string
  onChange: (v: string) => void
  /** 解析結果（空字串且允許空白時傳 null） */
  result: PageRangeResult | null
  label: string
  hideLabel?: boolean
  placeholder?: string
  className?: string
  size?: 'sm' | 'md'
  hint?: string
}) {
  const t = useT()
  const id = useId()
  const error = result && !result.ok ? result.error : null
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'label'}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t('pdf.range.placeholder')}
        spellCheck={false}
        autoComplete="off"
        inputMode="text"
        aria-invalid={!!error || undefined}
        aria-describedby={`${id}-msg`}
        className={cn(
          'field font-mono tabular-nums placeholder:font-sans',
          size === 'sm' && 'h-8! text-small',
        )}
      />
      <p
        id={`${id}-msg`}
        aria-live="polite"
        className={cn(
          'mt-1 flex min-h-4 items-start gap-1 text-caption',
          error ? 'text-danger-ink' : 'text-text-3',
        )}
      >
        {error ? (
          <>
            <AlertCircle size={13} className="mt-px shrink-0" aria-hidden />
            <span>{rangeErrorText(error, t)}</span>
          </>
        ) : result && result.ok ? (
          t('pdf.range.selected', { count: result.pages.length })
        ) : (
          hint
        )}
      </p>
    </div>
  )
}
