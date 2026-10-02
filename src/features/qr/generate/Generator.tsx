import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, Download, Layers, QrCode } from 'lucide-react'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Badge, Button, Callout, CopyButton, ErrorState, SendToMenu, Tooltip, toast } from '@/components/ui'
import { asFile } from '@/stores/fileBus'
import { useRecents } from '@/stores/recents'
import { useSettings } from '@/stores/settings'
import { useModuleShortcuts } from '@/stores/ui'
import { caps, modKey } from '@/lib/capabilities'
import { copyBlob, downloadBlob } from '@/lib/download'
import { sanitizeFilename } from '@/lib/filename'
import { cn } from '@/lib/cn'
import { duration, easing, scale, sec, spring } from '@/design/motion'
import { useT } from '@/i18n'
import { BYTE_CAPACITY, contentSlug, utf8Length } from '../lib/content'
import { checkContrast } from '../lib/color'
import { exportBlob, type ExportFormat } from '../lib/render'
import { foregroundColors } from '../lib/style'
import { QrArt } from '../components/QrArt'
import { useQrStore } from '../store'
import { BatchDialog } from './BatchDialog'
import { ContentForm } from './ContentForm'
import { LogoNotice, StylePanel } from './StylePanel'
import { Templates } from './Templates'
import { TypePicker } from './TypePicker'
import { useLogoImage, useQr, type QrComputed } from './useQr'

const breatheVars = { '--qr-breathe': `${duration.hero * 3}ms` } as CSSProperties

export function Generator() {
  const t = useT()
  const type = useQrStore((s) => s.type)
  const setType = useQrStore((s) => s.setType)
  const qr = useQr()
  const [batchOpen, setBatchOpen] = useState(false)

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_var(--panel-w)] lg:gap-6">
      {/* 內容：類型＋表單 */}
      <section className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">
        <TypePicker value={type} onChange={setType} />
        <motion.div layout transition={spring.smooth} className="card p-4 sm:p-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={type}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: sec(duration.fast), ease: easing.standard }}
            >
              <h2 className="text-h3 font-semibold">{t(`qr.types.${type}.label`)}</h2>
              <p className="mb-4 mt-0.5 text-small text-text-3">{t(`qr.types.${type}.desc`)}</p>
              <ContentForm type={type} />
            </motion.div>
          </AnimatePresence>
          <CapacityMeter content={qr.content} />
        </motion.div>
      </section>

      {/* 預覽與匯出（桌機 sticky 在右側；手機排在表單與樣式之間） */}
      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--topbar-h)+16px)] lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <PreviewPanel qr={qr} onBatch={() => setBatchOpen(true)} />
        <Templates />
      </aside>

      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <StylePanel />
      </div>
      <BatchDialog open={batchOpen} onOpenChange={setBatchOpen} />
    </div>
  )
}

/** 容量提示：內容越長 QR 越密 */
function CapacityMeter({ content }: { content: string }) {
  const t = useT()
  const ecc = useQrStore((s) => (s.style.logo ? 'H' : s.style.ecc))
  if (!content) {
    return <p className="mt-4 text-caption text-text-3">{t('qr.form.required')}</p>
  }
  const used = utf8Length(content)
  const max = BYTE_CAPACITY[ecc]
  const ratio = Math.min(1, used / max)
  const tone = ratio > 1 - 1e-9 ? 'danger' : ratio > 0.5 ? 'warning' : 'accent'
  return (
    <div className="mt-5 flex flex-col gap-1.5 border-t border-border pt-4">
      <div className="flex items-baseline justify-between gap-2 text-caption max-sm:justify-end">
        <span className="hidden text-text-3 sm:inline">{t('qr.form.capacityHint')}</span>
        <span className="shrink-0 tabular-nums text-text-2">
          {t('qr.form.capacity', { used, max })}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_8%,transparent)]">
        <div
          className="h-full origin-left rounded-full transition-transform duration-(--dur-base) ease-standard"
          style={{
            transform: `scaleX(${Math.max(0.01, ratio)})`,
            background: `var(--${tone === 'accent' ? 'accent' : tone})`,
          }}
        />
      </div>
    </div>
  )
}

/** 匯出檔名：qr_類型_摘要.ext */
function exportName(ext: string) {
  const s = useQrStore.getState()
  const slug = sanitizeFilename(contentSlug(s.type, s.values[s.type]), '')
  return sanitizeFilename(`qr_${s.type}${slug ? `_${slug}` : ''}`) + `.${ext}`
}

function PreviewPanel({ qr, onBatch }: { qr: QrComputed; onBatch: () => void }) {
  const t = useT()
  const style = useQrStore((s) => s.style)
  const tab = useQrStore((s) => s.tab)
  const quality = useSettings((s) => s.imageQuality)
  const logo = useLogoImage(style)
  const { geo, matrix, error, displayType } = qr
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  // 漣漪：第一次出現（從空白到有內容）與換內容類型時播放
  const [appear, setAppear] = useState(0)
  const [had, setHad] = useState(false)
  if (!!geo !== had) {
    setHad(!!geo)
    if (geo) setAppear((a) => a + 1)
  }
  const trigger = `${displayType}-${appear}`
  const [played, setPlayed] = useState<string | null>(null)
  const ripple = !!geo && played !== trigger
  const onRippleEnd = useCallback(() => setPlayed(trigger), [trigger])

  const contrast = checkContrast(foregroundColors(style), style.bgTransparent ? '#FFFFFF' : style.bg)
  const logoReady = !style.logo || !!logo

  const doExport = useCallback(
    async (format: ExportFormat) => {
      if (!geo) return
      setBusy(format)
      try {
        const blob = await exportBlob(geo, style, format, { quality, logo })
        const name = exportName(format)
        downloadBlob(blob, name)
        useRecents.getState().visit('qr', name)
      } catch (e) {
        console.error(e)
        toast.error(t('qr.export.failed'), { description: t('qr.export.failedDesc') })
      } finally {
        setBusy(null)
      }
    },
    [geo, style, quality, logo, t],
  )

  const copy = useCallback(async () => {
    if (!geo) return false
    try {
      const blob = await exportBlob(geo, style, 'png', { logo, size: Math.min(style.size, 1024) })
      return await copyBlob(blob)
    } catch (e) {
      console.error(e)
      return false
    }
  }, [geo, style, logo])

  // 快捷鍵：⌘／Ctrl+S 下載 PNG、⌘／Ctrl+Shift+C 複製
  useModuleShortcuts(
    tab === 'generate'
      ? [
          { keys: [modKey(), 'S'], label: t('qr.shortcuts.download') },
          { keys: [modKey(), 'Shift', 'C'], label: t('qr.shortcuts.copy') },
        ]
      : [],
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !geo) return
      const k = e.key.toLowerCase()
      if (k === 's' && !e.shiftKey) {
        e.preventDefault()
        void doExport('png')
      } else if (k === 'c' && e.shiftKey) {
        e.preventDefault()
        void copy().then((ok) => !ok && toast.error(t('common.copyFailed')))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [geo, doExport, copy, t])

  const canCopy = caps.clipboardWrite()
  const disabled = !geo || !logoReady

  return (
    <section className="card flex flex-col gap-4 p-4" aria-labelledby="qr-preview-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="qr-preview-title" className="text-h3 font-semibold">
          {t('qr.preview.title')}
        </h2>
        {matrix && (
          <Badge tone="neutral" className="tabular-nums">
            {t('qr.preview.version', { version: matrix.version, n: matrix.n })}
          </Badge>
        )}
      </div>

      <div
        className={cn(
          'relative grid aspect-square w-full place-items-center overflow-hidden rounded-xl p-4',
          style.bgTransparent && geo ? 'qr-checker' : 'bg-surface-2',
        )}
        style={breatheVars}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {geo ? (
            <motion.div
              key={`qr-${displayType}`}
              className={cn(
                'size-full overflow-hidden',
                !style.bgTransparent && 'rounded-md shadow-e2',
              )}
              initial={{ opacity: 0, scale: scale.dialogFrom }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: sec(duration.base), ease: easing.emphasized }}
            >
              <QrArt
                geo={geo}
                style={style}
                idPrefix="qr-preview"
                ripple={ripple}
                onRippleEnd={onRippleEnd}
                label={t('qr.preview.alt', { content: qr.shown.content.slice(0, 200) })}
              />
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full"
            >
              <ErrorState
                className="px-2 py-4"
                title={error === 'tooLong' ? t('qr.preview.tooLong') : t('qr.preview.failed')}
                description={error === 'tooLong' ? t('qr.preview.tooLongDesc') : t('qr.preview.failedDesc')}
              />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center px-4 text-center"
            >
              <span className="qr-ghost motion-decor mb-4 grid size-20 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-accent-ink">
                <QrCode size={40} strokeWidth={1.6} aria-hidden />
              </span>
              <p className="text-body font-semibold text-text">{t('qr.preview.empty')}</p>
              <p className="mt-1 hidden text-small text-text-3 lg:block">{t('qr.preview.emptyDesc')}</p>
              <p className="mt-1 text-small text-text-3 lg:hidden">{t('qr.preview.emptyDescMobile')}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {geo && contrast.issue && (
          <motion.div
            key={contrast.issue}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring.smooth}
          >
            <Callout
              tone="warning"
              icon={<AlertTriangle size={16} aria-hidden />}
              title={contrast.issue === 'low' ? t('qr.preview.contrastLow') : t('qr.preview.contrastInverted')}
            >
              {contrast.issue === 'low'
                ? t('qr.preview.contrastLowDesc', { ratio: contrast.ratio.toFixed(1) })
                : t('qr.preview.contrastInvertedDesc')}
            </Callout>
          </motion.div>
        )}
      </AnimatePresence>
      {geo && style.bgTransparent && !contrast.issue && (
        <p className="text-caption text-text-3">{t('qr.preview.transparentNote')}</p>
      )}
      <LogoNotice />

      <div className="flex flex-col gap-2">
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
            disabled={disabled}
            loading={busy === 'svg'}
            aria-label={t('qr.export.svgLabel')}
            onClick={() => void doExport('svg')}
          >
            {t('qr.export.svg')}
          </Button>
          <Button
            variant="secondary"
            disabled={disabled}
            loading={busy === 'jpg'}
            aria-label={t('qr.export.jpgLabel')}
            onClick={() => void doExport('jpg')}
          >
            {t('qr.export.jpg')}
          </Button>
          {canCopy ? (
            <CopyButton variant="secondary" disabled={disabled} iconOnly label={t('qr.export.copy')} onCopy={copy} className="w-full" />
          ) : (
            <Tooltip content={t('qr.export.copyUnsupported')}>
              <span className="inline-flex">
                <CopyButton variant="secondary" disabled iconOnly label={t('qr.export.copy')} onCopy={() => false} className="w-full" />
              </span>
            </Tooltip>
          )}
        </div>
        <p className="text-center text-caption tabular-nums text-text-3">
          {t('qr.export.sizeNote', { size: style.size })}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          variant="ghost"
          size="sm"
          leading={<Layers size={15} aria-hidden />}
          onClick={onBatch}
        >
          {t('qr.batch.open')}
        </Button>
        <div className="ml-auto">
          <SendToMenu
            from="qr"
            size="sm"
            variant="ghost"
            targets={['tools', 'convert', 'pdf']}
            getFiles={async () => {
              if (!geo) return []
              const blob = await exportBlob(geo, style, 'png', { logo })
              return [asFile(blob, exportName('png'))]
            }}
          />
        </div>
      </div>
    </section>
  )
}
