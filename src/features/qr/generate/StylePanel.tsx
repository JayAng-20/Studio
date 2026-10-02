import { ImagePlus, Info, RotateCcw, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Callout,
  ColorPicker,
  SegmentedControl,
  SliderField,
  Switch,
  Tooltip,
  toast,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { prepareLogo } from '../lib/render'
import {
  ECC_LEVELS,
  LOGO_MAX,
  LOGO_MIN,
  LOGO_WARN,
  MARGIN_MAX,
  SIZE_MAX,
  SIZE_MIN,
  type Ecc,
  type EyeShape,
  type FillStyle,
  type FillType,
  type ModuleShape,
} from '../lib/style'
import { useQrStore } from '../store'

type PresetId = 'classic' | 'slate' | 'ocean' | 'sunset' | 'forest' | 'grape'
const PRESETS: Array<{ id: PresetId; fg: FillStyle; bg: string }> = [
  { id: 'classic', fg: { type: 'solid', color: '#000000', color2: '#2F6BEA', angle: 45 }, bg: '#FFFFFF' },
  { id: 'slate', fg: { type: 'solid', color: '#1E293B', color2: '#475569', angle: 45 }, bg: '#F1F5F9' },
  { id: 'ocean', fg: { type: 'linear', color: '#1D4ED8', color2: '#0369A1', angle: 45 }, bg: '#FFFFFF' },
  { id: 'sunset', fg: { type: 'linear', color: '#BE123C', color2: '#C2410C', angle: 135 }, bg: '#FFFBF5' },
  { id: 'forest', fg: { type: 'linear', color: '#14532D', color2: '#15803D', angle: 90 }, bg: '#FFFFFF' },
  { id: 'grape', fg: { type: 'radial', color: '#6D28D9', color2: '#A21CAF', angle: 45 }, bg: '#FFFFFF' },
]

const swatchBg = (fg: FillStyle) =>
  fg.type === 'solid'
    ? fg.color
    : fg.type === 'linear'
      ? `linear-gradient(${fg.angle + 90}deg, ${fg.color}, ${fg.color2})`
      : `radial-gradient(circle, ${fg.color}, ${fg.color2})`

/** 形狀小圖示（16 px，currentColor） */
function ModuleIcon({ shape }: { shape: ModuleShape }) {
  const cells = [
    [1, 1],
    [9, 1],
    [1, 9],
  ]
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="currentColor">
      {cells.map(([x, y]) =>
        shape === 'dots' ? (
          <circle key={`${x}-${y}`} cx={x + 3} cy={y + 3} r="2.8" />
        ) : (
          <rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" rx={shape === 'rounded' ? 3 : 0.5} />
        ),
      )}
      {shape === 'rounded' ? (
        <rect x="9" y="9" width="6" height="6" rx="3" />
      ) : shape === 'dots' ? (
        <circle cx="12" cy="12" r="2.8" />
      ) : (
        <rect x="9" y="9" width="6" height="6" rx="0.5" />
      )}
    </svg>
  )
}

function eyeRadius(shape: EyeShape, size: number): [number, number, number, number] {
  switch (shape) {
    case 'square':
      return [size * 0.06, size * 0.06, size * 0.06, size * 0.06]
    case 'rounded':
      return [size * 0.3, size * 0.3, size * 0.3, size * 0.3]
    case 'circle':
      return [size / 2, size / 2, size / 2, size / 2]
    case 'leaf':
      return [size * 0.45, 0, size * 0.45, 0]
  }
}

/** 以 CSS 圓角畫定位點的外框或中心 */
function EyeIcon({ shape, part }: { shape: EyeShape; part: 'frame' | 'ball' }) {
  const [tl, tr, br, bl] = eyeRadius(shape, part === 'frame' ? 14 : 8)
  return (
    <span
      aria-hidden
      className={cn('inline-block', part === 'frame' ? 'size-3.5 border-[2.5px] border-current' : 'size-2 bg-current')}
      style={{ borderRadius: `${tl}px ${tr}px ${br}px ${bl}px` }}
    />
  )
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-caption font-semibold uppercase tracking-[0.04em] text-text-3">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  )
}

const optLabel = (icon: ReactNode, text: string) => (
  <span className="flex items-center gap-1.5">
    {icon}
    <span>{text}</span>
  </span>
)

export function StylePanel() {
  const t = useT()
  const style = useQrStore((s) => s.style)
  const setStyle = useQrStore((s) => s.setStyle)
  const resetStyle = useQrStore((s) => s.resetStyle)
  const fileRef = useRef<HTMLInputElement>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const fg = style.fg
  const setFg = (patch: Partial<FillStyle>) => setStyle({ fg: { ...fg, ...patch } })

  const pickLogo = async (file: File | undefined) => {
    if (!file) return
    setLogoBusy(true)
    try {
      const prepared = await prepareLogo(file)
      const hadLogo = !!style.logo
      const prevEcc = style.ecc
      setStyle({ logo: { ...prepared, scale: style.logo?.scale ?? 0.2, plate: style.logo?.plate ?? true } })
      if (!hadLogo && prevEcc !== 'H') {
        toast.info(t('qr.style.logoUpgraded'), { description: t('qr.style.logoUpgradedDesc') })
      }
    } catch (e) {
      console.error(e)
      toast.error(t('qr.style.logoFailed'), { description: t('qr.style.logoFailedDesc') })
    } finally {
      setLogoBusy(false)
    }
  }

  const eyeOptions = (part: 'frame' | 'ball') =>
    (['square', 'rounded', 'circle', 'leaf'] as const).map((s) => ({
      value: s,
      label: optLabel(
        <EyeIcon shape={s} part={part} />,
        t(`qr.style.eye${s[0].toUpperCase()}${s.slice(1)}` as 'qr.style.eyeSquare'),
      ),
    }))

  return (
    <section className="card flex flex-col gap-6 p-4 sm:p-5" aria-labelledby="qr-style-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="qr-style-title" className="text-h3 font-semibold">
          {t('qr.style.title')}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          leading={<RotateCcw size={14} aria-hidden />}
          onClick={() => {
            resetStyle()
            toast.success(t('qr.style.resetDone'))
          }}
        >
          {t('qr.style.reset')}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        <Section title={t('qr.style.colors')}>
          <div>
            <span className="label">{t('qr.style.presets')}</span>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => {
                const active =
                  fg.type === p.fg.type &&
                  fg.color === p.fg.color &&
                  (fg.type === 'solid' || fg.color2 === p.fg.color2) &&
                  style.bg === p.bg &&
                  !style.bgTransparent
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStyle({ fg: { ...p.fg }, bg: p.bg, bgTransparent: false })}
                    className={cn(
                      'flex h-9 items-center gap-2 rounded-full border pl-1.5 pr-3 text-small transition-colors duration-(--dur-fast)',
                      active
                        ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-text'
                        : 'border-border-strong text-text-2 hover:bg-surface-2 hover:text-text',
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-6 rounded-full border border-border"
                      style={{ background: swatchBg(p.fg), boxShadow: `inset 0 0 0 3px ${p.bg}` }}
                    />
                    {t(`qr.style.presetNames.${p.id}`)}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <span className="label">{t('qr.style.fillType')}</span>
            <SegmentedControl<FillType>
              full
              label={t('qr.style.fillType')}
              value={fg.type}
              onChange={(type) => setFg({ type })}
              options={[
                { value: 'solid', label: t('qr.style.solid') },
                { value: 'linear', label: t('qr.style.linear') },
                { value: 'radial', label: t('qr.style.radial') },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ColorPicker
              label={t('qr.style.foreground')}
              value={fg.color}
              onChange={(color) => setFg({ color })}
            />
            {fg.type !== 'solid' ? (
              <ColorPicker
                label={t('qr.style.foreground2')}
                value={fg.color2}
                onChange={(color2) => setFg({ color2 })}
              />
            ) : (
              <ColorPicker
                label={t('qr.style.background')}
                value={style.bg}
                onChange={(bg) => setStyle({ bg, bgTransparent: false })}
              />
            )}
          </div>
          {fg.type === 'linear' && (
            <SliderField
              label={t('qr.style.angle')}
              value={fg.angle}
              min={0}
              max={360}
              step={15}
              format={(v) => `${v}°`}
              onChange={(angle) => setFg({ angle })}
            />
          )}
          {fg.type !== 'solid' && (
            <div className="grid grid-cols-2 gap-3">
              <ColorPicker
                label={t('qr.style.background')}
                value={style.bg}
                onChange={(bg) => setStyle({ bg, bgTransparent: false })}
              />
            </div>
          )}
          <Switch
            checked={style.bgTransparent}
            onChange={(bgTransparent) => setStyle({ bgTransparent })}
            label={t('qr.style.transparent')}
            description={t('qr.style.transparentDesc')}
          />
          <Switch
            checked={style.eyeCustom}
            onChange={(eyeCustom) => setStyle({ eyeCustom })}
            label={t('qr.style.eyeCustom')}
          />
          {style.eyeCustom && (
            <div className="grid grid-cols-2 gap-3">
              <ColorPicker
                label={t('qr.style.eyeColor')}
                value={style.eyeColor}
                onChange={(eyeColor) => setStyle({ eyeColor })}
              />
            </div>
          )}
        </Section>

        <Section title={t('qr.style.shapes')}>
          <div>
            <span className="label">{t('qr.style.moduleShape')}</span>
            <SegmentedControl<ModuleShape>
              full
              label={t('qr.style.moduleShape')}
              value={style.shape}
              onChange={(shape) => setStyle({ shape })}
              options={[
                { value: 'square', label: optLabel(<ModuleIcon shape="square" />, t('qr.style.shapeSquare')) },
                { value: 'rounded', label: optLabel(<ModuleIcon shape="rounded" />, t('qr.style.shapeRounded')) },
                { value: 'dots', label: optLabel(<ModuleIcon shape="dots" />, t('qr.style.shapeDots')) },
              ]}
            />
          </div>
          <div>
            <span className="label">{t('qr.style.eyeFrame')}</span>
            <SegmentedControl<EyeShape>
              full
              label={t('qr.style.eyeFrame')}
              value={style.eyeFrame}
              onChange={(eyeFrame) => setStyle({ eyeFrame })}
              options={eyeOptions('frame')}
            />
          </div>
          <div>
            <span className="label">{t('qr.style.eyeBall')}</span>
            <SegmentedControl<EyeShape>
              full
              label={t('qr.style.eyeBall')}
              value={style.eyeBall}
              onChange={(eyeBall) => setStyle({ eyeBall })}
              options={eyeOptions('ball')}
            />
          </div>

          <div className="mt-2 flex flex-col gap-3">
            <span className="label mb-0">{t('qr.style.logo')}</span>
            {style.logo ? (
              <div className="flex items-center gap-3">
                <span className="qr-checker grid size-14 shrink-0 place-items-center overflow-hidden rounded-md border border-border">
                  <img src={style.logo.src} alt="" className="max-h-12 max-w-12 object-contain" />
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" loading={logoBusy} onClick={() => fileRef.current?.click()}>
                    {t('qr.style.logoReplace')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leading={<Trash2 size={14} aria-hidden />}
                    onClick={() => setStyle({ logo: null })}
                  >
                    {t('qr.style.logoRemove')}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button
                  variant="secondary"
                  loading={logoBusy}
                  leading={<ImagePlus size={16} aria-hidden />}
                  onClick={() => fileRef.current?.click()}
                >
                  {t('qr.style.logoAdd')}
                </Button>
                <p className="mt-1.5 text-caption text-text-3">{t('qr.style.logoHint')}</p>
              </div>
            )}
            {style.logo && (
              <>
                <SliderField
                  label={t('qr.style.logoSize')}
                  value={Math.round(style.logo.scale * 100)}
                  min={Math.round(LOGO_MIN * 100)}
                  max={Math.round(LOGO_MAX * 100)}
                  step={1}
                  warnAbove={Math.round(LOGO_WARN * 100)}
                  format={(v) => `${v}%`}
                  onChange={(v) => style.logo && setStyle({ logo: { ...style.logo, scale: v / 100 } })}
                />
                <Switch
                  checked={style.logo.plate}
                  onChange={(plate) => style.logo && setStyle({ logo: { ...style.logo, plate } })}
                  label={t('qr.style.logoPlate')}
                  description={t('qr.style.logoPlateDesc')}
                />
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/avif"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                void pickLogo(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        </Section>
      </div>

      <div className="border-t border-border pt-5">
        <Section title={t('qr.style.output')}>
          <div className="grid gap-5 md:grid-cols-3 md:gap-8">
            <SliderField
              label={t('qr.style.size')}
              value={style.size}
              min={SIZE_MIN}
              max={SIZE_MAX}
              step={64}
              format={(v) => `${v} px`}
              onChange={(size) => setStyle({ size })}
            />
            <SliderField
              label={t('qr.style.margin')}
              value={style.margin}
              min={0}
              max={MARGIN_MAX}
              step={1}
              format={(n) => t('qr.style.marginValue', { n })}
              hint={style.margin < 2 ? t('qr.style.marginHint') : undefined}
              onChange={(margin) => setStyle({ margin })}
            />
            <EccField />
          </div>
        </Section>
      </div>
    </section>
  )
}

function EccField() {
  const t = useT()
  const ecc = useQrStore((s) => s.style.ecc)
  const locked = useQrStore((s) => !!s.style.logo)
  const setStyle = useQrStore((s) => s.setStyle)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-small font-medium text-text-2">{t('qr.style.ecc')}</span>
        <Tooltip
          content={
            <span className="flex flex-col gap-1 py-0.5">
              {ECC_LEVELS.map((l) => (
                <span key={l}>{t(`qr.style.eccTips.${l}`)}</span>
              ))}
            </span>
          }
        >
          <button
            type="button"
            aria-label={ECC_LEVELS.map((l) => t(`qr.style.eccTips.${l}`)).join(' ')}
            className="grid size-6 place-items-center rounded-full text-text-3 hover:text-text"
          >
            <Info size={14} aria-hidden />
          </button>
        </Tooltip>
      </div>
      <SegmentedControl<Ecc>
        full
        label={t('qr.style.ecc')}
        value={ecc}
        onChange={(v) => setStyle({ ecc: v })}
        options={ECC_LEVELS.map((l) => ({
          value: l,
          disabled: locked && l !== 'H',
          label: (
            <Tooltip content={t(`qr.style.eccTips.${l}`)}>
              <span className="px-1">{l}</span>
            </Tooltip>
          ),
        }))}
      />
      <p className="text-caption text-text-3" aria-live="polite">
        {locked ? t('qr.style.eccLocked') : t(`qr.style.eccTips.${ecc}`)}
      </p>
    </div>
  )
}

export function LogoNotice() {
  const t = useT()
  const logo = useQrStore((s) => s.style.logo)
  if (!logo) return null
  return (
    <Callout tone="accent" icon={<Info size={16} aria-hidden />} title={t('qr.preview.logoNote')}>
      {logo.scale > LOGO_WARN ? t('qr.preview.logoLarge') : t('qr.preview.logoNoteDesc')}
    </Callout>
  )
}
