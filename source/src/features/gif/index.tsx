import { Clapperboard, Images, RotateCcw, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ModulePage,
  StageContainer,
  TopBarActions,
  Workspace,
} from '@/components/layout/ModulePage'
import {
  AddFilesButton,
  Badge,
  Button,
  DropTarget,
  DropZone,
  FileName,
  Skeleton,
  Spinner,
  Stepper,
  toast,
} from '@/components/ui'
import { EmptyIllustration } from '@/design/illustrations'
import { useIncomingFiles, type BusSource } from '@/stores/fileBus'
import { useRecents } from '@/stores/recents'
import { useSettings } from '@/stores/settings'
import { isAbortError, useTask } from '@/stores/tasks'
import { useModuleShortcuts, useUnsaved } from '@/stores/ui'
import { fileKind, uid } from '@/lib/files'
import { formatBytes, formatTime } from '@/lib/format'
import { outputName } from '@/lib/filename'
import { imageSize } from '@/lib/image'
import { modKey } from '@/lib/capabilities'
import { useT } from '@/i18n'
import { useGT } from './useGT'
import { useGifStore, type ImageItem } from './store'
import {
  useEstimate,
  useFilmstrip,
  useGeometry,
  useImageBitmaps,
  usePlan,
  planDurationMs,
} from './hooks'
import { probeVideo, SourceError } from './source'
import { defaultRange } from './timeline'
import { EXT, MIME } from './settings'
import { WorkerPool, encodeSequence, poolSize, type EncodeConfig } from './encoder'
import { createFeed } from './feed'
import { drawHero, useEncodeState } from './progress'
import { PreviewStage, type PreviewApi, type PreviewMode } from './components/PreviewStage'
import { RangeTimeline } from './components/RangeTimeline'
import { SettingsPanel } from './components/SettingsPanel'
import { EstimateCard } from './components/EstimateCard'
import { EffectsPanel, type EffectsTab } from './components/EffectsPanel'
import { FrameEditor } from './components/FrameEditor'
import { ImageStrip } from './components/ImageStrip'
import { EncodingView } from './components/EncodingView'
import { ResultView } from './components/ResultView'
import './gif.css'

const ACCEPT = 'video/*,image/*,.mkv,.mov,.m4v,.webm,.heic,.heif'
const IMAGE_ACCEPT = 'image/*,.heic,.heif'

/** 依容器寬度決定膠卷縮圖數（分段，避免縮放時一直重新產生） */
function useThumbCount() {
  const [el, ref] = useState<HTMLDivElement | null>(null)
  const [count, setCount] = useState(12)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      setCount(w < 420 ? 6 : w < 640 ? 8 : w < 860 ? 12 : 16)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return { ref, count }
}

export default function GifPage() {
  const t = useGT()
  const tc = useT()
  const source = useGifStore((s) => s.source)
  const from = useGifStore((s) => s.from)
  const stage = useGifStore((s) => s.stage)
  const result = useGifStore((s) => s.result)
  const range = useGifStore((s) => s.range)
  const filenamePattern = useSettings((s) => s.filenamePattern)
  const [loading, setLoading] = useState(false)
  const { plan, custom } = usePlan()
  const geom = useGeometry()
  const durationMs = planDurationMs(plan)
  const estimate = useEstimate(plan, geom, stage === 'edit' && !!source)
  const bitmaps = useImageBitmaps(source)
  const previewRef = useRef<PreviewApi>(null)
  const [effectsTab, setEffectsTab] = useState<EffectsTab>('text')
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const runTask = useTask('gif')
  const video = source?.kind === 'video' ? source : null
  const { ref: stripRef, count: thumbCount } = useThumbCount()
  const thumbs = useFilmstrip(video, thumbCount)

  useUnsaved('gif-encoding', stage === 'encoding')

  // ---------- 載入 ----------
  const loadVideo = useCallback(
    async (
      file: File,
      incoming: { start: number; end: number } | null,
      origin: BusSource | null,
    ) => {
      setLoading(true)
      const url = URL.createObjectURL(file)
      try {
        const info = await probeVideo(url, incoming?.end)
        useGifStore.getState().setSource(
          {
            kind: 'video',
            file,
            url,
            width: info.width,
            height: info.height,
            duration: info.duration,
          },
          origin,
        )
        useGifStore.getState().setRange(defaultRange(info.duration, incoming))
        useRecents.getState().visit('gif', file.name)
      } catch (e) {
        URL.revokeObjectURL(url)
        console.error(e)
        if (e instanceof SourceError && e.code === 'seek') {
          toast.error(t('errors.seekFailed'), { description: t('errors.seekFailedDesc') })
        } else {
          toast.error(t('errors.videoDecode'), { description: t('errors.videoDecodeDesc') })
        }
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  const readImages = useCallback(
    async (files: File[]): Promise<ImageItem[]> => {
      const out: ImageItem[] = []
      let failed = 0
      for (const file of files) {
        try {
          const s = await imageSize(file)
          out.push({
            id: uid('img'),
            file,
            url: URL.createObjectURL(file),
            width: s.width,
            height: s.height,
          })
        } catch (e) {
          console.error(e)
          failed++
        }
      }
      if (failed)
        toast.error(t('errors.imagesFailed', { count: failed }), {
          description: t('errors.imagesFailedDesc'),
        })
      return out
    },
    [t],
  )

  const loadFiles = useCallback(
    async (
      files: File[],
      opts: {
        range?: { start: number; end: number } | null
        from?: BusSource | null
        append?: boolean
      } = {},
    ) => {
      const videos = files.filter((f) => fileKind(f) === 'video')
      const images = files.filter((f) => fileKind(f) === 'image')
      if (videos.length) {
        if (videos.length > 1)
          toast.info(t('errors.oneVideo'), {
            description: t('errors.oneVideoDesc', { name: videos[0].name }),
          })
        else if (images.length)
          toast.info(t('errors.mixed'), { description: t('errors.mixedDesc') })
        await loadVideo(videos[0], opts.range ?? null, opts.from ?? null)
        return
      }
      if (!images.length) return
      const current = useGifStore.getState().source
      const items = await readImages(images)
      if (!items.length) return
      if (opts.append && current?.kind === 'images') {
        useGifStore.getState().setImages([...current.items, ...items])
      } else {
        useGifStore.getState().setSource({ kind: 'images', items }, opts.from ?? null)
      }
      useRecents.getState().visit('gif', items[0].file.name)
    },
    [loadVideo, readImages, t],
  )

  useIncomingFiles('gif', (p) => {
    if (useGifStore.getState().stage === 'encoding') return
    void loadFiles(p.files, { range: p.meta?.range ?? null, from: p.from })
  })

  // ---------- 編碼 ----------
  const start = useCallback(async () => {
    const s = useGifStore.getState()
    const src = s.source
    if (!src || s.stage !== 'edit' || !plan.length) return
    previewRef.current?.pause()
    setPicking(false)
    const fmt = s.settings.format
    const cfg: EncodeConfig = {
      format: fmt,
      width: geom.outW,
      height: geom.outH,
      colors: s.settings.colors,
      dither: s.settings.dither,
      palette: s.settings.palette,
      optimize: s.settings.optimize,
      tolerance: s.settings.tolerance,
      transparent: s.chroma.enabled,
      loop: s.settings.loop,
      webpQuality: s.settings.webpQuality,
      webpLossless: s.settings.webpLossless,
    }
    const snapshot = { source: src, plan, geom, texts: s.texts, chroma: s.chroma }
    const baseName = src.kind === 'video' ? src.file.name : src.items[0].file.name
    const name = outputName(baseName, t(`action.${fmt}`), EXT[fmt], filenamePattern)
    const estimated = estimate.status === 'ready' && estimate.bytes ? estimate.bytes : null
    const controller = new AbortController()
    useEncodeState.setState({
      progress: { phase: 'extract', value: 0, frame: 0, total: plan.length },
      controller,
      startedAt: performance.now(),
    })
    s.setStage('encoding')
    let written = plan.length
    try {
      const results = await runTask(
        t('encoding.taskName', { format: t(`panel.formats.${fmt}`), name: baseName }),
        async ({ signal, progress }) => {
          const pool = new WorkerPool(poolSize() + 1)
          let dispose: (() => void) | null = null
          try {
            const feed = await createFeed(
              { ...snapshot, onRendered: (_i, c) => drawHero(c) },
              signal,
            )
            dispose = feed.dispose
            let last = 0
            const out = await encodeSequence(pool, cfg, feed, signal, (p) => {
              progress(p.value)
              const now = performance.now()
              if (now - last > 50 || p.phase === 'finalize') {
                last = now
                useEncodeState.setState({ progress: p })
              }
            })
            written = out.frames
            const blob = new Blob([out.bytes as Uint8Array<ArrayBuffer>], { type: MIME[fmt] })
            return [{ blob, name }]
          } finally {
            dispose?.()
            pool.terminate()
          }
        },
        { signal: controller.signal },
      )
      const blob = results[0].blob
      const elapsedMs = performance.now() - useEncodeState.getState().startedAt
      useGifStore.getState().setResult({
        blob,
        url: URL.createObjectURL(blob),
        name,
        format: fmt,
        width: geom.outW,
        height: geom.outH,
        frames: written,
        planned: plan.length,
        durationMs: planDurationMs(plan),
        estimated,
        elapsedMs,
      })
      useGifStore.getState().setStage('done')
      toast.success(t('doneToast', { name, size: formatBytes(blob.size) }))
    } catch (e) {
      useGifStore.getState().setStage('edit')
      if (isAbortError(e)) toast(t('canceled'))
      else {
        console.error('[gif] 編碼', e)
        if (e instanceof SourceError && e.code === 'seek')
          toast.error(t('errors.seekFailed'), { description: t('errors.seekFailedDesc') })
        else toast.error(t('errors.encodeFailed'), { description: t('errors.encodeFailedDesc') })
      }
    } finally {
      useEncodeState.setState({ controller: null })
    }
  }, [plan, geom, estimate.bytes, estimate.status, filenamePattern, runTask, t])

  const cancel = () => useEncodeState.getState().controller?.abort()

  // ---------- 快捷鍵 ----------
  useModuleShortcuts([
    { keys: ['Space'], label: t('shortcuts.play') },
    { keys: ['I'], label: t('shortcuts.setIn') },
    { keys: ['O'], label: t('shortcuts.setOut') },
    { keys: [modKey(), 'Enter'], label: t('shortcuts.encode') },
  ])
  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useGifStore.getState()
      if (!s.source || s.stage !== 'edit') return
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void startRef.current()
        return
      }
      const el = document.activeElement as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      if (e.key === ' ' && !(el && (el.tagName === 'BUTTON' || el.getAttribute('role')))) {
        e.preventDefault()
        previewRef.current?.toggle()
      } else if ((e.key === 'i' || e.key === 'I') && s.source.kind === 'video') {
        const cur = previewRef.current?.current() ?? 0
        if (cur < s.range[1] - 0.1) s.setRange([Math.round(cur * 10) / 10, s.range[1]])
      } else if ((e.key === 'o' || e.key === 'O') && s.source.kind === 'video') {
        const cur = previewRef.current?.current() ?? 0
        if (cur > s.range[0] + 0.1) s.setRange([s.range[0], Math.round(cur * 10) / 10])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 影格參數改變導致自訂影格被重設時提示
  const planResetAt = useGifStore((s) => s.planResetAt)
  const seenReset = useRef(planResetAt)
  useEffect(() => {
    if (planResetAt === seenReset.current) return
    seenReset.current = planResetAt
    toast.info(t('frames.resetNotice'))
  }, [planResetAt, t])

  // ---------- 畫面 ----------
  const stepIndex = !source ? 0 : stage === 'done' ? 2 : 1
  const previewMode: PreviewMode = picking ? 'pick' : effectsTab === 'crop' ? 'crop' : 'normal'
  const stageKey = loading ? 'loading' : !source ? 'empty' : stage

  const header = source && (
    <div className="flex flex-wrap items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
        {source.kind === 'video' ? (
          <Clapperboard size={20} aria-hidden />
        ) : (
          <Images size={20} aria-hidden />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        {source.kind === 'video' ? (
          <FileName name={source.file.name} className="text-body font-semibold text-text" />
        ) : (
          <span className="text-body font-semibold text-text">
            {t('meta.images', { count: source.items.length })}
          </span>
        )}
        <span className="text-caption tabular-nums text-text-3">
          {source.kind === 'video'
            ? `${t('meta.size', { w: source.width, h: source.height })} · ${t('meta.duration', {
                value: formatTime(source.duration, { tenths: true }),
              })} · ${formatBytes(source.file.size)}`
            : t('meta.size', { w: geom.baseW, h: geom.baseH })}
        </span>
      </div>
      {from && from !== 'gif' && (
        <Badge tone="accent">
          {from === 'recorder'
            ? t('from.recorder')
            : from === 'player'
              ? t('from.player')
              : from === 'home'
                ? t('from.home')
                : t('from.other')}
        </Badge>
      )}
      <div className="flex gap-2">
        {source.kind === 'images' && (
          <AddFilesButton
            accept={IMAGE_ACCEPT}
            size="sm"
            label={t('actions.addImages')}
            onFiles={(f) => loadFiles(f, { append: true })}
          />
        )}
        <AddFilesButton
          accept={ACCEPT}
          size="sm"
          variant="ghost"
          label={t('actions.replace')}
          onFiles={(f) => loadFiles(f)}
        />
        <Button
          variant="ghost"
          icon
          size="sm"
          aria-label={tc('common.clear')}
          onClick={() => useGifStore.getState().clear()}
        >
          <X size={16} aria-hidden />
        </Button>
      </div>
    </div>
  )

  return (
    <ModulePage
      module="gif"
      wide
      status={
        <Stepper
          className="max-md:hidden"
          steps={[t('steps.source'), t('steps.adjust'), t('steps.done')]}
          current={stepIndex}
        />
      }
    >
      {/* 窄螢幕：步驟指示放到頁首下方，避免擠壓標題 */}
      <Stepper
        className="-mt-2 mb-4 md:hidden"
        steps={[t('steps.source'), t('steps.adjust'), t('steps.done')]}
        current={stepIndex}
      />
      {source && stage === 'edit' && (
        <TopBarActions>
          <Button
            variant="primary"
            size="sm"
            leading={<Sparkles size={14} aria-hidden />}
            onClick={() => void start()}
          >
            {t('actions.startShort')}
          </Button>
        </TopBarActions>
      )}
      <StageContainer stage={stageKey}>
        {stageKey === 'empty' && (
          <div className="flex flex-col gap-4">
            <DropZone
              accept={ACCEPT}
              multiple
              onFiles={(f) => loadFiles(f)}
              title={t('drop.title')}
              formats={t('drop.formats')}
              illustration={<EmptyIllustration module="gif" />}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Hint icon={<Clapperboard size={18} aria-hidden />} text={t('drop.videoHint')} />
              <Hint icon={<Images size={18} aria-hidden />} text={t('drop.imagesHint')} />
            </div>
          </div>
        )}

        {stageKey === 'loading' && (
          <div className="card flex flex-col items-center gap-4 p-10" aria-busy="true">
            <Spinner size={36} />
            <p className="text-body text-text-2" aria-live="polite">
              {t('loading')}
            </p>
            <Skeleton className="h-14 w-full max-w-xl" />
          </div>
        )}

        {stageKey === 'edit' && source && (
          <DropTarget
            accept={ACCEPT}
            onFiles={(f) => loadFiles(f, { append: source.kind === 'images' })}
          >
            <Workspace
              main={
                <div className="flex flex-col gap-5">
                  <section className="card flex flex-col gap-5 p-4 sm:p-5">
                    {header}
                    <PreviewStage
                      ref={previewRef}
                      geom={geom}
                      plan={plan}
                      bitmaps={bitmaps}
                      mode={previewMode}
                      selectedText={selectedText}
                      onSelectText={(id) => {
                        setSelectedText(id)
                        if (id) setEffectsTab('text')
                      }}
                      onPick={(color) => {
                        useGifStore.getState().setChroma({ color, enabled: true })
                        setPicking(false)
                      }}
                    />
                    {video && (
                      <div ref={stripRef}>
                        <h3 className="sr-only">{t('range.label')}</h3>
                        <RangeTimeline
                          duration={video.duration}
                          value={range}
                          onChange={(r) => useGifStore.getState().setRange(r)}
                          onScrub={(time) => previewRef.current?.seek(time)}
                          thumbs={thumbs}
                          thumbCount={thumbCount}
                        />
                      </div>
                    )}
                  </section>
                  {source.kind === 'images' && (
                    <section className="card p-4 sm:p-5">
                      <ImageStrip items={source.items} />
                    </section>
                  )}
                  <EffectsPanel
                    geom={geom}
                    frameCount={plan.length}
                    durationMs={durationMs}
                    customPlan={custom}
                    tab={effectsTab}
                    onTab={(tab) => {
                      setEffectsTab(tab)
                      if (tab !== 'chroma') setPicking(false)
                    }}
                    selectedText={selectedText}
                    onSelectText={setSelectedText}
                    picking={picking}
                    onPicking={setPicking}
                    onOpenEditor={() => setEditorOpen(true)}
                  />
                </div>
              }
              panel={
                <>
                  <EstimateCard
                    frames={plan.length}
                    durationMs={durationMs}
                    geom={geom}
                    estimate={estimate}
                    onStart={() => void start()}
                  />
                  <SettingsPanel geom={geom} />
                </>
              }
            />
            <FrameEditor open={editorOpen} onOpenChange={setEditorOpen} plan={plan} />
          </DropTarget>
        )}

        {stageKey === 'encoding' && source && (
          <EncodingView
            geom={geom}
            plan={plan}
            thumbs={thumbs}
            thumbCount={thumbCount}
            onCancel={cancel}
          />
        )}

        {stageKey === 'done' && result && (
          <ResultView
            result={result}
            onAdjust={() => useGifStore.getState().setStage('edit')}
            onStartOver={() => useGifStore.getState().clear()}
          />
        )}
      </StageContainer>
      {stageKey === 'done' && !result && (
        <div className="card p-6">
          <Button
            leading={<RotateCcw size={16} aria-hidden />}
            onClick={() => useGifStore.getState().setStage('edit')}
          >
            {t('actions.adjust')}
          </Button>
        </div>
      )}
    </ModulePage>
  )
}

function Hint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] px-4 py-3 text-small text-text-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
        {icon}
      </span>
      {text}
    </div>
  )
}
