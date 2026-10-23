import { AudioWaveform, Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Callout, SegmentedControl, Select, SliderField, Switch } from '@/components/ui'
import { formatBytes } from '@/lib/format'
import { useT } from '@/i18n'
import { usePlayer, useCurrent } from '../store'
import { ensureAudio } from '../actions'
import { EQ_BANDS, EQ_PRESETS, webAudioSupported, type EqPreset } from '../audio'
import { WAVEFORM_LIMIT } from '../engine'
import { useInfoRows } from './InfoOverlay'

export function InfoPanel() {
  const item = useCurrent()
  const rows = useInfoRows(item)
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-body">
      {rows.map(([k, v, numeric]) => (
        <div key={k} className="contents">
          <dt className="text-text-3">{k}</dt>
          <dd className={numeric ? 'break-all tabular-nums text-text' : 'break-all text-text'}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  )
}

interface TrackLike {
  id: string
  label: string
  language: string
  enabled: boolean
}
interface TrackListLike {
  length: number
  [i: number]: TrackLike
  addEventListener?: (t: string, f: () => void) => void
  removeEventListener?: (t: string, f: () => void) => void
}

/** 音軌選擇（只有支援 HTMLMediaElement.audioTracks 的瀏覽器才有） */
function AudioTracks() {
  const t = useT()
  const el = usePlayer((s) => s.el)
  const ready = usePlayer((s) => s.ready)
  const [tracks, setTracks] = useState<TrackLike[]>([])
  const supported =
    typeof HTMLMediaElement !== 'undefined' && 'audioTracks' in HTMLMediaElement.prototype
  useEffect(() => {
    if (!el || !supported) return
    const list = (el as unknown as { audioTracks?: TrackListLike }).audioTracks
    if (!list) return
    const read = () => {
      const out: TrackLike[] = []
      for (let i = 0; i < list.length; i++) out.push(list[i])
      setTracks(
        out.map((x) => ({ id: x.id, label: x.label, language: x.language, enabled: x.enabled })),
      )
    }
    const id = requestAnimationFrame(read)
    list.addEventListener?.('change', read)
    list.addEventListener?.('addtrack', read)
    return () => {
      cancelAnimationFrame(id)
      list.removeEventListener?.('change', read)
      list.removeEventListener?.('addtrack', read)
    }
  }, [el, supported, ready])
  if (!supported)
    return <p className="text-small text-text-3">{t('player.audio.tracksUnsupported')}</p>
  if (tracks.length < 2)
    return <p className="text-small text-text-3">{t('player.audio.tracksNone')}</p>
  const current = tracks.findIndex((x) => x.enabled)
  return (
    <Select
      label={t('player.audio.tracks')}
      value={String(Math.max(0, current))}
      onChange={(v) => enableTrack(el, Number(v))}
      options={tracks.map((x, i) => ({
        value: String(i),
        label: x.label || x.language || t('player.audio.track', { n: i + 1 }),
      }))}
    />
  )
}

/** 啟用第 index 條音軌（其餘停用） */
function enableTrack(el: HTMLMediaElement | null, index: number) {
  const list = (el as unknown as { audioTracks?: TrackListLike } | null)?.audioTracks
  if (!list) return
  for (let i = 0; i < list.length; i++) list[i].enabled = i === index
}

const fmtFreq = (f: number) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`)

export function AudioPanel() {
  const t = useT()
  const item = useCurrent()
  const eqEnabled = usePlayer((s) => s.eqEnabled)
  const gains = usePlayer((s) => s.eqGains)
  const waveformOn = usePlayer((s) => s.waveformOn)
  const visualizer = usePlayer((s) => s.visualizer)
  const peak = usePlayer((s) => (s.currentId ? s.peaks[s.currentId] : undefined))
  const set = usePlayer((s) => s.set)
  const supported = webAudioSupported()
  const preset = (Object.keys(EQ_PRESETS) as EqPreset[]).find((k) =>
    EQ_PRESETS[k].every((g, i) => g === gains[i]),
  )
  const status =
    peak === 'busy'
      ? t('player.audio.waveformBusy')
      : peak === 'large'
        ? t('player.audio.waveformTooLarge', {
            size: formatBytes(WAVEFORM_LIMIT[item?.kind ?? 'audio']),
          })
        : peak === 'error'
          ? t('player.audio.waveformFailed')
          : null
  return (
    <div className="flex flex-col gap-4">
      {!supported && <Callout tone="warning">{t('player.audio.noWebAudio')}</Callout>}
      <section className="flex flex-col gap-3">
        <Switch
          checked={eqEnabled}
          disabled={!supported}
          onChange={(v) => {
            ensureAudio()
            set({ eqEnabled: v })
          }}
          label={t('player.audio.eqEnable')}
        />
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t('player.audio.eqPreset')}
        >
          {(Object.keys(EQ_PRESETS) as EqPreset[]).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={preset === k && eqEnabled ? 'primary' : 'secondary'}
              aria-pressed={preset === k}
              disabled={!supported}
              onClick={() => {
                ensureAudio()
                set({ eqGains: [...EQ_PRESETS[k]], eqEnabled: true })
              }}
            >
              {t(`player.audio.${k}`)}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          {EQ_BANDS.map((f, i) => (
            <SliderField
              key={f}
              label={fmtFreq(f)}
              value={gains[i]}
              min={-12}
              max={12}
              step={1}
              disabled={!supported || !eqEnabled}
              format={(v) => `${v > 0 ? '+' : ''}${v} dB`}
              onChange={(v) => {
                ensureAudio()
                const next = gains.slice()
                next[i] = v
                set({ eqGains: next })
              }}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-3">
        <Switch
          checked={waveformOn}
          onChange={(v) => set({ waveformOn: v })}
          label={t('player.audio.waveform')}
          description={t('player.audio.waveformDesc')}
        />
        {status && waveformOn && (
          <p
            className="flex items-center gap-1.5 text-caption tabular-nums text-text-3"
            aria-live="polite"
          >
            <AudioWaveform size={14} aria-hidden />
            {status}
          </p>
        )}
        {item?.kind === 'audio' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-small font-medium text-text-2">
              {t('player.audio.visualizer')}
            </span>
            <SegmentedControl
              label={t('player.audio.visualizer')}
              value={visualizer}
              full
              onChange={(v) => set({ visualizer: v })}
              options={[
                { value: 'bars', label: t('player.audio.bars') },
                { value: 'wave', label: t('player.audio.wave') },
              ]}
            />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-3">
        <h4 className="flex items-center gap-1.5 text-small font-semibold text-text-2">
          <Info size={14} aria-hidden />
          {t('player.audio.tracks')}
        </h4>
        <AudioTracks />
      </section>
    </div>
  )
}
