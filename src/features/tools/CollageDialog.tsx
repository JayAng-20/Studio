/** 拼貼（P2）：把工作台中的圖片（套用目前編輯）排成一張 */
import { Columns3, Download, LayoutGrid, PanelLeft, Plus, Rows3 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  ColorPicker,
  Dialog,
  SegmentedControl,
  SliderField,
  NumberField,
  Spinner,
  toast,
} from '@/components/ui'
import { createCanvas, releaseCanvas, canvasToBlob } from '@/lib/image'
import { downloadBlob } from '@/lib/download'
import { runTask } from '@/stores/tasks'
import { useT } from '@/i18n'
import { coverSource, planCollage, type CollageLayout } from './lib/collage'
import { outputSize } from './lib/geometry'
import { renderEdit } from './lib/render'
import { useTools } from './store'
import { bitmapOf } from './ui'

const PREVIEW_MAX = 520

export default function CollageDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const t = useT()
  const [layout, setLayout] = useState<CollageLayout>('grid')
  const [gap, setGap] = useState(16)
  const [radius, setRadius] = useState(8)
  const [bg, setBg] = useState('#FFFFFF')
  const [width, setWidth] = useState(2000)
  const [sources, setSources] = useState<HTMLCanvasElement[] | null>(null)
  const preview = useRef<HTMLCanvasElement>(null)

  // 開啟時把每張圖（含編輯）畫成來源
  useEffect(() => {
    if (!open) return
    let alive = true
    const made: HTMLCanvasElement[] = []
    ;(async () => {
      const { docs, history } = useTools.getState()
      for (const d of docs) {
        const st = history.present[d.id]
        if (d.status !== 'ready' || !d.proxy || !st) continue
        const out = outputSize(st, d.srcW, d.srcH)
        const wm =
          st.watermark.enabled && st.watermark.kind === 'image' && st.watermark.image
            ? await bitmapOf(st.watermark.image)
            : null
        made.push(
          renderEdit({
            source: d.proxy,
            srcW: d.srcW,
            srcH: d.srcH,
            state: st,
            stage: 'final',
            scale: Math.min(1, 1800 / Math.max(out.w, out.h)),
            make: createCanvas,
            watermarkImage: wm,
          }) as HTMLCanvasElement,
        )
      }
      if (alive) setSources(made)
    })().catch((e) => console.error(e))
    return () => {
      alive = false
      made.forEach(releaseCanvas)
    }
  }, [open])

  const plan = useMemo(
    () =>
      sources
        ? planCollage(
            layout,
            sources.map((c) => c.width / c.height),
            width,
            (gap / 1000) * width,
          )
        : null,
    [sources, layout, width, gap],
  )

  const draw = (target: HTMLCanvasElement, scale: number) => {
    if (!plan || !sources) return
    target.width = Math.max(1, Math.round(plan.width * scale))
    target.height = Math.max(1, Math.round(plan.height * scale))
    const ctx = target.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, target.width, target.height)
    const r = (radius / 1000) * plan.width * scale
    plan.cells.forEach((cell, i) => {
      const src = sources[i]
      const c = { x: cell.x * scale, y: cell.y * scale, w: cell.w * scale, h: cell.h * scale }
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(c.x, c.y, c.w, c.h, r)
      ctx.clip()
      if (plan.cover) {
        const s = coverSource(src.width, src.height, c)
        ctx.drawImage(src, s.x, s.y, s.w, s.h, c.x, c.y, c.w, c.h)
      } else ctx.drawImage(src, c.x, c.y, c.w, c.h)
      ctx.restore()
    })
  }

  useEffect(() => {
    if (!preview.current || !plan) return
    const scale =
      Math.min(PREVIEW_MAX / plan.width, 420 / plan.height) *
      Math.min(2, window.devicePixelRatio || 1)
    draw(preview.current, scale)
  })

  const build = async () => {
    const c = createCanvas(1, 1)
    draw(c, 1)
    try {
      return await canvasToBlob(c, 'image/jpeg', 0.92)
    } finally {
      releaseCanvas(c)
    }
  }
  const name = `${t('tools.collage.fileName')}_${new Date().toISOString().slice(0, 10)}.jpg`

  const download = async () => {
    try {
      await runTask('tools', t('tools.collage.download'), async ({ progress }) => {
        progress(null)
        const blob = await build()
        downloadBlob(blob, name)
        return [{ blob, name }]
      })
    } catch (e) {
      console.error(e)
      toast.error(t('tools.errors.export'), { description: t('tools.errors.exportDesc') })
    }
  }
  const addToWorkspace = async () => {
    const blob = await build()
    useTools.getState().addFiles([new File([blob], name, { type: 'image/jpeg' })])
    toast.success(t('tools.collage.added'))
    onOpenChange(false)
  }

  const count = sources?.length ?? 0
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('tools.collage.title')}
      description={t('tools.collage.desc')}
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            leading={<Plus size={16} aria-hidden />}
            disabled={count < 2}
            onClick={addToWorkspace}
          >
            {t('tools.collage.add')}
          </Button>
          <Button
            variant="primary"
            leading={<Download size={16} aria-hidden />}
            disabled={count < 2}
            onClick={download}
          >
            {t('tools.collage.download')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="tl-stage grid min-h-[240px] place-items-center rounded-lg p-3">
          {!sources ? (
            <span className="flex items-center gap-2 text-small text-text-2">
              <Spinner size={18} />
              {t('tools.collage.rendering')}
            </span>
          ) : count < 2 ? (
            <p className="text-small text-text-2">{t('tools.collage.needTwo')}</p>
          ) : (
            <canvas
              ref={preview}
              role="img"
              aria-label={t('tools.collage.title')}
              className="tl-image-shadow max-h-[420px] max-w-full rounded-xs"
              style={
                plan
                  ? {
                      aspectRatio: `${plan.width} / ${plan.height}`,
                      width: Math.min(PREVIEW_MAX, (420 * plan.width) / plan.height),
                    }
                  : undefined
              }
            />
          )}
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <span className="label">{t('tools.collage.layout')}</span>
            <SegmentedControl<CollageLayout>
              full
              size="sm"
              label={t('tools.collage.layout')}
              value={layout}
              onChange={setLayout}
              options={[
                {
                  value: 'grid',
                  label: <LayoutGrid size={15} aria-label={t('tools.collage.layouts.grid')} />,
                  title: t('tools.collage.layouts.grid'),
                },
                {
                  value: 'row',
                  label: <Columns3 size={15} aria-label={t('tools.collage.layouts.row')} />,
                  title: t('tools.collage.layouts.row'),
                },
                {
                  value: 'column',
                  label: <Rows3 size={15} aria-label={t('tools.collage.layouts.column')} />,
                  title: t('tools.collage.layouts.column'),
                },
                {
                  value: 'featured',
                  label: <PanelLeft size={15} aria-label={t('tools.collage.layouts.featured')} />,
                  title: t('tools.collage.layouts.featured'),
                },
              ]}
            />
            <p className="mt-1 text-caption text-text-3">
              {t(`tools.collage.layouts.${layout}`)} · {t('tools.collage.images', { count })}
            </p>
          </div>
          <SliderField
            label={t('tools.collage.gap')}
            value={gap}
            min={0}
            max={60}
            onChange={(v) => setGap(Math.round(v))}
          />
          <SliderField
            label={t('tools.collage.radius')}
            value={radius}
            min={0}
            max={60}
            onChange={(v) => setRadius(Math.round(v))}
          />
          <ColorPicker label={t('tools.collage.background')} value={bg} onChange={setBg} />
          <NumberField
            label={t('tools.collage.width')}
            value={width}
            min={400}
            max={8000}
            step={100}
            suffix="px"
            onChange={setWidth}
          />
        </div>
      </div>
    </Dialog>
  )
}
