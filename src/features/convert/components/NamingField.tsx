/** 命名規則：模板輸入、變數晶片（插入到游標位置）、即時預覽 */
import { RotateCcw } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { buildOutputName, unknownVars } from '../lib/naming'
import { computeOutputSize } from '../lib/resize'
import { FORMATS } from '../types'
import { useConvert } from '../store'

const CHIPS = ['name', 'w', 'h', 'format', 'quality', 'index', 'date'] as const

export function NamingField() {
  const t = useT()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const options = useConvert((s) => s.options)
  const setOptions = useConvert((s) => s.setOptions)
  const first = useConvert((s) => s.items[0])
  const count = useConvert((s) => s.items.length)
  const pattern = useSettings((s) => s.filenamePattern)
  const effective = options.template ?? pattern
  const [text, setText] = useState(effective)
  const [prev, setPrev] = useState(effective)
  if (prev !== effective) {
    setPrev(effective)
    setText(effective)
  }

  const commit = (v: string) => {
    const clean = v.trim()
    setOptions({ template: !clean || clean === pattern ? null : clean })
    if (!clean) setText(pattern)
  }

  const insert = (key: string) => {
    const el = input.current
    const token = `{${key}}`
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = text.slice(0, start) + token + text.slice(end)
    setText(next)
    commit(next)
    requestAnimationFrame(() => {
      el?.focus()
      const pos = start + token.length
      el?.setSelectionRange(pos, pos)
    })
  }

  // 預覽：用第一個檔案（沒有時用範例）
  const src =
    first?.probe?.width && first.probe.height
      ? { width: first.probe.width, height: first.probe.height }
      : { width: 4032, height: 3024 }
  const out =
    options.format === 'ico' ? { width: 256, height: 256 } : computeOutputSize(src, options.resize)
  const example = buildOutputName(text || pattern, {
    original: first?.name ?? 'IMG_0001.HEIC',
    action: t('convert.naming.action'),
    width: out.width,
    height: out.height,
    format: FORMATS[options.format].ext,
    quality: FORMATS[options.format].quality && !options.targetOn ? options.quality : undefined,
    index: 1,
    total: Math.max(1, count),
    date: new Date(),
  })
  const unknown = unknownVars(text)

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="label mb-0!">
        {t('convert.naming.label')}
      </label>
      <input
        ref={input}
        id={id}
        className={cn('field font-mono text-small', unknown.length > 0 && 'border-warning')}
        value={text}
        spellCheck={false}
        autoComplete="off"
        aria-describedby={`${id}-preview`}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
      />
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('convert.naming.insert')}>
        {CHIPS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => insert(k)}
            title={t(`convert.naming.vars.${k}`)}
            className="h-7 rounded-sm border border-border bg-surface-2 px-2 font-mono text-caption text-text-2 transition-colors hover:border-border-strong hover:text-text max-sm:h-9"
          >
            {`{${k}}`}
          </button>
        ))}
      </div>
      <p id={`${id}-preview`} className="min-w-0 text-caption text-text-3">
        {t('convert.naming.preview')}
        <span className="break-all font-mono text-text-2">{example}</span>
      </p>
      {unknown.length > 0 && (
        <p className="text-caption text-warning-ink" role="status">
          {t('convert.naming.unknown', { vars: unknown.map((u) => `{${u}}`).join('、') })}
        </p>
      )}
      {options.template !== null && (
        <button
          type="button"
          onClick={() => setOptions({ template: null })}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-caption text-accent-ink hover:underline"
        >
          <RotateCcw size={12} aria-hidden />
          {t('convert.naming.follow', { pattern })}
        </button>
      )}
    </div>
  )
}
