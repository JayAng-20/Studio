import { useState } from 'react'
import {
  Badge,
  Callout,
  ColorPicker,
  NumberField,
  SegmentedControl,
  Select,
  SliderField,
  Switch,
  Tabs,
} from '@/components/ui'
import { Info } from 'lucide-react'
import { useGT } from '../useGT'
import { useGifStore } from '../store'
import {
  COLORS_MAX,
  COLORS_MIN,
  WIDTH_MAX,
  WIDTH_MIN,
  WIDTH_PRESETS,
  matchPreset,
  type OutputFormat,
  type PresetId,
  type WidthPreset,
} from '../settings'
import { FPS_OPTIONS, SPEED_MAX, SPEED_MIN, type Fps } from '../timeline'
import type { Geometry } from '../render'
import type { DitherMode } from '../dither'
import { ChipGrid } from './ChipGrid'

type Tab = 'basic' | 'playback' | 'quality'

/** 右側參數面板：品質預設、格式、基本／播放／畫質 */
export function SettingsPanel({ geom }: { geom: Geometry }) {
  const t = useGT()
  const settings = useGifStore((s) => s.settings)
  const patch = useGifStore((s) => s.patch)
  const applyPreset = useGifStore((s) => s.applyPreset)
  const isImages = useGifStore((s) => s.source?.kind === 'images')
  const [tab, setTab] = useState<Tab>('basic')
  const preset = matchPreset(settings)
  const fullColor = settings.format !== 'gif'

  const widthPreset: WidthPreset | 'original' | '' =
    settings.width === 'original'
      ? 'original'
      : ((Object.keys(WIDTH_PRESETS) as WidthPreset[]).find(
          (k) => WIDTH_PRESETS[k] === settings.width,
        ) ?? '')

  return (
    <section className="card flex flex-col gap-4 p-4" aria-label={t('panel.preset')}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-small font-medium text-text-2">{t('panel.preset')}</span>
          {!preset && <Badge tone="accent">{t('panel.custom')}</Badge>}
        </div>
        <SegmentedControl<PresetId | 'custom'>
          full
          label={t('panel.preset')}
          value={preset ?? 'custom'}
          onChange={(v) => v !== 'custom' && applyPreset(v)}
          options={(['small', 'balanced', 'high'] as const).map((id) => ({
            value: id,
            label: t(`panel.presets.${id}`),
          }))}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Select<OutputFormat>
          label={t('panel.format')}
          value={settings.format}
          onChange={(format) => patch({ format })}
          options={(['gif', 'apng', 'webp'] as const).map((f) => ({
            value: f,
            label: t(`panel.formats.${f}`),
            hint: t(`panel.formatHints.${f}`),
          }))}
        />
        <p className="text-caption text-text-3">{t(`panel.formatHints.${settings.format}`)}</p>
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        label={t('panel.preset')}
        fullWidth
        items={[
          { value: 'basic', label: t('panel.tabs.basic') },
          { value: 'playback', label: t('panel.tabs.playback') },
          { value: 'quality', label: t('panel.tabs.quality') },
        ]}
      >
        <div className="flex flex-col gap-4 pt-4">
          {tab === 'basic' && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-small font-medium text-text-2">
                  {isImages ? t('panel.fpsImages') : t('panel.fps')}
                </span>
                <ChipGrid<Fps>
                  label={isImages ? t('panel.fpsImages') : t('panel.fps')}
                  value={settings.fps}
                  onChange={(fps) => patch({ fps })}
                  options={FPS_OPTIONS.map((f) => ({ value: f, label: f }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-small font-medium text-text-2">{t('panel.width')}</span>
                  <span className="text-caption tabular-nums text-text-3">
                    {t('panel.outputSize', { w: geom.outW, h: geom.outH })}
                  </span>
                </div>
                <SegmentedControl<WidthPreset | 'original' | ''>
                  full
                  label={t('panel.width')}
                  value={widthPreset}
                  onChange={(v) =>
                    v && patch({ width: v === 'original' ? 'original' : WIDTH_PRESETS[v] })
                  }
                  options={[
                    ...(Object.keys(WIDTH_PRESETS) as WidthPreset[]).map((k) => ({
                      value: k,
                      label: t(`panel.widths.${k}`),
                      title: `${WIDTH_PRESETS[k]} px`,
                    })),
                    { value: 'original' as const, label: t('panel.widths.original') },
                  ]}
                />
                <NumberField
                  label={t('panel.customWidth')}
                  value={settings.width === 'original' ? geom.outW : settings.width}
                  min={WIDTH_MIN}
                  max={WIDTH_MAX}
                  step={10}
                  suffix="px"
                  size="sm"
                  onChange={(v) => patch({ width: Math.round(v) })}
                />
              </div>
              {isImages && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-small font-medium text-text-2">{t('panel.fit')}</span>
                    <SegmentedControl
                      full
                      label={t('panel.fit')}
                      value={settings.fit}
                      onChange={(fit) => patch({ fit })}
                      options={[
                        { value: 'contain', label: t('panel.fits.contain') },
                        { value: 'cover', label: t('panel.fits.cover') },
                      ]}
                    />
                  </div>
                  <ColorPicker
                    label={t('panel.background')}
                    value={settings.background}
                    onChange={(background) => patch({ background })}
                  />
                </>
              )}
            </>
          )}

          {tab === 'playback' && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-small font-medium text-text-2">{t('panel.loop')}</span>
                <SegmentedControl<'infinite' | 'count'>
                  full
                  label={t('panel.loop')}
                  value={settings.loop === 'infinite' ? 'infinite' : 'count'}
                  onChange={(v) => patch({ loop: v === 'infinite' ? 'infinite' : 3 })}
                  options={[
                    { value: 'infinite', label: t('panel.loopInfinite') },
                    { value: 'count', label: t('panel.loopCount') },
                  ]}
                />
                {settings.loop !== 'infinite' && (
                  <NumberField
                    label={t('panel.loopTimes')}
                    value={settings.loop}
                    min={1}
                    max={99}
                    size="sm"
                    onChange={(v) => patch({ loop: Math.round(v) })}
                  />
                )}
              </div>
              <SliderField
                label={t('panel.speed')}
                value={settings.speed}
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={0.1}
                format={(v) => t('panel.speedValue', { value: v.toFixed(1) })}
                onChange={(v) => patch({ speed: Math.round(v * 10) / 10 })}
              />
              <Switch
                label={t('panel.reverse')}
                description={t('panel.reverseDesc')}
                checked={settings.reverse}
                onChange={(reverse) => patch({ reverse })}
              />
              <Switch
                label={t('panel.pingpong')}
                description={t('panel.pingpongDesc')}
                checked={settings.pingpong}
                onChange={(pingpong) => patch({ pingpong })}
              />
            </>
          )}

          {tab === 'quality' && (
            <>
              {fullColor && (
                <Callout tone="neutral" icon={<Info size={16} aria-hidden />}>
                  {t('panel.fullColorNote', { format: t(`panel.formats.${settings.format}`) })}
                </Callout>
              )}
              {settings.format === 'gif' && (
                <>
                  <SliderField
                    label={t('panel.colors')}
                    value={settings.colors}
                    min={COLORS_MIN}
                    max={COLORS_MAX}
                    step={8}
                    onChange={(colors) => patch({ colors })}
                  />
                  <div className="flex flex-col gap-1.5">
                    <span className="text-small font-medium text-text-2">{t('panel.dither')}</span>
                    <SegmentedControl<DitherMode>
                      full
                      label={t('panel.dither')}
                      value={settings.dither}
                      onChange={(dither) => patch({ dither })}
                      options={(['none', 'fs', 'bayer'] as const).map((d) => ({
                        value: d,
                        label: t(`panel.dithers.${d}`),
                      }))}
                    />
                    <p className="text-caption text-text-3">
                      {t(`panel.ditherHints.${settings.dither}`)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-small font-medium text-text-2">{t('panel.palette')}</span>
                    <SegmentedControl
                      full
                      label={t('panel.palette')}
                      value={settings.palette}
                      onChange={(palette) => patch({ palette })}
                      options={[
                        { value: 'global', label: t('panel.palettes.global') },
                        { value: 'frame', label: t('panel.palettes.frame') },
                      ]}
                    />
                    <p className="text-caption text-text-3">
                      {t(`panel.paletteHints.${settings.palette}`)}
                    </p>
                  </div>
                  <Switch
                    label={t('panel.optimize')}
                    description={t('panel.optimizeDesc')}
                    checked={settings.optimize}
                    onChange={(optimize) => patch({ optimize })}
                  />
                </>
              )}
              {settings.format === 'webp' && (
                <>
                  <SliderField
                    label={t('panel.webpQuality')}
                    value={settings.webpQuality}
                    min={40}
                    max={100}
                    step={1}
                    disabled={settings.webpLossless}
                    onChange={(webpQuality) => patch({ webpQuality })}
                  />
                  <Switch
                    label={t('panel.webpLossless')}
                    description={t('panel.webpLosslessDesc')}
                    checked={settings.webpLossless}
                    onChange={(webpLossless) => patch({ webpLossless })}
                  />
                </>
              )}
            </>
          )}
        </div>
      </Tabs>
    </section>
  )
}
