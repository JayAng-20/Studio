import { AnimatePresence, motion } from 'motion/react'
import { Crop, Film, Info, Pipette, Plus, RotateCcw, Trash2, Type, Wand2 } from 'lucide-react'
import {
  Badge,
  Button,
  Callout,
  ColorPicker,
  RangeSlider,
  SegmentedControl,
  SliderField,
  Switch,
  Tabs,
} from '@/components/ui'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { spring } from '@/design/motion'
import { useGT } from '../useGT'
import { newTextLayer, useGifStore } from '../store'
import { cropRatioValue, fitCropToRatio, FULL_CROP, type CropRatio, type TextLayer } from '../settings'
import type { Geometry } from '../render'

export type EffectsTab = 'text' | 'crop' | 'chroma' | 'frames'

interface Props {
  geom: Geometry
  frameCount: number
  durationMs: number
  customPlan: boolean
  tab: EffectsTab
  onTab: (t: EffectsTab) => void
  selectedText: string | null
  onSelectText: (id: string | null) => void
  picking: boolean
  onPicking: (on: boolean) => void
  onOpenEditor: () => void
}

/** 效果與編輯：文字疊加、裁切、色鍵去背、影格 */
export function EffectsPanel(p: Props) {
  const t = useGT()
  const texts = useGifStore((s) => s.texts)
  const chroma = useGifStore((s) => s.chroma)
  const crop = useGifStore((s) => s.crop)
  const cropped = crop.x !== 0 || crop.y !== 0 || crop.w !== 1 || crop.h !== 1
  const dot = <span aria-hidden className="size-1.5 rounded-full bg-accent" />
  return (
    <section className="card p-4 sm:p-5" aria-label={t('effects.title')}>
      <Tabs<EffectsTab>
        value={p.tab}
        onChange={p.onTab}
        label={t('effects.title')}
        listClassName="overflow-x-auto"
        items={[
          {
            value: 'text',
            label: (
              <>
                <Type size={16} aria-hidden className="max-sm:hidden" />
                {t('effects.tabs.text')}
                {texts.length > 0 && <Badge className="h-5 px-1.5">{texts.length}</Badge>}
              </>
            ),
          },
          {
            value: 'crop',
            label: (
              <>
                <Crop size={16} aria-hidden className="max-sm:hidden" />
                {t('effects.tabs.crop')}
                {cropped && dot}
              </>
            ),
          },
          {
            value: 'chroma',
            label: (
              <>
                <Wand2 size={16} aria-hidden className="max-sm:hidden" />
                {t('effects.tabs.chroma')}
                {chroma.enabled && dot}
              </>
            ),
          },
          {
            value: 'frames',
            label: (
              <>
                <Film size={16} aria-hidden className="max-sm:hidden" />
                {t('effects.tabs.frames')}
                {p.customPlan && dot}
              </>
            ),
          },
        ]}
      >
        <div className="pt-4">
          {p.tab === 'text' && <TextTab {...p} />}
          {p.tab === 'crop' && <CropTab geom={p.geom} />}
          {p.tab === 'chroma' && <ChromaTab picking={p.picking} onPicking={p.onPicking} />}
          {p.tab === 'frames' && <FramesTab {...p} />}
        </div>
      </Tabs>
    </section>
  )
}

function TextTab({ durationMs, selectedText, onSelectText }: Props) {
  const t = useGT()
  const texts = useGifStore((s) => s.texts)
  const setTexts = useGifStore((s) => s.setTexts)
  const total = Math.max(0.1, durationMs / 1000)
  const add = () => {
    const layer = newTextLayer(t('text.defaultText'))
    // 多層文字時錯開位置，避免完全重疊
    layer.y = texts.length % 2 ? 0.16 : 0.84
    setTexts([...texts, layer])
    onSelectText(layer.id)
  }
  return (
    <div className="flex flex-col gap-3">
      {texts.length === 0 && <p className="text-body text-text-2">{t('text.empty')}</p>}
      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {texts.map((layer, i) => (
            <motion.li
              key={layer.id}
              layout="position"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={spring.smooth}
            >
              <TextLayerEditor
                layer={layer}
                index={i}
                total={total}
                open={selectedText === layer.id}
                onToggle={() => onSelectText(selectedText === layer.id ? null : layer.id)}
                onRemove={() => {
                  setTexts(texts.filter((x) => x.id !== layer.id))
                  if (selectedText === layer.id) onSelectText(null)
                }}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" leading={<Plus size={16} aria-hidden />} onClick={add}>
          {t('text.add')}
        </Button>
        {texts.length > 0 && <span className="text-caption text-text-3">{t('preview.textHint')}</span>}
      </div>
    </div>
  )
}

function TextLayerEditor({
  layer,
  index,
  total,
  open,
  onToggle,
  onRemove,
}: {
  layer: TextLayer
  index: number
  total: number
  open: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  const t = useGT()
  const update = useGifStore((s) => s.updateText)
  const set = (patch: Partial<TextLayer>) => update(layer.id, patch)
  const end = layer.end === null ? total : Math.min(total, layer.end)
  const start = Math.min(layer.start, Math.max(0, end - 0.1))
  const pos = layer.y < 0.34 ? 'top' : layer.y > 0.66 ? 'bottom' : 'middle'
  const id = `gif-text-${layer.id}`
  return (
    <div className={cn('rounded-md border border-border bg-surface-2/60', open && 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)]')}>
      <div className="flex items-center gap-2 p-1.5 pl-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={id}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-sm text-left"
        >
          <span className="shrink-0 text-caption font-semibold text-text-3">{t('text.layer', { index: index + 1 })}</span>
          <span className="truncate text-body text-text">{layer.text || '—'}</span>
        </button>
        <Button variant="ghost" icon size="sm" aria-label={t('text.remove')} onClick={onRemove}>
          <Trash2 size={16} aria-hidden />
        </Button>
      </div>
      {open && (
        <div id={id} className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
          <label className="flex flex-col sm:col-span-2">
            <span className="label">{t('text.content')}</span>
            <textarea
              className="field"
              rows={2}
              value={layer.text}
              onChange={(e) => set({ text: e.target.value })}
            />
          </label>
          <SliderField
            label={t('text.size')}
            value={Math.round(layer.size * 100)}
            min={4}
            max={30}
            format={(v) => `${v}%`}
            onChange={(v) => set({ size: v / 100 })}
          />
          <SliderField
            label={t('text.stroke')}
            value={Math.round(layer.stroke * 100)}
            min={0}
            max={25}
            format={(v) => `${v}%`}
            onChange={(v) => set({ stroke: v / 100 })}
          />
          <ColorPicker label={t('text.color')} value={layer.color} onChange={(color) => set({ color })} />
          <ColorPicker
            label={t('text.strokeColor')}
            value={layer.strokeColor}
            onChange={(strokeColor) => set({ strokeColor })}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-small font-medium text-text-2">{t('text.position')}</span>
            <SegmentedControl<'top' | 'middle' | 'bottom'>
              full
              size="sm"
              label={t('text.position')}
              value={pos}
              onChange={(v) => set({ x: 0.5, y: v === 'top' ? 0.16 : v === 'middle' ? 0.5 : 0.84 })}
              options={[
                { value: 'top', label: t('text.positions.top') },
                { value: 'middle', label: t('text.positions.middle') },
                { value: 'bottom', label: t('text.positions.bottom') },
              ]}
            />
          </div>
          <div className="flex items-end">
            <Switch label={t('text.bold')} checked={layer.bold} onChange={(bold) => set({ bold })} className="w-full" />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-small font-medium text-text-2">{t('text.time')}</span>
              <span className="text-small tabular-nums text-text">
                {t('text.timeValue', {
                  start: formatTime(start, { tenths: true }),
                  end: formatTime(end, { tenths: true }),
                })}
              </span>
            </div>
            <RangeSlider
              value={[start, end]}
              max={total}
              step={0.1}
              minGap={0.1}
              format={(v) => formatTime(v, { tenths: true })}
              onChange={([s, e]) => set({ start: s, end: e >= total - 0.05 ? null : e })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function CropTab({ geom }: { geom: Geometry }) {
  const t = useGT()
  const crop = useGifStore((s) => s.crop)
  const ratio = useGifStore((s) => s.cropRatio)
  const setCrop = useGifStore((s) => s.setCrop)
  const setRatio = useGifStore((s) => s.setCropRatio)
  const ratios: CropRatio[] = ['free', 'original', 'square', 'r43', 'r169', 'r916']
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-small font-medium text-text-2">{t('crop.ratio')}</span>
        <div className="overflow-x-auto">
          <SegmentedControl<CropRatio>
            size="sm"
            label={t('crop.ratio')}
            value={ratio}
            onChange={(r) => {
              setRatio(r)
              setCrop(fitCropToRatio(cropRatioValue(r, geom.baseW, geom.baseH), geom.baseW, geom.baseH, crop))
            }}
            options={ratios.map((r) => ({ value: r, label: t(`crop.ratios.${r}`) }))}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-small tabular-nums text-text-2">
          {t('crop.size', {
            w: Math.round(crop.w * geom.baseW),
            h: Math.round(crop.h * geom.baseH),
          })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          leading={<RotateCcw size={14} aria-hidden />}
          onClick={() => {
            setRatio('free')
            setCrop(FULL_CROP)
          }}
        >
          {t('crop.reset')}
        </Button>
      </div>
      <p className="text-caption text-text-3">{t('preview.cropHint')}</p>
    </div>
  )
}

function ChromaTab({ picking, onPicking }: { picking: boolean; onPicking: (on: boolean) => void }) {
  const t = useGT()
  const chroma = useGifStore((s) => s.chroma)
  const setChroma = useGifStore((s) => s.setChroma)
  const format = useGifStore((s) => s.settings.format)
  return (
    <div className="flex flex-col gap-4">
      <Switch
        label={t('chroma.enable')}
        description={t('chroma.enableDesc')}
        checked={chroma.enabled}
        onChange={(enabled) => {
          setChroma({ enabled })
          if (!enabled) onPicking(false)
        }}
      />
      <div className={cn('grid gap-4 sm:grid-cols-2', !chroma.enabled && 'pointer-events-none opacity-45')} aria-disabled={!chroma.enabled}>
        <div className="flex flex-col gap-2">
          <ColorPicker label={t('chroma.color')} value={chroma.color} onChange={(color) => setChroma({ color })} />
          <Button
            variant={picking ? 'primary' : 'secondary'}
            size="sm"
            leading={<Pipette size={14} aria-hidden />}
            aria-pressed={picking}
            onClick={() => onPicking(!picking)}
            disabled={!chroma.enabled}
          >
            {picking ? t('chroma.picking') : t('chroma.pick')}
          </Button>
        </div>
        <SliderField
          label={t('chroma.tolerance')}
          value={chroma.tolerance}
          min={1}
          max={100}
          disabled={!chroma.enabled}
          onChange={(tolerance) => setChroma({ tolerance })}
        />
      </div>
      {chroma.enabled && format === 'gif' && (
        <Callout tone="neutral" icon={<Info size={16} aria-hidden />}>
          {t('chroma.gifNote')}
        </Callout>
      )}
    </div>
  )
}

function FramesTab({ frameCount, durationMs, customPlan, onOpenEditor }: Props) {
  const t = useGT()
  const setCustomPlan = useGifStore((s) => s.setCustomPlan)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body font-medium tabular-nums text-text">
          {t('frames.summary', { count: frameCount, duration: formatTime(durationMs / 1000, { tenths: true }) })}
        </span>
        {customPlan && <Badge tone="accent">{t('frames.customized')}</Badge>}
      </div>
      {!customPlan && <p className="text-small text-text-2">{t('frames.autoDesc')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" leading={<Film size={16} aria-hidden />} onClick={onOpenEditor}>
          {t('actions.openEditor')}
        </Button>
        {customPlan && (
          <Button variant="ghost" leading={<RotateCcw size={16} aria-hidden />} onClick={() => setCustomPlan(null)}>
            {t('actions.restoreAuto')}
          </Button>
        )}
      </div>
    </div>
  )
}
