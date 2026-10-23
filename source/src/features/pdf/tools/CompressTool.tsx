import { motion } from 'motion/react'
import { ArrowRight, Minimize2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import {
  AnimatedNumber,
  Badge,
  Callout,
  Button,
  SegmentedControl,
  SliderField,
  Switch,
} from '@/components/ui'
import { spring } from '@/design/motion'
import { canvasToBlob, createCanvas, releaseCanvas } from '@/lib/image'
import { formatBytes, percentChange } from '@/lib/format'
import { outputName } from '@/lib/filename'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { rebuildFromImages, type EncodedImage } from '../lib/ops'
import { renderToCanvas } from '../lib/pdfjs'
import { getDoc, sourceBytes, type PdfSource } from '../store'
import { ResultCard } from '../components/ResultCard'
import { Working } from '../components/Working'
import { useRunner, type Runner } from '../components/useRunner'
import {
  PanelSection,
  PdfDrop,
  SourceBar,
  useActiveSource,
  useStage,
  ToolPanel,
  PanelFooter,
} from '../components/Shared'

type Preset = 'small' | 'balanced' | 'clear' | 'custom'
const PRESETS: Record<Exclude<Preset, 'custom'>, { dpi: number; quality: number }> = {
  small: { dpi: 96, quality: 55 },
  balanced: { dpi: 130, quality: 70 },
  clear: { dpi: 170, quality: 82 },
}

interface CompressData {
  before: number
  after: number
}

export function CompressTool() {
  const t = useT()
  const source = useActiveSource()
  const runner = useRunner<CompressData>()
  useStage(
    runner.phase === 'working'
      ? 'working'
      : runner.phase === 'done'
        ? 'done'
        : source
          ? 'ready'
          : 'empty',
  )
  if (!source) return <PdfDrop />
  const renderDone = () => {
    if (!runner.output?.data) return null
    const { before, after } = runner.output.data
    const change = percentChange(before, after)
    const bigger = after >= before
    return (
      <ResultCard
        files={runner.output.files}
        onReset={runner.reset}
        resetLabel={t('pdf.compress.backToEdit')}
        summary={
          <span className="flex flex-wrap items-center gap-2 tabular-nums">
            <span>{formatBytes(before)}</span>
            <ArrowRight size={14} aria-hidden className="text-text-3" />
            <AnimatedNumber
              value={after}
              format={(v) => formatBytes(v)}
              className="font-semibold text-text"
            />
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={spring.bouncy}
            >
              <Badge tone={bigger ? 'warning' : 'success'}>
                {bigger
                  ? t('common.increased', { value: `${Math.abs(change).toFixed(0)}%` })
                  : t('common.saved', { value: `${Math.abs(change).toFixed(0)}%` })}
              </Badge>
            </motion.span>
          </span>
        }
      >
        {bigger && (
          <Callout
            tone="warning"
            icon={<TriangleAlert size={16} />}
            title={t('pdf.compress.biggerTitle')}
          >
            {t('pdf.compress.biggerDesc')}
          </Callout>
        )}
      </ResultCard>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {runner.phase === 'working' && (
        <Working
          title={t('pdf.compress.working')}
          progress={runner.progress}
          onCancel={runner.cancel}
        />
      )}
      {runner.phase === 'done' && runner.output?.data && renderDone()}
      <div hidden={runner.phase !== 'idle'} className="flex flex-col gap-3">
        <SourceBar source={source} />
        {source.status === 'ready' && (
          <Compressor key={source.id} source={source} runner={runner} />
        )}
      </div>
    </div>
  )
}

function Compressor({ source, runner }: { source: PdfSource; runner: Runner<CompressData> }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [preset, setPreset] = useState<Preset>('balanced')
  const [dpi, setDpi] = useState(PRESETS.balanced.dpi)
  const [quality, setQuality] = useState(PRESETS.balanced.quality)
  const [gray, setGray] = useState(false)

  const choose = (p: Preset) => {
    setPreset(p)
    if (p !== 'custom') {
      setDpi(PRESETS[p].dpi)
      setQuality(PRESETS[p].quality)
    }
  }

  const run = () => {
    const opts = { dpi, quality, gray }
    const name = outputName(source.name, t('pdf.actions.compress'), 'pdf', pattern)
    void runner.start(
      t('pdf.compress.task', { name: source.name }),
      async ({ signal, progress }) => {
        const doc = await getDoc(source.id)
        const pages: Array<{ image: EncodedImage; size: { w: number; h: number } }> = []
        for (let i = 1; i <= doc.numPages; i++) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          const page = await doc.getPage(i)
          try {
            const vp = page.getViewport({ scale: 1 })
            const canvas = await renderToCanvas(page, opts.dpi / 72, { signal })
            try {
              const target = opts.gray ? toGray(canvas) : canvas
              const blob = await canvasToBlob(target, 'image/jpeg', opts.quality / 100)
              if (target !== canvas) releaseCanvas(target)
              pages.push({
                image: {
                  bytes: new Uint8Array(await blob.arrayBuffer()),
                  type: 'jpg',
                  width: canvas.width,
                  height: canvas.height,
                },
                size: { w: vp.width, h: vp.height },
              })
            } finally {
              releaseCanvas(canvas)
            }
          } finally {
            page.cleanup()
          }
          progress((i / doc.numPages) * 0.9)
        }
        const original = await sourceBytes(source)
        const out = await rebuildFromImages(pages, source.encrypted ? undefined : original, signal)
        progress(1)
        return {
          files: [
            { blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name },
          ],
          data: { before: source.size, after: out.byteLength },
        }
      },
    )
  }

  return (
    <Workspace
      main={
        <div className="flex flex-col gap-3">
          <Callout
            tone="warning"
            icon={<TriangleAlert size={16} />}
            title={t('pdf.compress.warnTitle')}
          >
            {t('pdf.compress.warnDesc')}
          </Callout>
          <div className="card grid gap-4 p-5 sm:grid-cols-3">
            {(['small', 'balanced', 'clear'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => choose(p)}
                aria-pressed={preset === p}
                className={`flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors duration-(--dur-fast) ${
                  preset === p
                    ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]'
                    : 'border-border hover:border-border-strong'
                }`}
              >
                <span className="text-body font-semibold">{t(`pdf.compress.${p}`)}</span>
                <span className="text-small text-text-2">{t(`pdf.compress.${p}Desc`)}</span>
                <span className="mt-1 text-caption tabular-nums text-text-3">
                  {PRESETS[p].dpi} dpi · {t('common.quality')} {PRESETS[p].quality}
                </span>
              </button>
            ))}
          </div>
          {source.encrypted && <Callout tone="accent">{t('pdf.compress.encryptedNote')}</Callout>}
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.compress.name')}>
          <SegmentedControl
            full
            label={t('pdf.compress.preset')}
            value={preset}
            onChange={choose}
            options={[
              { value: 'small', label: t('pdf.compress.small') },
              { value: 'balanced', label: t('pdf.compress.balanced') },
              { value: 'clear', label: t('pdf.compress.clear') },
              { value: 'custom', label: t('common.custom') },
            ]}
          />
          <PanelSection>
            <SliderField
              label={t('pdf.toImages.dpi')}
              value={dpi}
              onChange={(v) => {
                setDpi(v)
                setPreset('custom')
              }}
              min={72}
              max={220}
              format={(v) => `${v} dpi`}
            />
            <SliderField
              label={t('common.quality')}
              value={quality}
              onChange={(v) => {
                setQuality(v)
                setPreset('custom')
              }}
              min={20}
              max={95}
              format={(v) => `${v}`}
            />
            <Switch
              label={t('pdf.compress.gray')}
              description={t('pdf.compress.grayDesc')}
              checked={gray}
              onChange={setGray}
            />
          </PanelSection>
          <p className="text-caption tabular-nums text-text-3">
            {t('pdf.compress.original', {
              size: formatBytes(source.size),
              pages: source.pageCount,
            })}
          </p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              leading={<Minimize2 size={18} aria-hidden />}
              onClick={run}
            >
              {t('pdf.compress.start')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}

/** 轉成灰階（不依賴 ctx.filter，Safari 也適用） */
function toGray(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
    d[i] = d[i + 1] = d[i + 2] = y
  }
  ctx.putImageData(img, 0, 0)
  return c
}
