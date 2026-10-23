/** 輸出格式選擇：方塊格（radiogroup），選取指示以 layout 彈簧滑動；不支援的格式停用並說明 */
import { LayoutGroup, motion } from 'motion/react'
import { useId, useRef, type KeyboardEvent } from 'react'
import { Tooltip } from '@/components/ui'
import { spring } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { OUTPUT_ORDER, type OutputFormat } from '../types'
import { OUTPUT_LABEL } from '../texts'
import type { SupportMap } from '../useFormatSupport'

export function FormatPicker({
  value,
  onChange,
  support,
}: {
  value: OutputFormat
  onChange: (f: OutputFormat) => void
  support: SupportMap
}) {
  const t = useT()
  const id = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = (f: OutputFormat) => support[f] !== 'none'

  const onKey = (e: KeyboardEvent, i: number) => {
    const cols = 4
    const delta =
      e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowDown'
            ? cols
            : e.key === 'ArrowUp'
              ? -cols
              : 0
    if (!delta) return
    e.preventDefault()
    const n = OUTPUT_ORDER.length
    let j = i
    for (let k = 0; k < n; k++) {
      j = (((j + delta) % n) + n) % n
      if (enabled(OUTPUT_ORDER[j])) break
    }
    onChange(OUTPUT_ORDER[j])
    refs.current[j]?.focus()
  }

  return (
    <LayoutGroup id={id}>
      <div
        role="radiogroup"
        aria-label={t('convert.options.format')}
        className="grid grid-cols-4 gap-1.5"
      >
        {OUTPUT_ORDER.map((f, i) => {
          const selected = f === value
          const s = support[f]
          const reason =
            s === 'none' ? t('convert.format.unsupported', { format: OUTPUT_LABEL[f] }) : null
          const btn = (
            <button
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={!!reason || undefined}
              aria-describedby={reason ? `${id}-${f}` : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => !reason && onChange(f)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'relative isolate flex h-11 flex-col items-center justify-center rounded-md border text-small font-semibold transition-colors duration-(--dur-fast)',
                selected
                  ? 'border-transparent text-on-accent'
                  : 'border-border bg-surface-2 text-text hover:border-border-strong hover:bg-surface-3',
                reason && 'cursor-not-allowed opacity-40 hover:border-border hover:bg-surface-2',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="cv-format-pill"
                  aria-hidden
                  className="absolute inset-0 -z-10 rounded-[inherit] bg-accent-strong shadow-[0_6px_16px_-8px_color-mix(in_srgb,var(--accent)_80%,transparent)]"
                  transition={spring.snappy}
                />
              )}
              <span>{OUTPUT_LABEL[f]}</span>
              {reason && (
                <span id={`${id}-${f}`} className="sr-only">
                  {reason}
                </span>
              )}
            </button>
          )
          return reason ? (
            <Tooltip key={f} content={reason}>
              {btn}
            </Tooltip>
          ) : (
            <span key={f} className="contents">
              {btn}
            </span>
          )
        })}
      </div>
    </LayoutGroup>
  )
}
