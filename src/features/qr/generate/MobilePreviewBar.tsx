import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
  Copy,
  Download,
  FileCode2,
  FileImage,
  Layers,
  Maximize2,
  MoreHorizontal,
  QrCode,
} from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, CopyButton, Menu, Sheet, toast } from '@/components/ui'
import { caps } from '@/lib/capabilities'
import { cn } from '@/lib/cn'
import { duration, easing, scale, sec } from '@/design/motion'
import { useT } from '@/i18n'
import { checkContrast } from '../lib/color'
import { foregroundColors } from '../lib/style'
import { QrArt } from '../components/QrArt'
import type { QrComputed } from './useQr'
import { useExporter } from './useExporter'

/**
 * 手機與平板（< 1024 px）的常駐精簡預覽：sticky 在頂欄下方，
 * 左邊 QR 縮圖（點了展開完整預覽 Sheet），右邊類型／版本與「下載 PNG」＋「更多」。
 * 桌機隱藏，改用右側的完整預覽卡。
 */
export function MobilePreviewBar({
  qr,
  ripple,
  onRippleEnd,
  onBatch,
}: {
  qr: QrComputed
  ripple: boolean
  onRippleEnd: () => void
  onBatch: () => void
}) {
  const t = useT()
  const { geo, matrix, error, displayType } = qr
  const { style, busy, logoReady, doExport, copy } = useExporter(geo)
  const [open, setOpen] = useState(false)
  const contrast = checkContrast(
    foregroundColors(style),
    style.bgTransparent ? '#FFFFFF' : style.bg,
  )
  const disabled = !geo || !logoReady
  const canCopy = caps.clipboardWrite()

  const status = error
    ? t('qr.preview.tooLong')
    : geo && contrast.issue
      ? t('qr.mobile.mayFail')
      : matrix
        ? t('qr.preview.version', { version: matrix.version, n: matrix.n })
        : t('qr.preview.empty')

  const thumb = (
    <div
      className={cn(
        'relative grid size-[72px] shrink-0 place-items-center overflow-hidden rounded-md sm:size-[88px]',
        style.bgTransparent && geo ? 'qr-checker' : 'bg-surface-2',
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {geo ? (
          <motion.div
            key={`mini-${displayType}`}
            className="size-full"
            initial={{ opacity: 0, scale: scale.dialogFrom }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: sec(duration.base), ease: easing.emphasized }}
          >
            {/* 精簡縮圖不需要大邊距，視覺上比較大 */}
            <QrArt
              geo={geo}
              style={style}
              idPrefix="qr-mini"
              ripple={ripple}
              onRippleEnd={onRippleEnd}
            />
          </motion.div>
        ) : (
          <motion.span
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn('grid place-items-center', error ? 'text-danger-ink' : 'text-text-3')}
          >
            {error ? (
              <AlertTriangle size={26} aria-hidden />
            ) : (
              <QrCode size={30} strokeWidth={1.6} aria-hidden />
            )}
          </motion.span>
        )}
      </AnimatePresence>
      {geo && (
        <span
          aria-hidden
          className="glass absolute bottom-1 right-1 grid size-6 place-items-center rounded-full text-text shadow-e1"
        >
          <Maximize2 size={12} />
        </span>
      )}
    </div>
  )

  return (
    <>
      <div
        className="glass sticky top-[calc(var(--topbar-h)+8px)] z-20 flex items-center gap-3 rounded-xl p-2 shadow-e3 lg:hidden"
        style={{ background: 'color-mix(in srgb, var(--surface) 90%, transparent)' }}
      >
        {geo ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t('qr.mobile.expand')}
            className="rounded-md"
          >
            {thumb}
          </button>
        ) : (
          thumb
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="flex min-w-0 items-center gap-1.5 text-caption" aria-live="polite">
            <span className="shrink-0 font-semibold text-text">
              {t(`qr.types.${displayType}.label`)}
            </span>
            <span aria-hidden className="text-text-3">
              ・
            </span>
            <span
              className={cn(
                'truncate tabular-nums',
                error || (geo && contrast.issue) ? 'text-warning-ink' : 'text-text-3',
              )}
            >
              {status}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              className="min-w-0 flex-1 max-sm:h-11"
              disabled={disabled}
              loading={busy === 'png'}
              leading={<Download size={16} aria-hidden />}
              onClick={() => void doExport('png')}
            >
              {t('qr.export.png')}
            </Button>
            <Menu
              label={t('qr.mobile.more')}
              trigger={
                <Button
                  variant="secondary"
                  icon
                  aria-label={t('qr.mobile.more')}
                  className="max-sm:size-11"
                >
                  <MoreHorizontal size={18} aria-hidden />
                </Button>
              }
              items={[
                {
                  key: 'svg',
                  label: t('qr.export.svgLabel'),
                  icon: <FileCode2 size={16} aria-hidden />,
                  disabled,
                  onSelect: () => void doExport('svg'),
                },
                {
                  key: 'jpg',
                  label: t('qr.export.jpgLabel'),
                  icon: <FileImage size={16} aria-hidden />,
                  disabled,
                  onSelect: () => void doExport('jpg'),
                },
                {
                  key: 'copy',
                  label: canCopy ? t('qr.export.copy') : t('qr.export.copyUnsupported'),
                  icon: <Copy size={16} aria-hidden />,
                  disabled: disabled || !canCopy,
                  onSelect: () =>
                    void copy().then((ok) =>
                      ok ? toast.success(t('common.copied')) : toast.error(t('common.copyFailed')),
                    ),
                },
                {
                  key: 'batch',
                  label: t('qr.batch.open'),
                  icon: <Layers size={16} aria-hidden />,
                  onSelect: onBatch,
                },
              ]}
            />
          </div>
        </div>
      </div>

      <Sheet open={open && !!geo} onOpenChange={setOpen} title={t('qr.preview.title')}>
        {geo && (
          <div className="mx-auto flex w-full max-w-[420px] flex-col gap-4 pb-2">
            <div className="flex justify-center">
              {matrix && (
                <Badge tone="neutral" className="tabular-nums">
                  {t('qr.preview.version', { version: matrix.version, n: matrix.n })}
                </Badge>
              )}
            </div>
            <div
              className={cn(
                'grid aspect-square w-full place-items-center overflow-hidden rounded-xl p-3',
                style.bgTransparent ? 'qr-checker' : 'bg-surface-2',
              )}
            >
              <div
                className={cn(
                  'size-full overflow-hidden',
                  !style.bgTransparent && 'rounded-md shadow-e2',
                )}
              >
                <QrArt
                  geo={geo}
                  style={style}
                  idPrefix="qr-sheet"
                  label={t('qr.preview.alt', { content: qr.shown.content.slice(0, 200) })}
                />
              </div>
            </div>
            {contrast.issue && (
              <p className="flex items-start gap-2 text-small text-warning-ink">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                {contrast.issue === 'low'
                  ? t('qr.preview.contrastLow')
                  : t('qr.preview.contrastInverted')}
              </p>
            )}
            <Button
              variant="primary"
              size="lg"
              disabled={disabled}
              loading={busy === 'png'}
              leading={<Download size={18} aria-hidden />}
              onClick={() => void doExport('png')}
            >
              {t('qr.export.png')}
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="secondary"
                className="h-11"
                disabled={disabled}
                loading={busy === 'svg'}
                aria-label={t('qr.export.svgLabel')}
                onClick={() => void doExport('svg')}
              >
                {t('qr.export.svg')}
              </Button>
              <Button
                variant="secondary"
                className="h-11"
                disabled={disabled}
                loading={busy === 'jpg'}
                aria-label={t('qr.export.jpgLabel')}
                onClick={() => void doExport('jpg')}
              >
                {t('qr.export.jpg')}
              </Button>
              <CopyButton
                variant="secondary"
                className="h-11 w-full"
                disabled={disabled || !canCopy}
                iconOnly
                label={canCopy ? t('qr.export.copy') : t('qr.export.copyUnsupported')}
                onCopy={copy}
              />
            </div>
            <p className="text-center text-caption tabular-nums text-text-3">
              {t('qr.export.sizeNote', { size: style.size })}
            </p>
          </div>
        )}
      </Sheet>
    </>
  )
}
