/** 取色器（EyeDropper＋畫布點選）與主色擷取 */
import { Crosshair, Pipette } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, CopyButton, Skeleton, toast } from '@/components/ui'
import { caps } from '@/lib/capabilities'
import { copyText } from '@/lib/download'
import { createCanvas, releaseCanvas } from '@/lib/image'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { extractPalette, hexToRgb, hslString, isLight, rgbString, type Swatch } from '../lib/color'
import { outputSize } from '../lib/geometry'
import { renderEdit } from '../lib/render'
import { stateKey } from '../lib/state'
import { Section, useColorStore, useDebounced, useEditor } from '../ui'

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }

function usePalette() {
  const { doc, state } = useEditor()
  const key = useDebounced(doc && state ? `${doc.id}|${stateKey(state)}` : '', 300)
  const [result, setResult] = useState<{ key: string; swatches: Swatch[] } | null>(null)
  useEffect(() => {
    if (!doc?.proxy || !state || !key) return
    let alive = true
    const id = requestAnimationFrame(() => {
      const out = outputSize(state, doc.srcW, doc.srcH)
      const c = renderEdit({
        source: doc.proxy!,
        srcW: doc.srcW,
        srcH: doc.srcH,
        state,
        stage: 'final',
        scale: Math.min(1, 160 / Math.max(out.w, out.h)),
        make: createCanvas,
      }) as HTMLCanvasElement
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      releaseCanvas(c)
      const swatches = extractPalette(data, 6)
      if (alive) setResult({ key, swatches })
    })
    return () => {
      alive = false
      cancelAnimationFrame(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, doc?.proxy])
  return result?.key === key ? result.swatches : result ? result.swatches : null
}

export function ColorPanel() {
  const t = useT()
  const { picking, setPicking, picks, addPick } = useColorStore()
  const palette = usePalette()
  const current = picks[0]
  const rgb = current ? hexToRgb(current) : null
  const eye = caps.eyeDropper()

  const openEye = async () => {
    try {
      const Eye = (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper
      const r = await new Eye().open()
      addPick(r.sRGBHex.toUpperCase())
    } catch {
      /* 使用者按 Esc 取消 */
    }
  }

  const copy = async (v: string) => {
    if (await copyText(v))
      toast.success(t('tools.color.copiedValue', { value: v }), { duration: 1500 })
    else toast.error(t('common.copyFailed'))
  }

  return (
    <div>
      <Section>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={picking ? 'primary' : 'secondary'}
            aria-pressed={picking}
            leading={<Crosshair size={16} aria-hidden />}
            onClick={() => setPicking(!picking)}
            className="w-full"
          >
            {picking ? t('tools.color.stopPick') : t('tools.color.pick')}
          </Button>
          <Button
            variant="secondary"
            leading={<Pipette size={16} aria-hidden />}
            disabled={!eye}
            onClick={openEye}
            className="w-full"
            title={eye ? undefined : t('tools.color.eyedropperUnsupported')}
          >
            {t('common.eyedropper')}
          </Button>
        </div>
        <p className="text-caption text-text-3" aria-live="polite">
          {picking
            ? t('tools.color.picking')
            : eye
              ? t('tools.color.eyedropper')
              : t('tools.color.eyedropperUnsupported')}
        </p>
      </Section>

      <Section title={t('tools.color.picked')}>
        {current && rgb ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <div
              className="flex h-20 items-end p-3 font-mono text-h3 font-semibold"
              style={{ background: current, color: isLight(rgb) ? '#0F172A' : '#FFFFFF' }}
            >
              {current}
            </div>
            <dl className="divide-y divide-border">
              {[
                ['HEX', current],
                ['RGB', rgbString(rgb)],
                ['HSL', hslString(rgb)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 py-1 pl-3 pr-1">
                  <dt className="w-10 text-caption font-medium text-text-3">{k}</dt>
                  <dd className="min-w-0 flex-1 truncate font-mono text-small text-text">{v}</dd>
                  <CopyButton
                    variant="ghost"
                    size="sm"
                    iconOnly
                    label={t('tools.color.copyValue', { value: v })}
                    onCopy={() => copyText(v)}
                  />
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-small text-text-3">
            {t('tools.color.none')}
          </p>
        )}
        {picks.length > 1 && (
          <div>
            <p className="label">{t('tools.color.recent')}</p>
            <div className="flex flex-wrap gap-1.5">
              {picks.slice(1).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-label={t('tools.color.copyValue', { value: p })}
                  title={p}
                  onClick={() => addPick(p)}
                  className="size-8 rounded-sm border border-border-strong transition-transform duration-(--dur-fast) hover:scale-110"
                  style={{ background: p }}
                />
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title={t('tools.color.palette')}>
        <p className="-mt-1 text-caption text-text-3">{t('tools.color.paletteHint')}</p>
        {palette ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex h-10 overflow-hidden rounded-md border border-border" aria-hidden>
              {palette.map((s) => (
                <span
                  key={s.hex}
                  style={{ background: s.hex, flexGrow: Math.max(s.ratio, 0.04) }}
                />
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-1.5">
              {palette.map((s) => (
                <li key={s.hex}>
                  <button
                    type="button"
                    onClick={() => copy(s.hex)}
                    aria-label={t('tools.color.copyValue', { value: s.hex })}
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-md border border-border px-2 text-left transition-colors duration-(--dur-fast) hover:bg-surface-2"
                  >
                    <span
                      className={cn('size-7 shrink-0 rounded-sm border border-border-strong')}
                      style={{ background: s.hex }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-small text-text">{s.hex}</span>
                      <span className="block text-caption tabular-nums text-text-3">
                        {t('tools.color.share', { p: `${Math.round(s.ratio * 100)}%` })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
      </Section>
    </div>
  )
}
