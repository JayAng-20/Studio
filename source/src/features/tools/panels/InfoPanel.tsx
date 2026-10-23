/**
 * 中繼資料：顯示拍攝資訊；含 GPS 時以醒目警示條提示並顯示座標文字（不載入地圖，避免外連），
 * 一鍵只移除位置或全部移除。只移除資訊時不會重新壓縮。
 */
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, MapPin, ShieldCheck, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, CopyButton, SegmentedControl, Skeleton } from '@/components/ui'
import { copyText } from '@/lib/download'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { spring } from '@/design/motion'
import { useLang, useT } from '@/i18n'
import { containerMime, isPassthrough, metaEditable } from '../lib/state'
import type { MetaMode } from '../lib/types'
import { processAllAfterApply } from '../actions'
import type { ExifSummary } from '../loader'
import { useTools } from '../store'
import { Section, useEditor } from '../ui'
import { ApplyAllButton } from './common'
import { formatName } from './CompressPanel'

export function formatCoords(lat: number, lon: number) {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
}

function dms(v: number, pos: string, neg: string) {
  const a = Math.abs(v)
  const d = Math.floor(a)
  const mFloat = (a - d) * 60
  const m = Math.floor(mFloat)
  const s = (mFloat - m) * 60
  return `${d}°${m}′${s.toFixed(1)}″${v >= 0 ? pos : neg}`
}

export function formatExposure(e: ExifSummary) {
  const parts: string[] = []
  if (e.exposure)
    parts.push(
      e.exposure < 1 ? `1/${Math.round(1 / e.exposure)} s` : `${Number(e.exposure.toFixed(1))} s`,
    )
  if (e.fNumber) parts.push(`f/${Number(e.fNumber.toFixed(1))}`)
  if (e.iso) parts.push(`ISO ${e.iso}`)
  return parts.join(' · ')
}

export function InfoPanel() {
  const t = useT()
  const lang = useLang()
  const { doc, state, edit } = useEditor()
  const docCount = useTools((s) => s.docs.length)
  if (!doc || !state) return null
  const exif = doc.exif
  const meta = state.meta
  const setMeta = (m: MetaMode) => edit(t('tools.info.actions.meta'), (s) => ({ ...s, meta: m }))
  const hasCoords = exif?.latitude !== undefined && exif?.longitude !== undefined
  const editable = metaEditable(doc.container)
  // 沒有其他編輯時，只改中繼資料是無損的
  const lossless =
    editable && isPassthrough({ ...state, meta: 'strip-gps' }, doc.srcW, doc.srcH, doc.container)

  const applyAll = () => {
    const ids = useTools.getState().docs.map((d) => d.id)
    useTools.getState().editMany(ids, t('tools.info.actions.meta'), (s) => ({ ...s, meta }))
    void processAllAfterApply(t('tools.batch.taskApply', { count: ids.length }))
  }

  const rows: Array<{ label: string; value: ReactNode; gps?: boolean }> = []
  if (exif) {
    if (exif.date)
      rows.push({
        label: t('tools.info.date'),
        value: new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(
          exif.date,
        ),
      })
    const camera = [exif.make, exif.model].filter(Boolean).join(' ')
    if (camera) rows.push({ label: t('tools.info.camera'), value: camera })
    if (exif.lens) rows.push({ label: t('tools.info.lens'), value: exif.lens })
    const exp = formatExposure(exif)
    if (exp) rows.push({ label: t('tools.info.exposure'), value: exp })
    if (exif.focal)
      rows.push({
        label: t('tools.info.focal'),
        value: `${Number(exif.focal.toFixed(1))} mm${exif.focal35 && Math.round(exif.focal35) !== Math.round(exif.focal) ? ` ${t('tools.info.focal35', { mm: Math.round(exif.focal35) })}` : ''}`,
      })
    if (exif.software) rows.push({ label: t('tools.info.software'), value: exif.software })
    if (hasCoords)
      rows.push({
        label: t('tools.info.coords'),
        value: formatCoords(exif.latitude!, exif.longitude!),
        gps: true,
      })
  }
  const fileRows = [
    { label: t('tools.info.dimensions'), value: `${doc.srcW} × ${doc.srcH}` },
    { label: t('tools.info.fileSize'), value: formatBytes(doc.file.size) },
    {
      label: t('tools.info.format'),
      value: formatName(containerMime(doc.container), doc.container.toUpperCase()),
    },
  ]

  return (
    <div>
      {doc.hasGps && (
        <Section className="pt-1">
          <AnimatePresence mode="popLayout" initial={false}>
            {meta === 'keep' ? (
              <motion.div
                key={`gps-${doc.id}`}
                role="alert"
                className="tl-gps-pulse rounded-lg border border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,var(--surface))] p-3.5"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={spring.smooth}
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--warning)_22%,transparent)] text-warning-ink">
                    <MapPin size={18} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-semibold text-text">{t('tools.info.gpsTitle')}</p>
                    <p className="text-small text-text-2">{t('tools.info.gpsBody')}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-md bg-surface/80 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    {hasCoords ? (
                      <>
                        <p className="font-mono text-small tabular-nums text-text">
                          {formatCoords(exif!.latitude!, exif!.longitude!)}
                        </p>
                        <p className="font-mono text-caption text-text-3">
                          {dms(exif!.latitude!, 'N', 'S')} {dms(exif!.longitude!, 'E', 'W')}
                          {exif!.altitude !== undefined &&
                            ` · ${t('tools.info.altitude', { m: Math.round(exif!.altitude) })}`}
                        </p>
                      </>
                    ) : (
                      <p className="text-small text-text-2">{t('tools.info.gpsNoCoords')}</p>
                    )}
                  </div>
                  {hasCoords && (
                    <CopyButton
                      variant="ghost"
                      size="sm"
                      iconOnly
                      label={t('tools.info.copyCoords')}
                      onCopy={() => copyText(formatCoords(exif!.latitude!, exif!.longitude!))}
                    />
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-10"
                    onClick={() => setMeta('strip-gps')}
                  >
                    {t('tools.info.removeGps')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-10"
                    onClick={() => setMeta('strip-all')}
                  >
                    {t('tools.info.removeAll')}
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={`ok-${doc.id}-${meta}`}
                role="status"
                className="flex items-start gap-3 rounded-lg border border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,var(--surface))] p-3.5"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={spring.smooth}
              >
                <ShieldCheck size={20} className="mt-0.5 shrink-0 text-success-ink" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold text-text">
                    {meta === 'strip-gps' ? t('tools.info.gpsRemoved') : t('tools.info.allRemoved')}
                  </p>
                  <p className="text-small text-text-2">
                    {meta === 'strip-gps'
                      ? t('tools.info.gpsRemovedDesc')
                      : t('tools.info.allRemovedDesc')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  leading={<Undo2 size={14} aria-hidden />}
                  onClick={() => setMeta('keep')}
                >
                  {t('tools.info.keep')}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>
      )}

      <Section title={t('tools.info.metaMode')}>
        <SegmentedControl<MetaMode>
          full
          label={t('tools.info.metaMode')}
          value={meta}
          onChange={setMeta}
          options={[
            { value: 'keep', label: t('tools.info.keepAll') },
            { value: 'strip-gps', label: t('tools.info.stripGps') },
            { value: 'strip-all', label: t('tools.info.stripAll') },
          ]}
        />
        {lossless ? (
          <p className="flex items-start gap-1.5 text-caption text-text-3">
            <CheckCircle2 size={14} className="mt-px shrink-0 text-success-ink" aria-hidden />
            {t('tools.info.lossless')}
          </p>
        ) : (
          !editable && <p className="text-caption text-text-3">{t('tools.info.unsupportedMeta')}</p>
        )}
        {docCount > 1 && <ApplyAllButton onClick={applyAll} label={t('tools.info.applyAll')} />}
      </Section>

      <Section title={t('tools.info.fields')}>
        {exif === undefined ? (
          <div className="flex flex-col gap-2" aria-label={t('tools.info.reading')}>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : !rows.length ? (
          <p className="text-small text-text-3">{t('tools.info.noExif')}</p>
        ) : (
          <dl className="flex flex-col">
            {rows.map((r) => {
              const removed = meta === 'strip-all' || (meta === 'strip-gps' && r.gps)
              return (
                <div
                  key={r.label}
                  className="flex items-baseline gap-3 border-b border-border py-2 last:border-b-0"
                >
                  <dt className="w-20 shrink-0 text-small text-text-3">{r.label}</dt>
                  <dd
                    className={cn(
                      'min-w-0 flex-1 break-words text-small text-text',
                      removed && 'text-text-3 line-through',
                    )}
                  >
                    {r.value}
                    {removed && <span className="sr-only">（{t('tools.info.willRemove')}）</span>}
                  </dd>
                </div>
              )
            })}
          </dl>
        )}
        <dl className="mt-1 flex flex-col rounded-md bg-surface-2 px-3">
          {fileRows.map((r) => (
            <div
              key={r.label}
              className="flex items-baseline gap-3 border-b border-border py-2 last:border-b-0"
            >
              <dt className="w-20 shrink-0 text-small text-text-3">{r.label}</dt>
              <dd className="min-w-0 flex-1 text-small tabular-nums text-text">{r.value}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  )
}
