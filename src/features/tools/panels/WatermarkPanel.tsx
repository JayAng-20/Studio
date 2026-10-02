/** 浮水印：文字（系統字型，支援中文）或圖片；九宮格位置、透明度、旋轉、平鋪 */
import { ImagePlus } from 'lucide-react'
import { useCallback, useId, useRef, type KeyboardEvent } from 'react'
import { Button, ColorPicker, SegmentedControl, SliderField, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import type { Watermark } from '../lib/types'
import { processAllAfterApply } from '../actions'
import { useTools } from '../store'
import { Section, useEditor } from '../ui'
import { ApplyAllButton } from './common'

export function WatermarkPanel() {
  const t = useT()
  const id = useId()
  const { doc, state, edit } = useEditor()
  const docCount = useTools((s) => s.docs.length)
  const fileRef = useRef<HTMLInputElement>(null)
  if (!doc || !state) return null
  const wm = state.watermark
  const set = (patch: Partial<Watermark>, coalesce?: string) =>
    edit(
      t('tools.watermark.actions.edit'),
      (s) => ({ ...s, watermark: { ...s.watermark, ...patch } }),
      coalesce,
    )

  const onPos = (e: KeyboardEvent, i: number) => {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }
    const d = map[e.key]
    if (d === undefined) return
    e.preventDefault()
    const n = i + d
    if (n < 0 || n > 8 || (Math.abs(d) === 1 && Math.floor(n / 3) !== Math.floor(i / 3))) return
    set({ position: n })
    ;(e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus()
  }

  const applyAll = () => {
    const ids = useTools.getState().docs.map((d) => d.id)
    useTools
      .getState()
      .editMany(ids, t('tools.watermark.applyAll'), (s) => ({ ...s, watermark: { ...wm } }))
    void processAllAfterApply(t('tools.batch.taskApply', { count: ids.length }))
  }

  return (
    <div>
      <Section>
        <Switch
          label={t('tools.watermark.enable')}
          description={t('tools.watermark.enableDesc')}
          checked={wm.enabled}
          onChange={(v) =>
            edit(t('tools.watermark.actions.toggle'), (s) => ({
              ...s,
              watermark: { ...s.watermark, enabled: v, text: s.watermark.text || (v ? '© ' : '') },
            }))
          }
        />
      </Section>
      <fieldset
        disabled={!wm.enabled}
        className={cn('transition-opacity duration-(--dur-fast)', !wm.enabled && 'opacity-45')}
      >
        <Section title={t('tools.watermark.kind')}>
          <SegmentedControl
            full
            label={t('tools.watermark.kind')}
            value={wm.kind}
            onChange={(kind) => set({ kind })}
            options={[
              { value: 'text', label: t('tools.watermark.text'), disabled: !wm.enabled },
              { value: 'image', label: t('tools.watermark.image'), disabled: !wm.enabled },
            ]}
          />
          {wm.kind === 'text' ? (
            <>
              <div className="flex flex-col">
                <label htmlFor={`${id}-text`} className="label">
                  {t('tools.watermark.textLabel')}
                </label>
                <input
                  id={`${id}-text`}
                  className="field"
                  value={wm.text}
                  maxLength={120}
                  placeholder={t('tools.watermark.textPlaceholder')}
                  onChange={(e) => set({ text: e.target.value }, 'wm-text')}
                />
              </div>
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <ColorPicker
                  label={t('tools.watermark.color')}
                  value={wm.color}
                  onChange={(color) => set({ color })}
                />
                <div className="flex flex-col gap-2 pb-0.5">
                  <label className="flex items-center justify-end gap-2 text-small text-text-2">
                    {t('tools.watermark.bold')}
                    <Switch
                      ariaLabel={t('tools.watermark.bold')}
                      checked={wm.bold}
                      onChange={(bold) => set({ bold })}
                      disabled={!wm.enabled}
                    />
                  </label>
                  <label className="flex items-center justify-end gap-2 text-small text-text-2">
                    {t('tools.watermark.shadow')}
                    <Switch
                      ariaLabel={t('tools.watermark.shadow')}
                      checked={wm.shadow}
                      onChange={(shadow) => set({ shadow })}
                      disabled={!wm.enabled}
                    />
                  </label>
                </div>
              </div>
              <SliderField
                label={t('tools.watermark.size')}
                value={wm.textSize}
                min={1}
                max={30}
                step={0.5}
                format={(v) => `${v.toFixed(1)}%`}
                disabled={!wm.enabled}
                onChange={(v) => set({ textSize: v }, 'wm-size')}
              />
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="tl-checker grid size-14 shrink-0 place-items-center overflow-hidden rounded-md border border-border">
                  {wm.image ? (
                    <ObjectImg blob={wm.image} />
                  ) : (
                    <ImagePlus size={20} className="text-text-3" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                    {wm.image
                      ? t('tools.watermark.replaceImage')
                      : t('tools.watermark.chooseImage')}
                  </Button>
                  <p className="mt-1 truncate text-caption text-text-3">
                    {wm.imageName || t('tools.watermark.imageHint')}
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/webp,image/svg+xml,image/jpeg,image/gif"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) set({ image: f, imageName: f.name })
                  }}
                />
              </div>
              <SliderField
                label={t('tools.watermark.size')}
                value={wm.imageSize}
                min={3}
                max={90}
                format={(v) => `${Math.round(v)}%`}
                disabled={!wm.enabled}
                onChange={(v) => set({ imageSize: Math.round(v) }, 'wm-isize')}
              />
            </>
          )}
        </Section>

        <Section title={t('tools.watermark.position')}>
          <div className="flex items-start gap-4">
            <div
              role="radiogroup"
              aria-label={t('tools.watermark.position')}
              className={cn(
                'grid shrink-0 grid-cols-3 gap-1 rounded-md bg-surface-2 p-1',
                wm.tile && 'opacity-45',
              )}
            >
              {Array.from({ length: 9 }, (_, i) => {
                const sel = wm.position === i
                return (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    aria-label={t(
                      `tools.watermark.positions.p${i}` as 'tools.watermark.positions.p0',
                    )}
                    tabIndex={sel ? 0 : -1}
                    disabled={wm.tile || !wm.enabled}
                    onClick={() => set({ position: i })}
                    onKeyDown={(e) => onPos(e, i)}
                    className={cn(
                      'grid size-9 place-items-center rounded-sm transition-colors duration-(--dur-fast)',
                      sel ? 'bg-accent-strong' : 'hover:bg-surface-3',
                    )}
                  >
                    <span
                      className={cn(
                        'block size-2 rounded-full',
                        sel ? 'bg-on-accent' : 'bg-text-3',
                      )}
                    />
                  </button>
                )
              })}
            </div>
            <div className="min-w-0 flex-1">
              <SliderField
                label={t('tools.watermark.margin')}
                value={wm.margin}
                min={0}
                max={20}
                step={0.5}
                format={(v) => `${v.toFixed(1)}%`}
                disabled={wm.tile || !wm.enabled}
                onChange={(v) => set({ margin: v }, 'wm-margin')}
              />
            </div>
          </div>
          <SliderField
            label={t('tools.watermark.opacity')}
            value={wm.opacity}
            min={5}
            max={100}
            format={(v) => `${Math.round(v)}%`}
            disabled={!wm.enabled}
            onChange={(v) => set({ opacity: Math.round(v) }, 'wm-opacity')}
          />
          <SliderField
            label={t('tools.watermark.rotation')}
            value={wm.rotation}
            min={-90}
            max={90}
            format={(v) => `${Math.round(v)}°`}
            disabled={!wm.enabled}
            onChange={(v) => set({ rotation: Math.round(v) }, 'wm-rot')}
          />
          <Switch
            label={t('tools.watermark.tile')}
            description={t('tools.watermark.tileDesc')}
            checked={wm.tile}
            disabled={!wm.enabled}
            onChange={(tile) => set({ tile })}
          />
          {wm.tile && (
            <SliderField
              label={t('tools.watermark.gap')}
              value={wm.tileGap}
              min={0}
              max={60}
              format={(v) => `${Math.round(v)}%`}
              disabled={!wm.enabled}
              onChange={(v) => set({ tileGap: Math.round(v) }, 'wm-gap')}
            />
          )}
        </Section>
        {docCount > 1 && (
          <Section>
            <ApplyAllButton onClick={applyAll} label={t('tools.watermark.applyAll')} />
          </Section>
        )}
      </fieldset>
    </div>
  )
}

/** Blob 縮圖（自動釋放物件 URL） */
function ObjectImg({ blob }: { blob: Blob }) {
  const attach = useCallback(
    (el: HTMLImageElement | null) => {
      if (!el) return
      const url = URL.createObjectURL(blob)
      el.src = url
      return () => URL.revokeObjectURL(url)
    },
    [blob],
  )
  return <img ref={attach} alt="" className="max-h-full max-w-full object-contain" />
}
