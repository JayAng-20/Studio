/** 裁切與尺寸：比例、旋轉翻轉、拉直、輸出尺寸與常用尺寸 */
import {
  FlipHorizontal2,
  FlipVertical2,
  Link2,
  RotateCcw,
  RotateCw,
  Unlink2,
  ArrowLeftRight,
  Undo2,
} from 'lucide-react'
import {
  Button,
  Callout,
  NumberField,
  SegmentedControl,
  SliderField,
  Tooltip,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import {
  aspectFlippable,
  aspectRatioOf,
  cropRect,
  fitAspect,
  flipState,
  frameOf,
  isFullRect,
  MAX_SIDE,
  outputSize,
  rotateState,
} from '../lib/geometry'
import { applyResizeTo } from '../lib/state'
import type { AspectId, EditState } from '../lib/types'
import { processAllAfterApply } from '../actions'
import { useTools } from '../store'
import { Section, useEditor } from '../ui'
import { ApplyAllButton } from './common'

const ASPECT_LIST: AspectId[] = ['free', 'original', '1:1', '4:3', '3:2', '16:9', '9:16', 'custom']

export const PRESETS = [
  { id: 'igSquare', w: 1080, h: 1080 },
  { id: 'igPortrait', w: 1080, h: 1350 },
  { id: 'igStory', w: 1080, h: 1920 },
  { id: 'youtube', w: 1280, h: 720 },
  { id: 'fullHd', w: 1920, h: 1080 },
  { id: 'avatar', w: 400, h: 400 },
  { id: 'fbCover', w: 1640, h: 624 },
  { id: 'xPost', w: 1600, h: 900 },
] as const

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/** 依比例找對應的比例 id（自訂時回傳約分後的比例） */
function aspectFor(
  w: number,
  h: number,
): Pick<EditState, 'aspect' | 'aspectFlip' | 'customAspect'> {
  const g = gcd(w, h)
  const a = w / g
  const b = h / g
  const key = `${a}:${b}`
  if (key === '1:1' || key === '16:9' || key === '9:16')
    return { aspect: key, aspectFlip: false, customAspect: [a, b] }
  if (key === '4:3' || key === '3:2')
    return { aspect: key, aspectFlip: false, customAspect: [a, b] }
  if (key === '3:4') return { aspect: '4:3', aspectFlip: true, customAspect: [a, b] }
  if (key === '2:3') return { aspect: '3:2', aspectFlip: true, customAspect: [a, b] }
  return { aspect: 'custom', aspectFlip: false, customAspect: [a, b] }
}

export function CropPanel() {
  const t = useT()
  const { doc, state, edit } = useEditor()
  const docCount = useTools((s) => s.docs.length)
  if (!doc || !state) return null
  const { srcW, srcH } = doc
  const frame = frameOf(state.geometry, srcW, srcH)
  const crop = cropRect(state.geometry, srcW, srcH)
  const out = outputSize(state, srcW, srcH)
  const L = (k: Parameters<typeof t>[0]) => t(k)

  const setAspect = (a: AspectId) =>
    edit(L('tools.crop.actions.aspect'), (s) => {
      const flip = a === s.aspect ? s.aspectFlip : false
      const ratio = aspectRatioOf(a, s.customAspect, flip, frame.w, frame.h)
      let next = s.geometry.crop
      if (ratio) {
        const r = fitAspect(ratio, frame.w, frame.h, crop)
        next = isFullRect(r, frame.w, frame.h, 1) ? null : roundRect(r)
      }
      return { ...s, aspect: a, aspectFlip: flip, geometry: { ...s.geometry, crop: next } }
    })

  const setCustom = (i: 0 | 1, v: number) =>
    edit(
      L('tools.crop.actions.aspect'),
      (s) => {
        const custom: [number, number] = i === 0 ? [v, s.customAspect[1]] : [s.customAspect[0], v]
        const ratio = aspectRatioOf('custom', custom, s.aspectFlip, frame.w, frame.h)
        const r = ratio ? fitAspect(ratio, frame.w, frame.h, crop) : null
        return {
          ...s,
          aspect: 'custom',
          customAspect: custom,
          geometry: {
            ...s.geometry,
            crop: r && !isFullRect(r, frame.w, frame.h, 1) ? roundRect(r) : null,
          },
        }
      },
      'custom-aspect',
    )

  const swap = () =>
    edit(L('tools.crop.actions.aspect'), (s) => {
      const flip = !s.aspectFlip
      const ratio = aspectRatioOf(s.aspect, s.customAspect, flip, frame.w, frame.h)
      const r = ratio ? fitAspect(ratio, frame.w, frame.h, crop) : null
      return {
        ...s,
        aspectFlip: flip,
        geometry: {
          ...s.geometry,
          crop: r && !isFullRect(r, frame.w, frame.h, 1) ? roundRect(r) : s.geometry.crop,
        },
      }
    })

  const rotate = (dir: 1 | -1) =>
    edit(L('tools.crop.actions.rotate'), (s) => rotateState(s, srcW, srcH, dir))
  const flip = (axis: 'h' | 'v') =>
    edit(L('tools.crop.actions.flip'), (s) => flipState(s, srcW, srcH, axis))

  const resizeMode = state.resize?.mode === 'percent' ? 'percent' : 'px'
  const lock = state.resize?.mode === 'px' ? state.resize.lock : true
  const percent =
    state.resize?.mode === 'percent' ? state.resize.percent : Math.round((out.w / crop.w) * 100)

  const setPx = (w: number, h: number, lk: boolean) =>
    edit(
      L('tools.crop.actions.resize'),
      (s) => ({
        ...s,
        resize: { mode: 'px', width: Math.round(w), height: Math.round(h), lock: lk },
      }),
      'resize',
    )
  const setWidth = (w: number) => setPx(w, lock ? (w * crop.h) / crop.w : out.h, lock)
  const setHeight = (h: number) => setPx(lock ? (h * crop.w) / crop.h : out.w, h, lock)
  const setPercent = (p: number) =>
    edit(
      L('tools.crop.actions.resize'),
      (s) => ({ ...s, resize: { mode: 'percent', percent: p } }),
      'resize',
    )

  const applyPreset = (w: number, h: number) =>
    edit(L('tools.crop.actions.preset'), (s) => {
      const a = aspectFor(w, h)
      const r = fitAspect(w / h, frame.w, frame.h, crop)
      return {
        ...s,
        ...a,
        geometry: { ...s.geometry, crop: isFullRect(r, frame.w, frame.h, 1) ? null : roundRect(r) },
        resize: { mode: 'px', width: w, height: h, lock: true },
      }
    })

  const upscale = out.w > crop.w * 1.01 || out.h > crop.h * 1.01
  const mp = (out.w * out.h) / 1e6
  const activePreset = PRESETS.find(
    (p) => state.resize?.mode === 'px' && state.resize.width === p.w && state.resize.height === p.h,
  )

  const applyAll = () => {
    const ids = useTools.getState().docs.map((d) => d.id)
    useTools
      .getState()
      .editMany(ids, t('tools.crop.applyAll'), (s, d) =>
        d.id === doc.id ? s : applyResizeTo(state, s, srcW, srcH, d.srcW, d.srcH),
      )
    void processAllAfterApply(t('tools.batch.taskApply', { count: ids.length }))
  }

  const ratioLabel = (a: AspectId) => {
    if (a === 'free') return t('tools.crop.free')
    if (a === 'original') return t('tools.crop.original')
    if (a === 'custom') return t('tools.crop.custom')
    if (state.aspect === a && state.aspectFlip && aspectFlippable(a))
      return a.split(':').reverse().join(':')
    return a
  }

  return (
    <div>
      <Section
        title={t('tools.crop.aspect')}
        action={
          <Button
            variant="ghost"
            size="sm"
            leading={<Undo2 size={14} aria-hidden />}
            disabled={!state.geometry.crop}
            onClick={() =>
              edit(L('tools.crop.actions.resetCrop'), (s) => ({
                ...s,
                aspect: 'free',
                aspectFlip: false,
                geometry: { ...s.geometry, crop: null },
              }))
            }
          >
            {t('tools.crop.reset')}
          </Button>
        }
      >
        <div
          role="radiogroup"
          aria-label={t('tools.crop.aspect')}
          className="grid grid-cols-4 gap-1.5"
        >
          {ASPECT_LIST.map((a) => {
            const selected = state.aspect === a
            const r = aspectRatioOf(
              a,
              state.customAspect,
              selected && state.aspectFlip,
              frame.w,
              frame.h,
            )
            return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setAspect(a)}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-caption font-medium transition-colors duration-(--dur-fast)',
                  selected
                    ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-accent-ink'
                    : 'border-border text-text-2 hover:border-border-strong hover:text-text',
                )}
              >
                <RatioGlyph ratio={r} free={a === 'free'} />
                <span className="tabular-nums">{ratioLabel(a)}</span>
              </button>
            )
          })}
        </div>
        {state.aspect === 'custom' && (
          <div className="flex items-end gap-2">
            <NumberField
              size="sm"
              label={t('tools.crop.customW')}
              value={state.customAspect[0]}
              min={1}
              max={100}
              onChange={(v) => setCustom(0, v)}
              className="flex-1"
            />
            <span className="pb-1.5 text-text-3">:</span>
            <NumberField
              size="sm"
              label={t('tools.crop.customH')}
              value={state.customAspect[1]}
              min={1}
              max={100}
              onChange={(v) => setCustom(1, v)}
              className="flex-1"
            />
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-small text-text-2">
          <span className="tabular-nums">
            {t('tools.crop.size', { w: Math.round(crop.w), h: Math.round(crop.h) })}
          </span>
          {aspectFlippable(state.aspect) && (
            <Button
              variant="ghost"
              size="sm"
              leading={<ArrowLeftRight size={14} aria-hidden />}
              onClick={swap}
            >
              {t('tools.crop.swap')}
            </Button>
          )}
        </div>
      </Section>

      <Section title={t('tools.crop.rotate')}>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            {
              label: t('tools.crop.rotateLeft'),
              icon: <RotateCcw size={18} aria-hidden />,
              on: () => rotate(-1),
              kbd: undefined,
            },
            {
              label: t('tools.crop.rotateRight'),
              icon: <RotateCw size={18} aria-hidden />,
              on: () => rotate(1),
              kbd: 'R',
            },
            {
              label: t('tools.crop.flipH'),
              icon: <FlipHorizontal2 size={18} aria-hidden />,
              on: () => flip('h'),
              kbd: undefined,
            },
            {
              label: t('tools.crop.flipV'),
              icon: <FlipVertical2 size={18} aria-hidden />,
              on: () => flip('v'),
              kbd: undefined,
            },
          ].map((b) => (
            <Tooltip key={b.label} content={b.label} shortcut={b.kbd}>
              <Button
                variant="secondary"
                aria-label={b.label}
                onClick={b.on}
                className="h-11 w-full px-0"
              >
                {b.icon}
              </Button>
            </Tooltip>
          ))}
        </div>
        <div
          onDoubleClick={() =>
            edit(L('tools.crop.actions.straighten'), (s) => ({
              ...s,
              geometry: { ...s.geometry, angle: 0 },
            }))
          }
        >
          <SliderField
            label={t('tools.crop.straighten')}
            value={state.geometry.angle}
            min={-45}
            max={45}
            step={0.1}
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`}
            onChange={(v) =>
              edit(
                L('tools.crop.actions.straighten'),
                (s) => ({ ...s, geometry: { ...s.geometry, angle: Math.round(v * 10) / 10 } }),
                'angle',
              )
            }
            hint={t('tools.crop.straightenHint')}
          />
        </div>
      </Section>

      <Section
        title={t('tools.crop.resize')}
        action={
          <Button
            variant="ghost"
            size="sm"
            leading={<Undo2 size={14} aria-hidden />}
            disabled={!state.resize}
            onClick={() => edit(L('tools.crop.actions.resize'), (s) => ({ ...s, resize: null }))}
          >
            {t('tools.crop.resetSize')}
          </Button>
        }
      >
        <SegmentedControl
          full
          label={t('tools.crop.resize')}
          value={resizeMode}
          onChange={(m) => (m === 'percent' ? setPercent(percent) : setPx(out.w, out.h, lock))}
          options={[
            { value: 'px', label: t('tools.crop.px') },
            { value: 'percent', label: t('tools.crop.percent') },
          ]}
        />
        {resizeMode === 'px' ? (
          <div className="flex items-end gap-1.5">
            <NumberField
              label={t('tools.crop.width')}
              value={out.w}
              min={1}
              max={MAX_SIDE}
              onChange={setWidth}
              suffix="px"
              className="flex-1"
            />
            <Tooltip content={lock ? t('tools.crop.unlock') : t('tools.crop.lock')}>
              <Button
                variant={lock ? 'secondary' : 'ghost'}
                icon
                aria-label={lock ? t('tools.crop.unlock') : t('tools.crop.lock')}
                aria-pressed={lock}
                onClick={() => setPx(out.w, lock ? out.h : (out.w * crop.h) / crop.w, !lock)}
                className={cn('mb-0 shrink-0', lock && 'text-accent-ink')}
              >
                {lock ? <Link2 size={16} aria-hidden /> : <Unlink2 size={16} aria-hidden />}
              </Button>
            </Tooltip>
            <NumberField
              label={t('tools.crop.height')}
              value={out.h}
              min={1}
              max={MAX_SIDE}
              onChange={setHeight}
              suffix="px"
              className="flex-1"
            />
          </div>
        ) : (
          <SliderField
            label={t('tools.crop.scale')}
            value={percent}
            min={1}
            max={200}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => setPercent(Math.round(v))}
          />
        )}
        <p className="text-small tabular-nums text-text-2" aria-live="polite">
          {t('tools.crop.output', { w: out.w, h: out.h })}
        </p>
        {upscale && (
          <Callout tone="neutral" className="py-2">
            {t('tools.crop.upscaleWarn')}
          </Callout>
        )}
        {mp > 50 && (
          <Callout tone="warning" className="py-2">
            {t('tools.crop.hugeWarn', { mp: Math.round(mp) })}
          </Callout>
        )}
        <div>
          <p className="label">{t('tools.crop.presets')}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={activePreset?.id === p.id}
                onClick={() => applyPreset(p.w, p.h)}
                className={cn(
                  'flex min-h-11 flex-col items-start justify-center rounded-md border px-3 py-1.5 text-left transition-colors duration-(--dur-fast)',
                  activePreset?.id === p.id
                    ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                    : 'border-border hover:border-border-strong hover:bg-surface-2',
                )}
              >
                <span className="text-small font-medium text-text">
                  {t(`tools.crop.preset.${p.id}`)}
                </span>
                <span className="text-caption tabular-nums text-text-3">
                  {p.w} × {p.h}
                </span>
              </button>
            ))}
          </div>
        </div>
        {docCount > 1 && (
          <ApplyAllButton
            onClick={applyAll}
            label={t('tools.crop.applyAll')}
            hint={t('tools.crop.applyAllHint', { w: out.w, h: out.h })}
          />
        )}
      </Section>
    </div>
  )
}

const roundRect = (r: { x: number; y: number; w: number; h: number }) => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  w: Math.round(r.w),
  h: Math.round(r.h),
})

/** 比例示意小方框 */
function RatioGlyph({ ratio, free }: { ratio: number | null; free?: boolean }) {
  const max = 18
  const w = ratio ? (ratio >= 1 ? max : max * ratio) : max
  const h = ratio ? (ratio >= 1 ? max / ratio : max) : max * 0.75
  return (
    <span className="grid h-[18px] w-[22px] place-items-center" aria-hidden>
      <span
        className={cn('block rounded-[3px] border-[1.5px] border-current', free && 'border-dashed')}
        style={{ width: w, height: h }}
      />
    </span>
  )
}
