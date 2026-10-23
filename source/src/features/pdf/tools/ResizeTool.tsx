import { motion } from 'motion/react'
import { Ratio } from 'lucide-react'
import { useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, NumberField, Select, SegmentedControl, SliderField } from '@/components/ui'
import { spring } from '@/design/motion'
import { outputName } from '@/lib/filename'
import { useSettings } from '@/stores/settings'
import { useT, type TKey } from '@/i18n'
import { PAPERS, resizePages, type PaperId, type ResizeOptions } from '../lib/acrobat'
import { MM_TO_PT } from '../lib/ops'
import { sourceBytes, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { PageThumb } from '../components/PageThumb'
import { ToolFrame } from '../components/Frame'
import { PanelFooter, PanelSection, ToolPanel } from '../components/Shared'
import { PAPER_IDS } from './LayoutTool'

export function ResizeTool() {
  const t = useT()
  const runner = useRunner()
  return (
    <ToolFrame tool="resize" runner={runner} workingTitle={t('pdf.resize.working')} resetLabel={t('pdf.resize.again')}>
      {(source) => <Editor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

/** 示意：原頁面縮放後放進新紙張（紙張尺寸與內容框以彈簧變形） */
function Preview({ source, o }: { source: PdfSource; o: ResizeOptions }) {
  const t = useT()
  const s = source.sizes[0] ?? { w: 595, h: 842 }
  const [pw, ph] = o.paper === 'custom' ? [o.custom?.w ?? 595, o.custom?.h ?? 842] : PAPERS[o.paper]
  const landscape = o.orientation === 'auto' ? s.w > s.h : o.orientation === 'landscape'
  const W = landscape ? Math.max(pw, ph) : Math.min(pw, ph)
  const H = landscape ? Math.min(pw, ph) : Math.max(pw, ph)
  const m = Math.min(o.margin, W / 3, H / 3)
  const k = o.mode === 'fit' ? Math.min((W - 2 * m) / s.w, (H - 2 * m) / s.h) : Math.max((W - 2 * m) / s.w, (H - 2 * m) / s.h)
  const cw = (s.w * k) / W
  const ch = (s.h * k) / H
  const box = 300
  const scale = box / Math.max(W, H)
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <motion.div
        className="relative overflow-hidden rounded-[4px] bg-white shadow-e3 ring-1 ring-border"
        animate={{ width: W * scale, height: H * scale }}
        transition={spring.smooth}
      >
        <motion.div
          className="absolute rounded-[2px] border border-dashed border-[var(--accent)]"
          animate={{
            left: `${(m / W) * 100}%`,
            top: `${(m / H) * 100}%`,
            right: `${(m / W) * 100}%`,
            bottom: `${(m / H) * 100}%`,
          }}
          transition={spring.smooth}
        />
        <motion.div
          className="absolute overflow-hidden shadow-e1"
          animate={{
            width: `${cw * 100}%`,
            height: `${ch * 100}%`,
            left: `${((1 - cw) / 2) * 100}%`,
            top: `${((1 - ch) / 2) * 100}%`,
          }}
          transition={spring.smooth}
        >
          <PageThumb docId={source.id} index={0} aspect={s.w / s.h} renderWidth={320} className="size-full" />
        </motion.div>
      </motion.div>
      <p className="text-small tabular-nums text-text-2">
        {t('pdf.resize.target', { w: Math.round(W / MM_TO_PT), h: Math.round(H / MM_TO_PT) })}
      </p>
    </div>
  )
}

function Editor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [o, setO] = useState<ResizeOptions>({
    paper: 'a4',
    orientation: 'auto',
    margin: 0,
    mode: 'fit',
    custom: { w: 210 * MM_TO_PT, h: 297 * MM_TO_PT },
  })
  const set = (p: Partial<ResizeOptions>) => setO((x) => ({ ...x, ...p }))
  const run = () => {
    const name = outputName(source.name, t('pdf.actions.resize'), 'pdf', pattern)
    void runner.start(t('pdf.resize.task', { name: source.name }), async ({ progress, signal }) => {
      const out = await resizePages(await sourceBytes(source), o, signal, progress)
      return { files: [{ blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name }] }
    })
  }
  return (
    <Workspace
      main={
        <div className="card p-5">
          <Preview source={source} o={o} />
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.resize.name')}>
          <Select<PaperId | 'custom'>
            label={t('pdf.layout.paper')}
            value={o.paper}
            onChange={(paper) => set({ paper })}
            options={[
              ...PAPER_IDS.map((p) => ({ value: p, label: t(`pdf.paper.${p}` as TKey) })),
              { value: 'custom' as const, label: t('common.custom') },
            ]}
          />
          {o.paper === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label={t('common.width')}
                suffix="mm"
                min={20}
                max={5000}
                value={Math.round((o.custom?.w ?? 595) / MM_TO_PT)}
                onChange={(v) => set({ custom: { w: v * MM_TO_PT, h: o.custom?.h ?? 842 } })}
              />
              <NumberField
                label={t('common.height')}
                suffix="mm"
                min={20}
                max={5000}
                value={Math.round((o.custom?.h ?? 842) / MM_TO_PT)}
                onChange={(v) => set({ custom: { w: o.custom?.w ?? 595, h: v * MM_TO_PT } })}
              />
            </div>
          )}
          <PanelSection title={t('pdf.resize.orientation')}>
            <SegmentedControl<ResizeOptions['orientation']>
              label={t('pdf.resize.orientation')}
              full
              size="sm"
              value={o.orientation}
              onChange={(orientation) => set({ orientation })}
              options={[
                { value: 'auto', label: t('common.auto') },
                { value: 'portrait', label: t('pdf.resize.portrait') },
                { value: 'landscape', label: t('pdf.resize.landscape') },
              ]}
            />
          </PanelSection>
          <PanelSection title={t('pdf.resize.fit')}>
            <SegmentedControl<'fit' | 'fill'>
              label={t('pdf.resize.fit')}
              full
              size="sm"
              value={o.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { value: 'fit', label: t('pdf.resize.contain') },
                { value: 'fill', label: t('pdf.resize.cover') },
              ]}
            />
          </PanelSection>
          <SliderField
            label={t('pdf.layout.margin')}
            value={Math.round(o.margin / MM_TO_PT)}
            min={0}
            max={40}
            format={(v) => `${v} mm`}
            onChange={(v) => set({ margin: v * MM_TO_PT })}
          />
          <p className="text-caption text-text-3">{t('pdf.resize.note')}</p>
          <PanelFooter>
            <Button variant="primary" size="lg" className="w-full" leading={<Ratio size={18} aria-hidden />} onClick={run}>
              {t('pdf.resize.run')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
