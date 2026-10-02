/** 錄影庫：縮圖格、占用容量、單筆刪除、全部清除、開啟到結果頁 */
import { AnimatePresence, motion } from 'motion/react'
import { Camera, Download, HardDrive, Scissors, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  FileName,
  ProgressBar,
  Skeleton,
  Tooltip,
  toast,
} from '@/components/ui'
import { EmptyIllustration } from '@/design/illustrations'
import { spring, staggerDelay } from '@/design/motion'
import { useLang, useT } from '@/i18n'
import { saveLargeBlob } from '@/lib/download'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { formatDuration } from './core'
import { openFromLibrary, updateResult, useRecorder } from './engine'
import { libraryAvailable, loadRecordingBlob, useLibrary, type LibraryMeta } from './library'
import { BlobImage } from './media'

export function LibrarySection() {
  const t = useT()
  const lang = useLang()
  const items = useLibrary((s) => s.items)
  const loaded = useLibrary((s) => s.loaded)
  const usage = useLibrary((s) => s.usage)
  const libraryOn = useSettings((s) => s.recorderLibrary)
  const stage = useRecorder((s) => s.stage)
  const currentId = useRecorder((s) => s.result?.libraryId ?? null)
  const [toDelete, setToDelete] = useState<LibraryMeta | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const canOpen = stage === 'setup' || stage === 'result'

  useEffect(() => {
    void useLibrary.getState().refresh()
  }, [])

  const dateFmt = new Intl.DateTimeFormat(lang, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const open = async (m: LibraryMeta) => {
    if (!canOpen || opening) return
    setOpening(m.id)
    try {
      const blob = await loadRecordingBlob(m.id)
      if (!blob) throw new Error('missing blob')
      openFromLibrary(m, blob)
      document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      console.error(e)
      toast.error(t('recorder.library.loadFailed'))
    } finally {
      setOpening(null)
    }
  }

  const download = async (m: LibraryMeta) => {
    try {
      const blob = await loadRecordingBlob(m.id)
      if (!blob) throw new Error('missing blob')
      await saveLargeBlob(blob, m.name)
    } catch (e) {
      console.error(e)
      toast.error(t('recorder.library.loadFailed'))
    }
  }

  const remove = async (m: LibraryMeta) => {
    try {
      await useLibrary.getState().remove(m.id)
      if (useRecorder.getState().result?.libraryId === m.id) updateResult({ libraryId: null })
      toast.success(t('recorder.library.deleted'))
    } catch (e) {
      console.error(e)
      toast.error(t('errors.generic'))
    }
  }

  const clearAll = async () => {
    await useLibrary.getState().clearAll()
    if (useRecorder.getState().result?.libraryId) updateResult({ libraryId: null })
    toast.success(t('recorder.library.cleared'))
  }

  const ratio = usage && usage.quota > 0 ? usage.used / usage.quota : null

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="rec-library">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="rec-library" className="flex items-center gap-2 text-h3 font-semibold">
            <HardDrive size={17} className="text-accent-ink" aria-hidden />
            {t('recorder.library.title')}
            {items.length > 0 && (
              <Badge>{t('recorder.library.count', { count: items.length })}</Badge>
            )}
          </h2>
          <p className="mt-0.5 text-small text-text-2">
            {!libraryAvailable()
              ? t('recorder.library.unavailable')
              : libraryOn
                ? t('recorder.library.desc')
                : t('recorder.library.disabled')}
          </p>
        </div>
        {items.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="text-danger-ink!"
            leading={<Trash2 size={15} aria-hidden />}
            onClick={() => setConfirmClear(true)}
          >
            {t('recorder.library.clearAll')}
          </Button>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {usage ? (
          <>
            <ProgressBar value={ratio ?? 0} size="sm" label={t('recorder.library.usageLabel')} />
            <p className="text-caption tabular-nums text-text-3">
              {t('recorder.library.usage', {
                used: formatBytes(usage.used),
                quota: formatBytes(usage.quota),
              })}
            </p>
          </>
        ) : (
          loaded && <p className="text-caption text-text-3">{t('recorder.library.usageUnknown')}</p>
        )}
      </div>

      {!loaded ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[16/12] rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          className="py-6"
          illustration={<EmptyIllustration module="recorder" size={132} />}
          title={t('recorder.library.empty')}
          description={t('recorder.library.emptyDesc')}
        />
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {items.map((m, i) => {
              const current = m.id === currentId
              return (
                <motion.li
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ ...spring.smooth, delay: staggerDelay(i) }}
                  className={cn(
                    'group relative flex flex-col overflow-hidden rounded-lg border bg-surface shadow-e1 transition-[box-shadow,border-color] duration-(--dur-base)',
                    current
                      ? 'border-[color-mix(in_srgb,var(--accent)_55%,transparent)] ring-2 ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]'
                      : 'border-border hover:border-border-strong hover:shadow-e2',
                  )}
                >
                  <button
                    type="button"
                    disabled={!canOpen}
                    onClick={() => void open(m)}
                    aria-label={t('recorder.library.open', { name: m.name })}
                    className="relative block aspect-video w-full overflow-hidden bg-[#0b0d12] text-left disabled:cursor-not-allowed"
                  >
                    <BlobImage
                      blob={m.thumb}
                      className="size-full object-cover transition-transform duration-(--dur-slow) ease-standard group-hover:scale-[1.03]"
                    />
                    <span className="absolute bottom-2 right-2 rounded-xs bg-black/65 px-1.5 py-0.5 text-caption font-medium tabular-nums text-white backdrop-blur-sm">
                      {formatDuration(m.duration)}
                    </span>
                    <span className="absolute left-2 top-2 flex gap-1">
                      {current && (
                        <Badge tone="accent" className="bg-surface/90! backdrop-blur-sm">
                          {t('recorder.library.current')}
                        </Badge>
                      )}
                      {m.edited && (
                        <Badge
                          className="bg-black/60! text-white!"
                          icon={<Scissors size={11} aria-hidden />}
                        >
                          {t('recorder.library.edited')}
                        </Badge>
                      )}
                      {m.mode === 'camera' && (
                        <Badge
                          className="bg-black/60! text-white!"
                          icon={<Camera size={11} aria-hidden />}
                        >
                          {t('recorder.library.camera')}
                        </Badge>
                      )}
                    </span>
                    {opening === m.id && (
                      <span className="shimmer absolute inset-0 bg-black/20" aria-hidden />
                    )}
                  </button>
                  <div className="flex flex-col gap-0.5 px-3 pt-2.5 pb-1.5">
                    <p className="text-small font-medium">
                      <FileName name={m.name} />
                    </p>
                    <div className="flex items-center gap-1">
                      <p className="min-w-0 flex-1 truncate text-caption tabular-nums text-text-3">
                        {dateFmt.format(m.createdAt)} · {formatBytes(m.size)}
                      </p>
                      <Tooltip content={t('recorder.library.download')}>
                        <Button
                          icon
                          size="sm"
                          variant="ghost"
                          className="max-sm:size-11"
                          aria-label={`${t('recorder.library.download')} ${m.name}`}
                          onClick={() => void download(m)}
                        >
                          <Download size={16} aria-hidden />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t('recorder.library.delete')}>
                        <Button
                          icon
                          size="sm"
                          variant="ghost"
                          className="max-sm:size-11 hover:text-danger-ink!"
                          aria-label={`${t('recorder.library.delete')} ${m.name}`}
                          onClick={() => setToDelete(m)}
                        >
                          <Trash2 size={16} aria-hidden />
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('recorder.library.deleteConfirmTitle')}
        description={t('recorder.library.deleteConfirmDesc', { name: toDelete?.name ?? '' })}
        confirmLabel={t('recorder.library.delete')}
        danger
        onConfirm={() => {
          if (toDelete) void remove(toDelete)
        }}
      />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('recorder.library.clearConfirmTitle')}
        description={t('recorder.library.clearConfirmDesc', { count: items.length })}
        confirmLabel={t('recorder.library.clearAll')}
        danger
        onConfirm={() => void clearAll()}
      />
    </section>
  )
}
