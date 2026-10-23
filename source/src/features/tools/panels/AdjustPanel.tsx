/** 調整與濾鏡：預設濾鏡縮圖列（即時以目前圖片產生）＋七個滑桿 */
import { Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, SliderField } from '@/components/ui'
import { cn } from '@/lib/cn'
import { createCanvas, releaseCanvas } from '@/lib/image'
import { useT } from '@/i18n'
import { FILTER_IDS } from '../lib/adjust'
import { outputSize } from '../lib/geometry'
import { renderEdit } from '../lib/render'
import { stateKey } from '../lib/state'
import {
  defaultAdjust,
  defaultWatermark,
  type Adjust,
  type EditState,
  type FilterId,
} from '../lib/types'
import type { Doc } from '../store'
import { Section, useDebounced, useEditor } from '../ui'

const SLIDERS: Array<{ key: keyof Adjust; min: number; signed: boolean }> = [
  { key: 'brightness', min: -100, signed: true },
  { key: 'contrast', min: -100, signed: true },
  { key: 'saturation', min: -100, signed: true },
  { key: 'temperature', min: -100, signed: true },
  { key: 'sharpen', min: 0, signed: false },
  { key: 'blur', min: 0, signed: false },
  { key: 'grayscale', min: 0, signed: false },
]

const THUMB = 72

/** 濾鏡縮圖：用目前的裁切與調整，各套一個濾鏡 */
function useFilterThumbs(doc: Doc | null, state: EditState | undefined) {
  // 只在幾何或調整改變時重算（不含濾鏡本身、浮水印、遮蔽）
  const base = state
    ? {
        ...state,
        filter: { id: 'none' as FilterId, strength: 100 },
        watermark: defaultWatermark(),
        redactions: [],
      }
    : null
  const key = useDebounced(base ? `${doc?.id}|${stateKey(base)}` : '', 250)
  const [thumbs, setThumbs] = useState<{ key: string; urls: Record<string, string> } | null>(null)
  useEffect(() => {
    if (!doc?.proxy || !state || !key) return
    let alive = true
    const id = requestAnimationFrame(() => {
      const b = { ...state, watermark: defaultWatermark(), redactions: [] }
      const out = outputSize(b, doc.srcW, doc.srcH)
      const scale = Math.min(1, (THUMB * 2) / Math.min(out.w, out.h))
      const urls: Record<string, string> = {}
      for (const f of FILTER_IDS) {
        const c = renderEdit({
          source: doc.proxy!,
          srcW: doc.srcW,
          srcH: doc.srcH,
          state: { ...b, filter: { id: f, strength: 100 } },
          stage: 'final',
          scale,
          make: createCanvas,
        }) as HTMLCanvasElement
        urls[f] = c.toDataURL('image/jpeg', 0.8)
        releaseCanvas(c)
      }
      if (alive) setThumbs({ key, urls })
    })
    return () => {
      alive = false
      cancelAnimationFrame(id)
    }
    // state 透過 key 追蹤
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, doc?.proxy])
  return thumbs?.urls ?? null
}

export function AdjustPanel() {
  const t = useT()
  const { doc, state, edit } = useEditor()
  const thumbs = useFilterThumbs(doc, state)
  if (!doc || !state) return null
  const changed = SLIDERS.some((s) => state.adjust[s.key] !== 0) || state.filter.id !== 'none'

  const setFilter = (id: FilterId) =>
    edit(t('tools.adjust.actions.filter'), (s) => ({
      ...s,
      filter: { id, strength: s.filter.id === id ? s.filter.strength : 100 },
    }))

  return (
    <div>
      <Section title={t('tools.adjust.filters')}>
        <div
          role="radiogroup"
          aria-label={t('tools.adjust.filters')}
          className="tl-fade-x -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 hide-scrollbar"
        >
          {FILTER_IDS.map((f) => {
            const selected = state.filter.id === f
            return (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setFilter(f)}
                className="group flex w-[72px] shrink-0 flex-col items-center gap-1.5 outline-none"
              >
                <span
                  className={cn(
                    'tl-checker relative block size-[72px] overflow-hidden rounded-md transition-shadow duration-(--dur-fast)',
                    selected
                      ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--accent)]'
                      : 'shadow-[0_0_0_1px_var(--border)] group-hover:shadow-[0_0_0_1px_var(--border-strong)] group-focus-visible:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--accent)]',
                  )}
                >
                  {thumbs?.[f] ? (
                    <img
                      src={thumbs[f]}
                      alt=""
                      className="size-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="skeleton shimmer absolute inset-0" />
                  )}
                </span>
                <span
                  className={cn(
                    'text-caption',
                    selected ? 'font-semibold text-text' : 'text-text-2',
                  )}
                >
                  {t(`tools.adjust.filter.${f}`)}
                </span>
              </button>
            )
          })}
        </div>
        {state.filter.id !== 'none' && (
          <SliderField
            label={t('tools.adjust.strength')}
            value={state.filter.strength}
            min={0}
            max={100}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) =>
              edit(
                t('tools.adjust.actions.filter'),
                (s) => ({ ...s, filter: { ...s.filter, strength: Math.round(v) } }),
                'filter-strength',
              )
            }
          />
        )}
      </Section>
      <Section
        title={t('tools.adjust.tune')}
        action={
          <Button
            variant="ghost"
            size="sm"
            leading={<Undo2 size={14} aria-hidden />}
            disabled={!changed}
            onClick={() =>
              edit(t('tools.adjust.actions.reset'), (s) => ({
                ...s,
                adjust: defaultAdjust(),
                filter: { id: 'none', strength: 100 },
              }))
            }
          >
            {t('tools.adjust.reset')}
          </Button>
        }
      >
        {SLIDERS.map(({ key, min, signed }) => {
          const name = t(`tools.adjust.${key}`)
          const label = t('tools.adjust.actions.adjust', { name })
          return (
            <div
              key={key}
              title={t('tools.adjust.resetOne')}
              onDoubleClick={() =>
                edit(label, (s) => ({ ...s, adjust: { ...s.adjust, [key]: 0 } }))
              }
            >
              <SliderField
                label={name}
                value={state.adjust[key]}
                min={min}
                origin={signed ? 0 : undefined}
                max={100}
                format={(v) => (signed && v > 0 ? `+${Math.round(v)}` : String(Math.round(v)))}
                onChange={(v) =>
                  edit(
                    label,
                    (s) => ({ ...s, adjust: { ...s.adjust, [key]: Math.round(v) } }),
                    `adjust-${key}`,
                  )
                }
              />
            </div>
          )
        })}
      </Section>
    </div>
  )
}
