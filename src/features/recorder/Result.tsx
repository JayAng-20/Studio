/**
 * 結果頁：預覽播放（WebM 已補上長度，可拖曳）、標記時間軸、下載、傳送、
 * 存到錄影庫、裁切（ffmpeg -c copy）、轉 MP4（較慢）、還原、重新錄製。
 */
import { AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Download,
  Film,
  Flag,
  HardDrive,
  Plus,
  RotateCcw,
  Scissors,
  Undo2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  CopyButton,
  FileName,
  Panel,
  ProgressBar,
  RangeSlider,
  SendToMenu,
  Spinner,
  SuccessCheck,
  Tooltip,
  toast,
} from '@/components/ui'
import { duration as dur, easing, sec, spring } from '@/design/motion'
import { useT } from '@/i18n'
import { copyText, saveLargeBlob } from '@/lib/download'
import { outputName, replaceExt } from '@/lib/filename'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useMedia } from '@/lib/useMedia'
import { useRecents } from '@/stores/recents'
import { useSettings } from '@/stores/settings'
import { asFile } from '@/stores/fileBus'
import { isAbortError, useTask } from '@/stores/tasks'
import {
  adjacentMarker,
  extensionFor,
  formatClock,
  formatDuration,
  isFullRange,
  markerFraction,
  markersToText,
  normalizeRange,
  trimMarkers,
} from './core'
import {
  addResultMarker,
  isResultUnsaved,
  removeResultMarker,
  replaceResult,
  resetToSetup,
  revertResult,
  saveResultToLibrary,
  updateResult,
  useRecorder,
  type RecordingResult,
} from './engine'
import { HUD_LAYOUT_ID } from './Hud'
import { libraryAvailable } from './library'
import { BlobImage } from './media'

/** FileName 前段以 truncate 顯示，結尾的空白會被吃掉（日期與時間之間）；改成保留空白 */
export const KEEP_SPACES = '[&>span:first-child]:whitespace-pre'

const FFMPEG_SAFE_BYTES = 1024 * 1024 * 1024

export function ResultView({ library }: { library: ReactNode }) {
  const result = useRecorder((s) => s.result)
  if (!result) return null
  return <ResultInner key={result.id} result={result} library={library} />
}

type Busy = { kind: 'trim' | 'mp4'; phase: 'load' | 'run'; p: number | null } | null

function ResultInner({ result, library }: { result: RecordingResult; library: ReactNode }) {
  const t = useT()
  const run = useTask('recorder')
  const desktop = useMedia('(min-width: 1024px)')
  const pattern = useSettings((s) => s.filenamePattern)
  const libraryOn = useSettings((s) => s.recorderLibrary)
  const video = useRef<HTMLVideoElement>(null)
  const [mediaDur, setMediaDur] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [current, setCurrent] = useState(0)
  const duration = mediaDur ?? result.duration
  const [range, setRange] = useState<[number, number] | null>(null)
  const trim = range ?? [0, duration]
  const [busy, setBusy] = useState<Busy>(null)
  const abort = useRef<AbortController | null>(null)
  const [confirmRedo, setConfirmRedo] = useState(false)
  const playhead = useMotionValue(0)
  const playheadX = useTransform(playhead, (v) => `${v * 100}%`)

  // 物件 URL 在 effect 內建立並釋放（StrictMode 安全）
  useEffect(() => {
    const v = video.current
    if (!v) return
    const url = URL.createObjectURL(result.blob)
    v.src = url
    v.load()
    return () => {
      v.removeAttribute('src')
      v.load()
      URL.revokeObjectURL(url)
    }
  }, [result.blob])

  useEffect(() => {
    useRecents.getState().visit('recorder', result.name)
  }, [result.name])

  useEffect(() => () => abort.current?.abort(), [])

  const onMeta = () => {
    const v = video.current
    if (!v) return
    if (Number.isFinite(v.duration) && v.duration > 0) {
      setMediaDur(v.duration)
      setReady(true)
      return
    }
    // 長度未知（極少數情況）：跳到很後面讓瀏覽器算出長度再回到開頭
    const fix = () => {
      v.removeEventListener('timeupdate', fix)
      if (Number.isFinite(v.duration)) setMediaDur(v.duration)
      v.currentTime = 0
      setReady(true)
    }
    v.addEventListener('timeupdate', fix)
    v.currentTime = 1e101
  }
  const onTime = () => {
    const v = video.current
    if (!v) return
    setCurrent(v.currentTime)
    playhead.set(markerFraction(v.currentTime, duration))
  }
  const seek = (time: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(duration, time))
    setCurrent(v.currentTime)
    playhead.set(markerFraction(v.currentTime, duration))
  }

  const ext = extensionFor(result.blob.type || result.mime)
  const isMp4 = ext === 'mp4'

  const download = async () => {
    const ok = await saveLargeBlob(result.blob, result.name)
    if (ok) {
      updateResult({ downloaded: true })
      useRecents.getState().visit('recorder', result.name)
    }
  }

  const startEdit = async (kind: 'trim' | 'mp4') => {
    if (busy) return
    if (typeof WebAssembly === 'undefined') {
      toast.error(t('recorder.edit.noWasm'))
      return
    }
    if (result.blob.size > FFMPEG_SAFE_BYTES) {
      toast.warning(t('recorder.edit.tooLarge', { size: formatBytes(FFMPEG_SAFE_BYTES) }))
    }
    const [s, e] = normalizeRange(trim, duration)
    const ctrl = new AbortController()
    abort.current = ctrl
    setBusy({ kind, phase: 'load', p: null })
    const name =
      kind === 'trim'
        ? outputName(result.name, t('recorder.edit.actionTrim'), ext, pattern)
        : replaceExt(result.name, 'mp4')
    try {
      const out = await run(
        kind === 'trim' ? t('recorder.edit.taskTrim') : t('recorder.edit.taskConvert'),
        async ({ signal, progress }) => {
          const ff = await import('./ffmpeg')
          const report = (phase: 'load' | 'run', p: number | null) => {
            setBusy({ kind, phase, p })
            progress(p === null ? null : phase === 'load' ? p * 0.25 : 0.25 + p * 0.75)
          }
          const blob =
            kind === 'trim'
              ? await ff.trimVideo(result.blob, s, e, report, signal)
              : await ff.convertToMp4(result.blob, duration, report, signal)
          return [{ blob, name }]
        },
        { signal: ctrl.signal },
      )
      const blob = out[0].blob
      replaceResult({
        blob,
        name,
        mime: blob.type,
        duration: kind === 'trim' ? e - s : duration,
        markers: kind === 'trim' ? trimMarkers(result.markers, s, e) : result.markers,
        edited: kind,
      })
      toast.success(kind === 'trim' ? t('recorder.edit.trimDone') : t('recorder.edit.convertDone'))
    } catch (err) {
      if (!isAbortError(err)) toast.error(t('recorder.edit.failed'))
      setBusy(null)
    }
  }

  const unsaved = isResultUnsaved(result)
  const label = (i: number) => t('recorder.result.markerLabel', { n: i })
  const aspect = result.width && result.height ? result.width / result.height : 16 / 9
  const trimChanged = !isFullRange(trim, duration)
  const markers = result.markers

  const markersSection = (
      <section className="card p-4" aria-labelledby="res-markers">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 id="res-markers" className="flex flex-1 items-center gap-2 text-h3 font-semibold">
          <Flag size={16} className="text-accent-ink" aria-hidden />
          {t('recorder.result.markers')}
          {markers.length > 0 && <Badge tone="accent">{markers.length}</Badge>}
        </h3>
        {markers.length > 0 && (
          <>
            <Button
              icon
              size="sm"
              variant="ghost"
              aria-label={t('recorder.result.prevMarker')}
              onClick={() => {
                const m = adjacentMarker(markers, current, -1)
                if (m) seek(m.t)
              }}
            >
              <ChevronLeft size={16} aria-hidden />
            </Button>
            <Button
              icon
              size="sm"
              variant="ghost"
              aria-label={t('recorder.result.nextMarker')}
              onClick={() => {
                const m = adjacentMarker(markers, current, 1)
                if (m) seek(m.t)
              }}
            >
              <ChevronRight size={16} aria-hidden />
            </Button>
            <CopyButton
              size="sm"
              variant="ghost"
              label={t('recorder.result.markersCopy')}
              onCopy={() => copyText(markersToText(markers, label))}
            />
          </>
        )}
        <Button
          size="sm"
          variant="secondary"
          leading={<Plus size={14} aria-hidden />}
          onClick={() => {
            if (!addResultMarker(current)) toast.info(t('recorder.hud.markerTooClose'))
          }}
        >
          {t('recorder.result.markerAdd')}
        </Button>
      </div>
      {markers.length === 0 ? (
        <p className="text-small text-text-3">{t('recorder.result.markersEmpty')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          <AnimatePresence initial={false}>
            {markers.map((m, i) => (
              <motion.li
                key={m.id}
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={spring.smooth}
                className="flex h-9 items-center overflow-hidden rounded-full border border-border bg-surface-2 text-small"
              >
                <button
                  type="button"
                  onClick={() => seek(m.t)}
                  aria-label={t('recorder.result.markerJump', {
                    label: label(i + 1),
                    time: formatClock(m.t * 1000),
                  })}
                  className="flex h-full items-center gap-1.5 pl-3 pr-2 transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                >
                  <Flag size={13} className="text-accent-ink" aria-hidden />
                  <span className="font-medium">{label(i + 1)}</span>
                  <span className="tabular-nums text-text-3">{formatClock(m.t * 1000)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeResultMarker(m.id)}
                  aria-label={t('recorder.result.markerRemove', { label: label(i + 1) })}
                  className="grid h-full w-8 place-items-center text-text-3 transition-colors hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-danger-ink"
                >
                  <X size={14} aria-hidden />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  )

  const main = (
    <div className="flex flex-col gap-4">
      <motion.div
        layoutId={HUD_LAYOUT_ID}
        data-result-card
        className="card overflow-hidden"
        style={{ borderRadius: 16 }}
        transition={spring.smooth}
      >
        <motion.div
          className="bg-[#0b0d12]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: sec(dur.base), ease: easing.standard, delay: sec(dur.fast) }}
        >
          <div
            className="relative mx-auto max-w-full"
            style={{ aspectRatio: String(aspect), width: `min(100%, calc(62dvh * ${aspect}))` }}
          >
            <video
              ref={video}
              controls
              playsInline
              preload="metadata"
              aria-label={t('recorder.result.playerLabel')}
              className="absolute inset-0 size-full bg-black object-contain"
              onLoadedMetadata={onMeta}
              onTimeUpdate={onTime}
              onSeeked={onTime}
              onError={() => {
                setFailed(true)
                setReady(true)
              }}
            />
            <AnimatePresence>
              {!ready && (
                <motion.div
                  key="loading"
                  className="absolute inset-0 grid place-items-center"
                  exit={{ opacity: 0 }}
                  transition={{ duration: sec(dur.base) }}
                >
                  <BlobImage
                    blob={result.thumb}
                    className="absolute inset-0 size-full object-contain opacity-70"
                  />
                  <span className="relative flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-small text-white backdrop-blur-md">
                    <Spinner size={16} />
                    {t('recorder.result.preparing')}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* 標記時間軸：點標記跳轉 */}
        <div className="border-b border-border px-4 pt-3 pb-2">
          <div
            role="group"
            aria-label={t('recorder.result.timeline')}
            className="relative h-6"
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)]">
              <motion.div
                className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-accent"
                style={{ scaleX: playhead }}
              />
            </div>
            {/* 播放位置：全寬容器以 translateX(百分比) 移動，只動 transform */}
            <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ x: playheadX }}>
              <span className="absolute left-0 top-1/2 -ml-1.5 size-3 -translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow-e1" />
            </motion.div>
            {markers.map((m, i) => (
              <Tooltip key={m.id} content={`${label(i + 1)} · ${formatClock(m.t * 1000)}`}>
                <button
                  type="button"
                  aria-label={t('recorder.result.markerJump', {
                    label: label(i + 1),
                    time: formatClock(m.t * 1000),
                  })}
                  onClick={() => seek(m.t)}
                  className="absolute top-0 -ml-3 grid size-6 place-items-center text-accent-ink transition-transform duration-(--dur-fast) hover:scale-125"
                  style={{ left: `${markerFraction(m.t, duration) * 100}%` }}
                >
                  <Flag size={14} strokeWidth={2.4} fill="currentColor" aria-hidden />
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 flex-1 text-h3 font-semibold">
              <FileName name={result.name} className={KEEP_SPACES} />
            </h2>
            {result.edited && (
              <Badge
                tone="accent"
                icon={
                  result.edited === 'mp4' ? (
                    <Film size={12} aria-hidden />
                  ) : (
                    <Scissors size={12} aria-hidden />
                  )
                }
              >
                {t(`recorder.result.edited.${result.edited}`)}
              </Badge>
            )}
            <SavedBadge result={result} libraryOn={libraryOn} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-small sm:grid-cols-4">
            <Meta label={t('recorder.result.duration')} value={formatDuration(duration)} />
            <Meta label={t('recorder.result.size')} value={formatBytes(result.blob.size)} />
            <Meta
              label={t('recorder.result.resolution')}
              value={result.width ? `${result.width}×${result.height}` : '—'}
            />
            <Meta label={t('recorder.result.format')} value={ext.toUpperCase()} />
          </dl>
          {failed && <Callout tone="warning">{t('recorder.result.previewError')}</Callout>}
        </div>
      </motion.div>

      {desktop && markersSection}
      {library}
    </div>
  )

  const progressPct = busy?.p == null ? null : Math.round(busy.p * 100)
  const busyBox = (kind: 'trim' | 'mp4') => (
    <AnimatePresence initial={false}>
      {busy?.kind === kind && (
        <motion.div
          key="busy"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={spring.smooth}
          className="flex flex-col gap-2 rounded-md bg-surface-2 p-3"
        >
          <div className="flex items-start justify-between gap-2 text-small">
            <span aria-live="polite" className="pt-1 text-text-2">
              {busy.phase === 'load'
                ? t('recorder.edit.engineLoading')
                : t('recorder.edit.running', { percent: progressPct ?? 0 })}
            </span>
            <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
              {t('recorder.edit.cancel')}
            </Button>
          </div>
          <ProgressBar value={busy.p} />
        </motion.div>
      )}
    </AnimatePresence>
  )
  const panel = (
    <>
      <Panel>
        <div className="flex items-center gap-3">
          <SuccessCheck size={36} />
          <div className="min-w-0">
            <p className="text-h3 font-semibold">{t('recorder.result.title')}</p>
            <p className="text-small text-text-2 tabular-nums">
              {formatDuration(duration)} · {formatBytes(result.blob.size)}
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          leading={<Download size={18} aria-hidden />}
          onClick={download}
        >
          {t('recorder.result.download')}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <SendToMenu
            from="recorder"
            targets={['gif', 'player']}
            getFiles={() => [asFile(result.blob, result.name)]}
          />
          <Button
            variant="secondary"
            leading={<CircleDot size={16} aria-hidden />}
            onClick={() => (unsaved ? setConfirmRedo(true) : resetToSetup())}
          >
            {t('recorder.result.rerecord')}
          </Button>
        </div>
        {!result.libraryId && libraryAvailable() && (
          <Button
            variant="ghost"
            leading={<HardDrive size={16} aria-hidden />}
            loading={result.saving}
            onClick={() => void saveResultToLibrary()}
          >
            {t('recorder.result.saveToLibrary')}
          </Button>
        )}
      </Panel>

      <Panel title={t('recorder.edit.title')}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Scissors size={16} className="text-accent-ink" aria-hidden />
            <span className="text-body font-semibold">{t('recorder.edit.trim')}</span>
            <span className="ml-auto text-small tabular-nums text-text-2">
              {t('recorder.edit.trimLength', { len: formatClock((trim[1] - trim[0]) * 1000) })}
            </span>
          </div>
          <RangeSlider
            value={trim}
            max={Math.max(0.5, duration)}
            step={0.1}
            minGap={0.5}
            trackHeight={28}
            labels={[t('recorder.edit.trimStart'), t('recorder.edit.trimEnd')]}
            format={(v) => formatClock(v * 1000)}
            onChange={(v) => {
              const prev = trim
              setRange(v)
              seek(v[0] !== prev[0] ? v[0] : v[1])
            }}
          >
            {markers.map((m) => (
              <span
                key={m.id}
                aria-hidden
                className="absolute inset-y-1 w-0.5 rounded-full bg-accent/70"
                style={{ left: `${markerFraction(m.t, duration) * 100}%` }}
              />
            ))}
          </RangeSlider>
          <div className="flex justify-between text-caption tabular-nums text-text-3">
            <span>{formatClock(trim[0] * 1000)}</span>
            <span>{formatClock(trim[1] * 1000)}</span>
          </div>
          <p className="text-caption text-text-3">{t('recorder.edit.trimDesc')}</p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={!trimChanged || !!busy}
              loading={busy?.kind === 'trim'}
              leading={<Scissors size={16} aria-hidden />}
              onClick={() => void startEdit('trim')}
            >
              {t('recorder.edit.trimApply')}
            </Button>
            <Tooltip content={t('recorder.edit.trimReset')}>
              <Button
                icon
                variant="ghost"
                aria-label={t('recorder.edit.trimReset')}
                disabled={!trimChanged || !!busy}
                onClick={() => setRange(null)}
              >
                <RotateCcw size={16} aria-hidden />
              </Button>
            </Tooltip>
          </div>
          {busyBox('trim')}
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Film size={16} className="text-accent-ink" aria-hidden />
            <span className="text-body font-semibold">{t('recorder.edit.convert')}</span>
            <Badge tone="warning" className="ml-auto">
              {t('recorder.edit.convertSlow')}
            </Badge>
          </div>
          {isMp4 ? (
            <p className="flex items-center gap-1.5 text-small text-text-3">
              <Check size={14} className="text-success-ink" aria-hidden />
              {t('recorder.edit.alreadyMp4')}
            </p>
          ) : (
            <>
              <p className="text-small text-text-2">
                {t('recorder.edit.convertDesc')} {t('recorder.edit.convertSlowDesc')}
              </p>
              <Button
                variant="secondary"
                disabled={!!busy}
                loading={busy?.kind === 'mp4'}
                leading={<Film size={16} aria-hidden />}
                onClick={() => void startEdit('mp4')}
              >
                {t('recorder.edit.convertStart')}
              </Button>
              {busyBox('mp4')}
            </>
          )}
        </div>

        {result.original && (
          <Button
            variant="ghost"
            leading={<Undo2 size={16} aria-hidden />}
            disabled={!!busy}
            onClick={() => {
              revertResult()
              toast(t('recorder.result.reverted'))
            }}
          >
            {t('recorder.result.revert')}
          </Button>
        )}
      </Panel>
      <ConfirmDialog
        open={confirmRedo}
        onOpenChange={setConfirmRedo}
        title={t('recorder.result.rerecordConfirmTitle')}
        description={t('recorder.result.rerecordConfirmDesc')}
        confirmLabel={t('recorder.result.rerecordConfirm')}
        danger
        onConfirm={resetToSetup}
      />
    </>
  )

  if (desktop) return <Workspace main={main} panel={panel} />
  // 手機與平板：下載等動作緊接在影片下方，標記與錄影庫放後面
  return (
    <div className="flex flex-col gap-4">
      <Workspace main={main} panel={panel} />
      {markersSection}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-caption text-text-3">{label}</dt>
      <dd className="m-0 truncate font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function SavedBadge({ result, libraryOn }: { result: RecordingResult; libraryOn: boolean }) {
  const t = useT()
  if (result.saving)
    return (
      <Badge icon={<Spinner size={12} />} className={cn(!libraryOn && 'hidden')}>
        {t('recorder.result.saving')}
      </Badge>
    )
  if (result.libraryId)
    return (
      <motion.span
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={spring.bouncy}
      >
        <Badge tone="success" icon={<Check size={12} aria-hidden />}>
          {t('recorder.result.saved')}
        </Badge>
      </motion.span>
    )
  if (result.downloaded)
    return (
      <Badge tone="success" icon={<Download size={12} aria-hidden />}>
        {t('recorder.result.downloaded')}
      </Badge>
    )
  return null
}
