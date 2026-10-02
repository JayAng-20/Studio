import { Captions, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useRef } from 'react'
import {
  Button,
  NumberField,
  SegmentedControl,
  Select,
  SliderField,
  Tooltip,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { DEFAULT_SUB_STYLE, usePlayer, useCurrent, type SubBg } from '../store'
import { loadSubtitle, removeSubtitle, setSubtitleEncoding } from '../actions'
import { MANUAL_ENCODINGS, type TextEncodingName } from '../logic/encoding'

const ENC_LABEL: Record<TextEncodingName, string> = {
  'utf-8': 'UTF‑8',
  'utf-16le': 'UTF‑16 LE',
  'utf-16be': 'UTF‑16 BE',
  big5: 'Big5',
  gb18030: 'GB18030',
  shift_jis: 'Shift_JIS',
  'windows-1252': 'Windows‑1252',
}

export function SubtitlePanel() {
  const t = useT()
  const item = useCurrent()
  const subsOn = usePlayer((s) => s.subsOn)
  const delay = usePlayer((s) => s.subDelay)
  const style = usePlayer((s) => s.subStyle)
  const input = useRef<HTMLInputElement>(null)
  const set = usePlayer((s) => s.set)
  const tracks = item?.subtitles ?? []
  const active = tracks.find((s) => s.id === item?.activeSub)
  const selected = subsOn && active ? active.id : 'off'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        {tracks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-6 text-center">
            <Captions size={22} className="text-accent-ink" aria-hidden />
            <p className="text-body font-medium">{t('player.subtitle.none')}</p>
            <p className="text-small text-text-3">{t('player.subtitle.noneDesc')}</p>
          </div>
        ) : (
          <div role="radiogroup" aria-label={t('player.subtitle.track')} className="flex flex-col gap-1">
            {[{ id: 'off', name: t('player.subtitle.off'), count: null as number | null }, ...tracks.map((s) => ({ id: s.id, name: s.name, count: s.cues.length }))].map((o) => {
              const checked = selected === o.id
              return (
                <div key={o.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => {
                      if (!item) return
                      if (o.id === 'off') set({ subsOn: false })
                      else {
                        usePlayer.getState().updateItem(item.id, { activeSub: o.id })
                        set({ subsOn: true })
                      }
                    }}
                    className={cn(
                      'flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 text-left transition-colors',
                      checked ? 'bg-[color-mix(in_srgb,var(--accent)_11%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]' : 'hover:bg-surface-2',
                    )}
                  >
                    <span className={cn('grid size-4 shrink-0 place-items-center rounded-full border-2', checked ? 'border-accent' : 'border-border-strong')}>
                      {checked && <span className="size-2 rounded-full bg-accent" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body">{o.name}</span>
                    {o.count !== null && <span className="shrink-0 text-caption tabular-nums text-text-3">{t('player.subtitle.cues', { count: o.count })}</span>}
                  </button>
                  {o.id !== 'off' && item && (
                    <Tooltip content={t('player.subtitle.remove')}>
                      <button
                        type="button"
                        aria-label={`${t('player.subtitle.remove')}：${o.name}`}
                        onClick={() => removeSubtitle(item.id, o.id)}
                        className="grid size-9 shrink-0 place-items-center rounded-sm text-text-3 hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-danger-ink"
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    </Tooltip>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <Button variant="secondary" size="sm" className="self-start" leading={<Upload size={15} aria-hidden />} onClick={() => input.current?.click()} disabled={!item}>
          {t('player.subtitle.load')}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".srt,.vtt,text/vtt"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files || [])
            e.target.value = ''
            for (const f of files) await loadSubtitle(f)
          }}
        />
      </div>

      {active && item && (
        <Select
          label={t('player.subtitle.encoding')}
          value={active.encoding}
          onChange={(v) => setSubtitleEncoding(item.id, active.id, v)}
          options={MANUAL_ENCODINGS.concat(MANUAL_ENCODINGS.includes(active.detected) ? [] : [active.detected]).map((e) => ({
            value: e,
            label: e === active.detected ? t('player.subtitle.encodingAuto', { enc: ENC_LABEL[e] }) : ENC_LABEL[e],
          }))}
        />
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-3">
        <NumberField
          label={t('player.subtitle.delay')}
          value={delay}
          step={0.1}
          min={-60}
          max={60}
          suffix={t('player.osd.seconds', { value: '' }).trim()}
          onChange={(v) => set({ subDelay: Math.round(v * 10) / 10 })}
        />
        <p className="-mt-2 text-caption text-text-3">{t('player.subtitle.delayHint')}</p>
        <SliderField
          label={t('player.subtitle.size')}
          value={Math.round(style.size * 100)}
          min={60}
          max={200}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => set({ subStyle: { ...style, size: v / 100 } })}
        />
        <SliderField
          label={t('player.subtitle.position')}
          value={style.position}
          min={0}
          max={40}
          step={1}
          format={(v) => `${v}%`}
          onChange={(v) => set({ subStyle: { ...style, position: v } })}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-small font-medium text-text-2">{t('player.subtitle.background')}</span>
          <SegmentedControl<SubBg>
            label={t('player.subtitle.background')}
            value={style.bg}
            full
            onChange={(bg) => set({ subStyle: { ...style, bg } })}
            options={[
              { value: 'none', label: t('player.subtitle.bgNone') },
              { value: 'shadow', label: t('player.subtitle.bgShadow') },
              { value: 'box', label: t('player.subtitle.bgBox') },
            ]}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          leading={<RotateCcw size={15} aria-hidden />}
          onClick={() => set({ subStyle: DEFAULT_SUB_STYLE, subDelay: 0 })}
        >
          {t('player.subtitle.reset')}
        </Button>
      </div>
    </div>
  )
}
