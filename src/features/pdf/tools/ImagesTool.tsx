import { motion } from 'motion/react'
import { ArrowDownAZ, BookOpen, FileImage, RotateCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import {
  AddFilesButton,
  Button,
  DropZone,
  FileName,
  SegmentedControl,
  SliderField,
  SortableList,
  Skeleton,
  Tooltip,
} from '@/components/ui'
import { EmptyIllustration } from '@/design/illustrations'
import { spring } from '@/design/motion'
import { formatBytes } from '@/lib/format'
import { sanitizeFilename, splitExt } from '@/lib/filename'
import { asFile } from '@/stores/fileBus'
import { useT } from '@/i18n'
import {
  MM_TO_PT,
  imagesToPdf,
  layoutImage,
  type FitMode,
  type OrientationMode,
  type PageSizeMode,
} from '../lib/ops'
import { encodeForPdf } from '../lib/raster'
import { addImageFiles, useImages, type ImageItem } from '../imageStore'
import { addPdfFiles, usePdf } from '../store'
import { ResultCard } from '../components/ResultCard'
import { Working } from '../components/Working'
import { useRunner } from '../components/useRunner'
import {
  IMAGE_ACCEPT,
  PanelSection,
  useGoTool,
  useStage,
  ToolPanel,
  PanelFooter,
} from '../components/Shared'

export function ImagesTool() {
  const t = useT()
  const items = useImages((s) => s.items)
  const setItems = useImages((s) => s.set)
  const patch = useImages((s) => s.patch)
  const removeItem = useImages((s) => s.remove)
  const clear = useImages((s) => s.clear)
  const go = useGoTool()
  const runner = useRunner()
  const [pageSize, setPageSize] = useState<PageSizeMode>('a4')
  const [orientation, setOrientation] = useState<OrientationMode>('auto')
  const [marginMm, setMarginMm] = useState(10)
  const [fit, setFit] = useState<FitMode>('contain')
  const [previewId, setPreviewId] = useState<string | null>(null)
  useStage(
    runner.phase === 'working'
      ? 'working'
      : runner.phase === 'done'
        ? 'done'
        : items.length
          ? 'ready'
          : 'empty',
  )

  const ready = items.filter((i) => i.status === 'ready')
  const loading = items.some((i) => i.status === 'loading')
  const opts = { pageSize, orientation, margin: marginMm * MM_TO_PT, fit }

  const build = () => {
    const list = ready
    const first = list[0]
    const name = `${sanitizeFilename(splitExt(first.name).base)}${list.length > 1 ? `_${t('pdf.images.etc', { count: list.length })}` : ''}.pdf`
    void runner.start(
      t('pdf.images.task', { count: list.length }),
      async ({ signal, progress }) => {
        const encoded = []
        for (let i = 0; i < list.length; i++) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          const enc = await encodeForPdf(list[i].file)
          encoded.push({ ...enc, rotation: list[i].rotation })
          progress((i + 1) / list.length / 2)
        }
        const out = await imagesToPdf(encoded, opts, signal, (p) => progress(0.5 + p / 2))
        return {
          files: [
            { blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name },
          ],
        }
      },
    )
  }

  if (runner.phase === 'working')
    return (
      <Working
        title={t('pdf.images.working', { count: ready.length })}
        progress={runner.progress}
        onCancel={runner.cancel}
      />
    )
  if (runner.phase === 'done' && runner.output) {
    const file = runner.output.files[0]
    return (
      <ResultCard
        files={runner.output.files}
        summary={t('pdf.images.done', { count: ready.length, size: formatBytes(file.blob.size) })}
        onReset={runner.reset}
        resetLabel={t('pdf.images.backToEdit')}
        actions={
          <Button
            variant="secondary"
            leading={<BookOpen size={16} aria-hidden />}
            onClick={async () => {
              await addPdfFiles([asFile(file.blob, file.name)])
              const s = usePdf.getState().sources
              usePdf.getState().setActive(s[s.length - 1].id)
              go('viewer')
            }}
          >
            {t('pdf.result.openViewer')}
          </Button>
        }
      />
    )
  }

  if (!items.length)
    return (
      <div>
        <DropZone
          onFiles={(f) => void addImageFiles(f)}
          accept={IMAGE_ACCEPT}
          formats={t('pdf.images.formats')}
          title={t('pdf.images.dropTitle')}
          illustration={<EmptyIllustration module="pdf" />}
        />
      </div>
    )

  const preview = ready.find((i) => i.id === previewId) ?? ready[0]
  return (
    <Workspace
      main={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-small text-text-2">{t('pdf.images.hint')}</p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                leading={<ArrowDownAZ size={16} aria-hidden />}
                onClick={() =>
                  setItems(
                    [...items].sort((a, b) =>
                      a.name.localeCompare(b.name, undefined, {
                        numeric: true,
                        sensitivity: 'base',
                      }),
                    ),
                  )
                }
              >
                {t('pdf.images.sortName')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leading={<Trash2 size={16} aria-hidden />}
                onClick={clear}
              >
                {t('common.clearAll')}
              </Button>
              <AddFilesButton
                onFiles={(f) => void addImageFiles(f)}
                accept={IMAGE_ACCEPT}
                size="sm"
              />
            </div>
          </div>
          <SortableList
            layout="grid"
            className="grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
            items={items}
            getId={(i) => i.id}
            onReorder={setItems}
            label={t('pdf.images.listLabel')}
            render={(it, i, handle) => (
              <ImageCard
                item={it}
                index={i}
                handle={handle}
                active={preview?.id === it.id}
                onPreview={() => setPreviewId(it.id)}
                onRotate={() => patch(it.id, { rotation: it.rotation + 90 })}
                onRemove={() => removeItem(it.id)}
              />
            )}
          />
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.images.settings')}>
          <PanelSection title={t('pdf.images.pageSize')}>
            <SegmentedControl
              full
              label={t('pdf.images.pageSize')}
              value={pageSize}
              onChange={setPageSize}
              options={[
                { value: 'a4', label: 'A4' },
                { value: 'letter', label: 'Letter' },
                { value: 'fit', label: t('pdf.images.sizeFit') },
              ]}
            />
          </PanelSection>
          <PanelSection title={t('pdf.images.orientation')}>
            <SegmentedControl
              full
              label={t('pdf.images.orientation')}
              value={orientation}
              onChange={setOrientation}
              options={[
                { value: 'auto', label: t('common.auto'), disabled: pageSize === 'fit' },
                {
                  value: 'portrait',
                  label: t('pdf.images.portrait'),
                  disabled: pageSize === 'fit',
                },
                {
                  value: 'landscape',
                  label: t('pdf.images.landscape'),
                  disabled: pageSize === 'fit',
                },
              ]}
            />
          </PanelSection>
          <PanelSection title={t('pdf.images.fit')}>
            <SegmentedControl
              full
              label={t('pdf.images.fit')}
              value={fit}
              onChange={setFit}
              options={[
                {
                  value: 'contain',
                  label: t('pdf.images.fitContain'),
                  disabled: pageSize === 'fit',
                },
                { value: 'cover', label: t('pdf.images.fitCover'), disabled: pageSize === 'fit' },
                { value: 'actual', label: t('pdf.images.fitActual'), disabled: pageSize === 'fit' },
              ]}
            />
            {pageSize === 'fit' && (
              <p className="text-caption text-text-3">{t('pdf.images.fitNote')}</p>
            )}
          </PanelSection>
          <SliderField
            label={t('pdf.images.margin')}
            value={marginMm}
            onChange={setMarginMm}
            min={0}
            max={30}
            step={1}
            format={(v) => `${v} mm`}
          />
          {preview && <LayoutPreview item={preview} opts={opts} />}
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!ready.length}
              loading={loading}
              leading={<FileImage size={18} aria-hidden />}
              onClick={build}
            >
              {t('pdf.images.start', { count: ready.length })}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}

function ImageCard({
  item,
  index,
  handle,
  active,
  onPreview,
  onRotate,
  onRemove,
}: {
  item: ImageItem
  index: number
  handle: React.ReactNode
  active: boolean
  onPreview: () => void
  onRotate: () => void
  onRemove: () => void
}) {
  const t = useT()
  return (
    <div
      className={`card flex h-full flex-col overflow-hidden ${active ? 'ring-2 ring-accent' : ''}`}
    >
      <button
        type="button"
        onClick={onPreview}
        aria-label={t('pdf.images.previewThis', { name: item.name })}
        className="relative grid aspect-square place-items-center overflow-hidden bg-surface-2 p-2"
      >
        {item.thumb ? (
          <motion.img
            src={item.thumb}
            alt=""
            draggable={false}
            className="max-h-full max-w-full rounded-[3px] object-contain shadow-e1"
            animate={{ rotate: item.rotation }}
            transition={spring.smooth}
          />
        ) : (
          <Skeleton className="absolute inset-2" />
        )}
        <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-surface/95 text-caption font-semibold tabular-nums text-text-2 shadow-e1">
          {index + 1}
        </span>
      </button>
      <div className="flex flex-col gap-0.5 px-2.5 pb-1.5 pt-2">
        <FileName name={item.name} className="text-small font-medium" />
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 truncate text-caption tabular-nums text-text-3">
            {item.status === 'ready' ? `${item.width}×${item.height}` : t('common.loading')} ·{' '}
            {formatBytes(item.size)}
          </p>
          <div className="-mr-1 flex shrink-0 items-center">
            {handle}
            <Tooltip content={t('pdf.images.rotate')}>
              <Button
                icon
                size="sm"
                variant="ghost"
                aria-label={t('pdf.images.rotate')}
                onClick={onRotate}
              >
                <RotateCw size={15} aria-hidden />
              </Button>
            </Tooltip>
            <Tooltip content={t('common.remove')}>
              <Button
                icon
                size="sm"
                variant="ghost"
                aria-label={t('common.remove')}
                onClick={onRemove}
              >
                <Trash2 size={15} aria-hidden />
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 版面預覽：用與匯出相同的計算，畫出頁面、邊距與圖片位置 */
function LayoutPreview({
  item,
  opts,
}: {
  item: ImageItem
  opts: Parameters<typeof layoutImage>[2]
}) {
  const t = useT()
  const l = layoutImage({ w: item.width, h: item.height }, item.rotation, opts)
  const maxH = 120
  const maxW = 150
  const k = Math.min(maxH / l.page.h, maxW / l.page.w)
  const r = ((item.rotation % 360) + 360) % 360
  const swap = r === 90 || r === 270
  return (
    <div className="flex items-center gap-4 rounded-md bg-surface-2 p-3">
      <motion.div
        layout
        transition={spring.smooth}
        className="paper relative overflow-hidden rounded-[3px] shadow-e2"
        style={{ width: l.page.w * k, height: l.page.h * k }}
        aria-label={t('pdf.images.previewLabel')}
        role="img"
      >
        {opts.margin > 0 && (
          <span
            aria-hidden
            className="absolute border border-dashed border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
            style={{
              left: opts.margin * k,
              top: opts.margin * k,
              right: opts.margin * k,
              bottom: opts.margin * k,
            }}
          />
        )}
        <span
          className="absolute overflow-hidden"
          style={
            l.clip
              ? {
                  left: opts.margin * k,
                  top: opts.margin * k,
                  right: opts.margin * k,
                  bottom: opts.margin * k,
                }
              : { inset: 0 }
          }
        >
          {item.thumb && (
            <img
              src={item.thumb}
              alt=""
              className="absolute max-w-none"
              style={{
                left:
                  (l.draw.x - (l.clip ? opts.margin : 0)) * k +
                  (swap ? ((l.draw.w - l.draw.h) * k) / 2 : 0),
                top:
                  (l.draw.y - (l.clip ? opts.margin : 0)) * k +
                  (swap ? ((l.draw.h - l.draw.w) * k) / 2 : 0),
                width: (swap ? l.draw.h : l.draw.w) * k,
                height: (swap ? l.draw.w : l.draw.h) * k,
                transform: `rotate(${r}deg)`,
              }}
            />
          )}
        </span>
      </motion.div>
      <div className="min-w-0 flex-1">
        <p className="text-small font-medium text-text">{t('pdf.images.previewLabel')}</p>
        <p className="mt-0.5 text-caption tabular-nums text-text-3">
          {t('pdf.images.previewSize', {
            w: Math.round((l.page.w / 72) * 25.4),
            h: Math.round((l.page.h / 72) * 25.4),
          })}
        </p>
        <FileName name={item.name} className="mt-0.5 text-caption text-text-3" />
      </div>
    </div>
  )
}
