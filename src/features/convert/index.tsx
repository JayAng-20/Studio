/**
 * 圖片互轉（#/convert）：批次轉換 JPG、PNG、WebP、AVIF、ICO、BMP、GIF。
 * 工作區：空（DropZone）→ 已載入 → 處理中 → 完成，都在同一個 StageContainer 中以 layout 動畫切換。
 */
import './convert.css'
import { ArrowRightLeft, Archive, Download, Play, RotateCcw, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ModulePage, StageContainer, TopBarActions, Workspace } from '@/components/layout/ModulePage'
import { Button, DropZone, Kbd, Stepper, toast } from '@/components/ui'
import { EmptyIllustration } from '@/design/illustrations'
import { useIncomingFiles } from '@/stores/fileBus'
import { useTask } from '@/stores/tasks'
import { useModuleShortcuts, useUnsaved } from '@/stores/ui'
import { fileKind } from '@/lib/files'
import { modKey } from '@/lib/capabilities'
import { useIsMobile } from '@/lib/useMedia'
import { useT } from '@/i18n'
import { isFresh, useConvert } from './store'
import { optionsKey } from './options'
import { doneItems, downloadResults } from './actions'
import { useFormatSupport } from './useFormatSupport'
import { OUTPUT_LABEL } from './texts'
import { OptionsPanel } from './components/OptionsPanel'
import { ACCEPT, AddFolderButton, WorkStage } from './components/WorkStage'
import { CompareDialog } from './components/CompareDialog'

export default function ConvertPage() {
  const t = useT()
  const run = useTask('convert')
  const isMobile = useIsMobile()
  const items = useConvert((s) => s.items)
  const options = useConvert((s) => s.options)
  const running = useConvert((s) => s.running)
  const delivered = useConvert((s) => s.delivered)
  const addFiles = useConvert((s) => s.addFiles)
  const convert = useConvert((s) => s.convert)
  const cancel = useConvert((s) => s.cancel)
  const setOptions = useConvert((s) => s.setOptions)
  const { support, ready } = useFormatSupport()
  const [compareId, setCompareId] = useState<string | null>(null)

  const key = optionsKey(options)
  const done = doneItems(items)
  const pending = items.filter(
    (x) => !isFresh(x, key) && !(x.status === 'error' && (x.error === 'decode' || x.error === 'unsupported')),
  )
  const stage = !items.length ? 'empty' : 'work'
  const step = !items.length ? 0 : !running && pending.length === 0 && done.length > 0 ? 2 : 1

  // 目前選的格式在這個瀏覽器無法輸出時，改回 JPG
  useEffect(() => {
    if (ready && support[options.format] === 'none') setOptions({ format: 'jpeg' })
  }, [ready, support, options.format, setOptions])

  const add = useCallback(
    (files: File[]) => {
      const images = files.filter((f) => fileKind(f) === 'image' || /\.(heic|heif|avif|svg|jfif)$/i.test(f.name))
      const { added, skipped } = addFiles(images)
      if (skipped && !added) toast.info(t('convert.work.duplicates', { count: skipped }))
      else if (skipped) toast.info(t('convert.work.someDuplicates', { added, count: skipped }))
    },
    [addFiles, t],
  )

  useIncomingFiles('convert', (p) => {
    const images = p.files.filter((f) => fileKind(f) === 'image')
    if (images.length) add(images)
  })

  const start = useCallback(() => void convert(run), [convert, run])
  const retry = useCallback((id: string) => void convert(run, [id]), [convert, run])
  const retryFailed = useCallback(() => {
    const ids = useConvert
      .getState()
      .items.filter((x) => x.status === 'error' && x.thumbState !== 'error')
      .map((x) => x.id)
    if (ids.length) void convert(run, ids)
  }, [convert, run])
  const reconvertAll = useCallback(
    () =>
      void convert(
        run,
        useConvert.getState().items.filter((x) => x.thumbState !== 'error').map((x) => x.id),
      ),
    [convert, run],
  )
  const downloadAll = useCallback(() => void downloadResults(run, useConvert.getState().items), [run])

  useModuleShortcuts([
    { keys: [modKey(), 'Enter'], label: t('convert.shortcuts.convert') },
    { keys: [modKey(), 'Shift', 'E'], label: t('convert.shortcuts.download') },
  ])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      if (e.key === 'Enter') {
        e.preventDefault()
        if (!useConvert.getState().running) start()
      } else if (e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        downloadAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [start, downloadAll])

  // 有尚未下載的結果時，離開頁面要提醒
  useUnsaved('convert-results', !delivered && done.length > 0)

  const fmt = OUTPUT_LABEL[options.format]
  const steps = [t('convert.steps.add'), t('convert.steps.convert'), t('convert.steps.download')]
  const footer = running ? (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" size="lg" className="w-full" leading={<Square size={15} aria-hidden />} onClick={cancel}>
        {t('convert.actions.cancel')}
      </Button>
      <p className="text-center text-caption text-text-3" aria-live="polite">
        {t('convert.actions.runningHint')}
      </p>
    </div>
  ) : pending.length > 0 ? (
    <div className="flex flex-col gap-2">
      <Button variant="primary" size="lg" className="w-full" leading={<Play size={16} aria-hidden />} onClick={start}>
        {pending.length === items.length
          ? t('convert.actions.start', { format: fmt })
          : t('convert.actions.startSome', { count: pending.length, format: fmt })}
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-caption text-text-3 max-sm:hidden">
        <Kbd>{modKey()}</Kbd>
        <Kbd>Enter</Kbd>
      </p>
    </div>
  ) : done.length > 0 ? (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        leading={done.length > 1 ? <Archive size={16} aria-hidden /> : <Download size={16} aria-hidden />}
        onClick={downloadAll}
      >
        {done.length > 1 ? t('convert.summary.downloadZip') : t('common.download')}
      </Button>
      <Button variant="ghost" className="w-full" leading={<RotateCcw size={15} aria-hidden />} onClick={reconvertAll}>
        {t('convert.actions.reconvertAll')}
      </Button>
    </div>
  ) : (
    <div className="flex flex-col gap-2">
      <Button variant="primary" size="lg" className="w-full" disabled leading={<Play size={16} aria-hidden />}>
        {t('convert.actions.start', { format: fmt })}
      </Button>
      <p className="text-center text-caption text-text-3">{t('convert.actions.addFirst')}</p>
    </div>
  )

  return (
    <ModulePage
      module="convert"
      status={<Stepper steps={steps} current={step} className="max-xl:hidden" />}
    >
      {/* 較窄的畫面：步驟指示放在頁首下方，避免擠壓標題 */}
      <Stepper steps={steps} current={step} className="-mt-2 mb-5 xl:hidden" />
      <Workspace
        main={
          <StageContainer stage={stage}>
            {stage === 'empty' ? (
              <DropZone
                onFiles={add}
                accept={ACCEPT}
                folder
                title={t('convert.drop.title')}
                formats={t('convert.drop.formats')}
                illustration={<EmptyIllustration module="convert" />}
                browseLabel={t('convert.drop.browse')}
              >
                <div className="mt-5 flex flex-col items-center gap-3">
                  <AddFolderButton onFiles={add} />
                  <p className="flex flex-wrap items-center justify-center gap-1.5 text-caption text-text-3">
                    <ArrowRightLeft size={13} aria-hidden />
                    {t('convert.drop.outputs')}
                  </p>
                </div>
              </DropZone>
            ) : (
              <WorkStage onFiles={add} onCompare={setCompareId} onRetry={retry} onRetryFailed={retryFailed} />
            )}
          </StageContainer>
        }
        panel={<OptionsPanel support={support} footer={footer} />}
      />
      {items.length > 0 && (
        <TopBarActions>
          {running ? null : pending.length > 0 ? (
            <Button
              variant="primary"
              size="sm"
              icon={isMobile}
              aria-label={isMobile ? t('convert.actions.start', { format: fmt }) : undefined}
              leading={isMobile ? undefined : <Play size={14} aria-hidden />}
              onClick={start}
            >
              {isMobile ? <Play size={15} aria-hidden /> : t('convert.actions.short', { format: fmt })}
            </Button>
          ) : done.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              icon={isMobile}
              aria-label={isMobile ? t('common.downloadAll') : undefined}
              leading={isMobile ? undefined : <Download size={14} aria-hidden />}
              onClick={downloadAll}
            >
              {isMobile ? <Download size={15} aria-hidden /> : t('common.downloadAll')}
            </Button>
          ) : null}
        </TopBarActions>
      )}
      <CompareDialog id={compareId} onClose={() => setCompareId(null)} />
    </ModulePage>
  )
}
