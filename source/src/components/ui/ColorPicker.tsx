import { Pipette } from 'lucide-react'
import { useId, useState } from 'react'
import { Popover } from './Popover'
import { cn } from '@/lib/cn'
import { caps } from '@/lib/capabilities'
import { useT } from '@/i18n'

const SWATCHES = [
  '#000000',
  '#1E293B',
  '#475569',
  '#94A3B8',
  '#FFFFFF',
  '#DC2626',
  '#F97316',
  '#F59E0B',
  '#16A34A',
  '#0EA5E9',
  '#2F6BEA',
  '#7C3AED',
  '#C026D3',
  '#E11D48',
  '#78716C',
]

export const isHex = (v: string) => /^#([0-9a-f]{6})$/i.test(v)
const normalize = (v: string) => {
  let s = v.trim()
  if (!s.startsWith('#')) s = `#${s}`
  if (/^#[0-9a-f]{3}$/i.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  return s.toUpperCase()
}

interface ColorPickerProps {
  value: string
  onChange: (v: string) => void
  label: string
  className?: string
  swatches?: string[]
}

/** 顏色選擇：色票＋十六進位＋原生色盤＋支援時啟用 EyeDropper */
export function ColorPicker({
  value,
  onChange,
  label,
  className,
  swatches = SWATCHES,
}: ColorPickerProps) {
  const t = useT()
  const id = useId()
  const [text, setText] = useState(value.toUpperCase())
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setText(value.toUpperCase())
  }
  const commit = (v: string) => {
    const n = normalize(v)
    if (isHex(n)) onChange(n)
    else setText(value.toUpperCase())
  }
  const pick = async () => {
    try {
      const Eye = (
        window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }
      ).EyeDropper
      const r = await new Eye().open()
      onChange(normalize(r.sRGBHex))
    } catch {
      /* 使用者取消 */
    }
  }
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <span className="label" id={`${id}-l`}>
        {label}
      </span>
      <Popover
        label={label}
        trigger={
          <button
            type="button"
            aria-labelledby={`${id}-l`}
            aria-describedby={`${id}-v`}
            className="field flex items-center gap-2.5 text-left"
          >
            <span
              className="size-5 shrink-0 rounded-xs border border-border-strong"
              style={{ background: value }}
            />
            <span id={`${id}-v`} className="font-mono text-small uppercase">
              {value}
            </span>
          </button>
        }
        className="w-[248px]"
      >
        <div className="grid grid-cols-5 gap-2" role="listbox" aria-label={t('common.selectColor')}>
          {swatches.map((c) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={c.toUpperCase() === value.toUpperCase()}
              aria-label={c}
              onClick={() => onChange(c)}
              className={cn(
                'size-9 rounded-sm border border-border-strong transition-transform duration-(--dur-fast) hover:scale-110',
                c.toUpperCase() === value.toUpperCase() &&
                  'ring-2 ring-accent ring-offset-2 ring-offset-surface',
              )}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label
            className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border-strong"
            style={{ background: value }}
          >
            <span className="sr-only">{t('common.selectColor')}</span>
            <input
              type="color"
              value={isHex(value) ? value : '#000000'}
              onChange={(e) => onChange(e.target.value.toUpperCase())}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <input
            aria-label={`${label} HEX`}
            className="field h-10 font-mono uppercase"
            value={text}
            maxLength={7}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
          />
          {caps.eyeDropper() && (
            <button
              type="button"
              onClick={pick}
              aria-label={t('common.eyedropper')}
              title={t('common.eyedropper')}
              className="grid size-10 shrink-0 place-items-center rounded-md border border-border-strong text-text-2 hover:bg-surface-2 hover:text-text"
            >
              <Pipette size={16} aria-hidden />
            </button>
          )}
        </div>
      </Popover>
    </div>
  )
}
