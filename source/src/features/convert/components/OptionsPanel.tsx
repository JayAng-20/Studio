/** 右側設定面板：格式、品質／目標大小、尺寸、底色、EXIF、動畫、進階（編碼器、命名） */
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Cpu, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Callout,
  ColorPicker,
  NumberField,
  SegmentedControl,
  Select,
  SliderField,
  Switch,
} from '@/components/ui'
import { duration, easing, sec, spring } from '@/design/motion'
import { readJSON, writeJSON } from '@/lib/storage'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { computeOutputSize, type ResizeMode } from '../lib/resize'
import { useConvert } from '../store'
import { FORMATS, ICO_SIZES } from '../types'
import { OUTPUT_LABEL } from '../texts'
import type { SupportMap } from '../useFormatSupport'
import { FormatPicker } from './FormatPicker'
import { NamingField } from './NamingField'

const ADV_KEY = 'jayang:convert-advanced-open'
/** 面板底部保留給任務中心膠囊的空間 */
const BOTTOM_GAP = 88

/**
 * 桌機：面板高度跟著它在畫面中的位置調整（捲動前在頁首下方、捲動後貼齊頂欄），
 * 讓主要按鈕永遠在視窗內，內容過長時面板內部捲動。
 */
function useFitViewport() {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const mq = matchMedia('(min-width: 1024px)')
    let frame = 0
    const fit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!mq.matches) {
          el.style.maxHeight = ''
          return
        }
        const top = el.getBoundingClientRect().top
        el.style.maxHeight = `${Math.max(360, window.innerHeight - Math.max(0, top) - BOTTOM_GAP)}px`
      })
    }
    fit()
    window.addEventListener('scroll', fit, { capture: true, passive: true })
    window.addEventListener('resize', fit)
    mq.addEventListener('change', fit)
    const ro = new ResizeObserver(fit)
    ro.observe(document.body)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', fit, { capture: true })
      window.removeEventListener('resize', fit)
      mq.removeEventListener('change', fit)
      ro.disconnect()
    }
  }, [])
  return ref
}

function Section({
  title,
  children,
  aside,
}: {
  title: ReactNode
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-small font-semibold text-text">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function OptionsPanel({ support, footer }: { support: SupportMap; footer: ReactNode }) {
  const t = useT()
  const o = useConvert((s) => s.options)
  const set = useConvert((s) => s.setOptions)
  const first = useConvert((s) => s.items.find((x) => x.probe?.width))
  const anyAnimated = useConvert((s) => s.items.some((x) => x.probe?.animated))
  const f = FORMATS[o.format]
  const panelRef = useFitViewport()
  const [adv, setAdv] = useState(() => readJSON<boolean>(ADV_KEY, false))
  const toggleAdv = () => {
    setAdv(!adv)
    writeJSON(ADV_KEY, !adv)
  }

  const qualityHint =
    o.quality >= 90
      ? t('convert.options.qHigh')
      : o.quality >= 70
        ? t('convert.options.qBalanced')
        : o.quality >= 50
          ? t('convert.options.qSmall')
          : t('convert.options.qLow')

  const r = o.resize
  const resizeValue =
    r.mode === 'width'
      ? r.width
      : r.mode === 'height'
        ? r.height
        : r.mode === 'long'
          ? r.long
          : r.percent
  const setResizeValue = (v: number) => {
    const key =
      r.mode === 'width'
        ? 'width'
        : r.mode === 'height'
          ? 'height'
          : r.mode === 'long'
            ? 'long'
            : 'percent'
    set({ resize: { ...r, [key]: v } })
  }
  const example =
    first?.probe?.width && first.probe.height && r.mode !== 'none'
      ? (() => {
          const src = { width: first.probe.width, height: first.probe.height }
          const out = computeOutputSize(src, r)
          return t('convert.options.resizeExample', {
            from: `${src.width}×${src.height}`,
            to: `${out.width}×${out.height}`,
          })
        })()
      : null

  const engineNote =
    support[o.format] === 'wasm'
      ? o.format === 'avif'
        ? t('convert.format.avifWasm')
        : t('convert.format.wasm', { format: OUTPUT_LABEL[o.format] })
      : null

  return (
    <section
      ref={panelRef}
      aria-label={t('convert.options.title')}
      className="card flex flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <Section title={t('convert.options.format')}>
          <FormatPicker value={o.format} onChange={(format) => set({ format })} support={support} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={o.format}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: sec(duration.fast), ease: easing.standard }}
              className="flex flex-col gap-1.5"
            >
              <p className="text-small text-text-2">{t(`convert.format.desc.${o.format}`)}</p>
              {engineNote && (
                <p className="flex gap-1.5 text-caption text-text-3">
                  <Cpu size={13} className="mt-px shrink-0" aria-hidden />
                  <span>{engineNote}</span>
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </Section>

        {f.quality && (
          <Section title={t('convert.options.qualitySection')}>
            {!o.targetOn && (
              <SliderField
                label={t('convert.options.quality')}
                value={o.quality}
                min={1}
                max={100}
                onChange={(quality) => set({ quality })}
                hint={qualityHint}
              />
            )}
            <Switch
              checked={o.targetOn}
              onChange={(targetOn) => set({ targetOn })}
              label={t('convert.options.target')}
              description={t('convert.options.targetDesc')}
            />
            {o.targetOn && (
              <NumberField
                label={t('convert.options.targetSize')}
                value={o.targetKB}
                min={5}
                max={100000}
                step={10}
                suffix="KB"
                onChange={(targetKB) => set({ targetKB })}
              />
            )}
          </Section>
        )}

        {o.format === 'ico' ? (
          <Section title={t('convert.options.icoSizes')}>
            <div
              className="grid grid-cols-6 gap-1"
              role="group"
              aria-label={t('convert.options.icoSizes')}
            >
              {ICO_SIZES.map((n) => {
                const on = o.icoSizes.includes(n)
                const last = on && o.icoSizes.length === 1
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={on}
                    aria-disabled={last || undefined}
                    title={last ? t('convert.options.icoAtLeastOne') : undefined}
                    onClick={() => {
                      if (last) return
                      set({
                        icoSizes: on
                          ? o.icoSizes.filter((x) => x !== n)
                          : [...o.icoSizes, n].sort((a, b) => a - b),
                      })
                    }}
                    className={cn(
                      'h-9 rounded-sm border text-caption font-semibold tabular-nums transition-colors duration-(--dur-fast) max-sm:h-11',
                      on
                        ? 'border-transparent bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent-ink'
                        : 'border-border bg-surface-2 text-text-2 hover:text-text',
                    )}
                  >
                    {n}
                  </button>
                )
              })}
            </div>
            <p className="text-caption text-text-3">{t('convert.options.icoHint')}</p>
          </Section>
        ) : (
          <Section title={t('convert.options.size')}>
            <Select<ResizeMode>
              label={t('convert.options.resizeMode')}
              hideLabel
              value={r.mode}
              onChange={(mode) => set({ resize: { ...r, mode } })}
              options={(['none', 'width', 'height', 'long', 'percent'] as const).map((m) => ({
                value: m,
                label: t(`convert.options.resize.${m}`),
              }))}
            />
            {r.mode !== 'none' && (
              <>
                <NumberField
                  label={t(`convert.options.resizeValue.${r.mode}`)}
                  value={resizeValue}
                  min={1}
                  max={r.mode === 'percent' ? 1000 : 30000}
                  step={r.mode === 'percent' ? 5 : 10}
                  suffix={r.mode === 'percent' ? '%' : 'px'}
                  onChange={setResizeValue}
                />
                <Switch
                  checked={r.upscale}
                  onChange={(upscale) => set({ resize: { ...r, upscale } })}
                  label={t('convert.options.upscale')}
                  description={t('convert.options.upscaleDesc')}
                />
                {example && <p className="text-caption tabular-nums text-text-3">{example}</p>}
              </>
            )}
          </Section>
        )}

        {o.format === 'jpeg' && (
          <Section title={t('convert.options.background')}>
            <ColorPicker
              label={t('convert.options.backgroundLabel')}
              value={o.background}
              onChange={(background) => set({ background })}
            />
            <p className="-mt-1 text-caption text-text-3">{t('convert.options.backgroundHint')}</p>
          </Section>
        )}

        <Section title={t('convert.options.exif')}>
          <Select
            label={t('convert.options.exif')}
            hideLabel
            value={o.exif}
            onChange={(exif) => set({ exif })}
            options={(['strip', 'keep-no-gps', 'keep'] as const).map((m) => ({
              value: m,
              label: t(`convert.options.exifMode.${m}`),
            }))}
          />
          <p className="flex gap-1.5 text-caption text-text-3">
            {o.exif === 'keep' ? (
              <TriangleAlert size={13} className="mt-px shrink-0 text-warning-ink" aria-hidden />
            ) : (
              <ShieldCheck size={13} className="mt-px shrink-0 text-success-ink" aria-hidden />
            )}
            <span>{t(`convert.options.exifHint.${o.exif}`)}</span>
          </p>
          {o.exif !== 'strip' && !f.exif && (
            <Callout tone="warning" className="py-2.5">
              {t('convert.options.exifUnsupported', { format: OUTPUT_LABEL[o.format] })}
            </Callout>
          )}
        </Section>

        {anyAnimated && (
          <Section title={t('convert.options.animation')}>
            {f.animation ? (
              <Switch
                checked={o.keepAnimation}
                onChange={(keepAnimation) => set({ keepAnimation })}
                label={t('convert.options.keepAnimation')}
                description={t('convert.options.keepAnimationDesc', {
                  format: OUTPUT_LABEL[o.format],
                })}
              />
            ) : (
              <p className="text-caption text-text-3">
                {t('convert.options.animationFirstFrame', { format: OUTPUT_LABEL[o.format] })}
              </p>
            )}
          </Section>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <button
            type="button"
            aria-expanded={adv}
            onClick={toggleAdv}
            className="-mx-1 flex items-center justify-between rounded-sm px-1 py-1 text-small font-semibold text-text"
          >
            <span className="inline-flex items-center gap-1.5">
              <Sparkles size={14} className="text-accent-ink" aria-hidden />
              {t('convert.options.advanced')}
            </span>
            <motion.span
              animate={{ rotate: adv ? 180 : 0 }}
              transition={spring.snappy}
              className="text-text-3"
            >
              <ChevronDown size={16} aria-hidden />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {adv && (
              <motion.div
                key="adv"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: sec(duration.instant) } }}
                transition={{ duration: sec(duration.fast), ease: easing.standard }}
                className="flex flex-col gap-5"
              >
                {o.format !== 'bmp' && o.format !== 'gif' && (
                  <div className="flex flex-col gap-2">
                    <span className="label mb-0!">{t('convert.options.encoder')}</span>
                    <SegmentedControl
                      full
                      label={t('convert.options.encoder')}
                      value={o.encoder}
                      onChange={(encoder) => set({ encoder })}
                      options={[
                        { value: 'best', label: t('convert.options.encoderBest') },
                        { value: 'fast', label: t('convert.options.encoderFast') },
                      ]}
                    />
                    <p className="text-caption text-text-3">
                      {t(
                        `convert.options.encoderHint.${o.encoder}.${o.format === 'ico' ? 'png' : o.format}`,
                      )}
                    </p>
                  </div>
                )}
                <NamingField />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {/* 還有內容可捲動時的淡出提示 */}
        <div
          aria-hidden
          className="pointer-events-none sticky bottom-0 -mx-4 -mt-5 h-6 shrink-0 bg-gradient-to-t from-surface to-transparent max-lg:hidden"
        />
      </div>
      <div className="border-t border-border bg-[color-mix(in_srgb,var(--surface-2)_60%,var(--surface))] p-4">
        {footer}
      </div>
    </section>
  )
}
