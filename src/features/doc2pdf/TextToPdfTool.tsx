/**
 * 文字檔（Markdown／TXT／RTF）轉 PDF：嵌進「PDF 工具」模組的一個工具（只做工作區內容，不含 ModulePage）。
 * 工作區狀態：空（拖放區）→ 已載入（檔案＋結構預覽＋設定）→ 處理中（進度）→ 完成（預覽＋下載），
 * 同一個容器以 layout 動畫切換。長時間作業走 useTask('pdf')，可在任務中心取消與下載。
 */
import { ArrowLeft, ClipboardPaste } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StageContainer, Workspace } from '@/components/layout/ModulePage'
import { Button, ConfirmDialog, DropTarget, DropZone, ErrorState, toast } from '@/components/ui'
import { EmptyIllustration } from '@/design/illustrations'
import { modKey } from '@/lib/capabilities'
import { createDeduper, sanitizeFilename, splitExt } from '@/lib/filename'
import { filesFromClipboard, matchesAccept } from '@/lib/files'
import { formatBytes } from '@/lib/format'
import { useRecents } from '@/stores/recents'
import { isAbortError, useTask } from '@/stores/tasks'
import { useT } from '@/i18n'
import { docTitle } from './engine/options'
import type { DocModel } from './engine/model'
import { resolveImages } from './engine/resolve'
import { SettingsPanel } from './components/SettingsPanel'
import { SourceList } from './components/SourceList'
import { StructurePreview } from './components/StructurePreview'
import { WorkingCard } from './components/Working'
import { Result } from './components/Result'
import { PasteDialog } from './components/PasteDialog'
import { convertInWorker, EngineError, retainEngine } from './lib/client'
import { FONT_TOTAL_BYTES, FontLoadError, fontsCached, loadFonts } from './lib/fonts'
import { convertImageToPng } from './lib/images'
import {
  ACCEPT,
  BIG_TEXT_BYTES,
  isImageFile,
  kindOf,
  looksLikeMarkdown,
  useDoc2Pdf,
  type Output,
} from './store'
import './doc2pdf.css'

type Phase = 'idle' | 'working' | 'fontError'

interface Progress {
  value: number
  title: string
  detail: string
}

export function TextToPdfTool({ initialFiles }: { initialFiles?: File[] }) {
  const t = useT()
  const run = useTask('pdf')
  const sources = useDoc2Pdf((s) => s.sources)
  const outputs = useDoc2Pdf((s) => s.outputs)
  const merge = useDoc2Pdf((s) => s.merge)
  const addFiles = useDoc2Pdf((s) => s.addFiles)
  const addText = useDoc2Pdf((s) => s.addText)
  const setOutputs = useDoc2Pdf((s) => s.setOutputs)
  const clear = useDoc2Pdf((s) => s.clear)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<Progress>({ value: 0, title: '', detail: '' })
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pendingBig, setPendingBig] = useState<File[] | null>(null)
  const ctrl = useRef<AbortController | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const release = retainEngine()
    return () => {
      alive.current = false
      release()
    }
  }, [])

  /* ---------- 加入檔案 ---------- */

  const accept = useCallback(
    (files: File[]) => {
      const ok = files.filter((f) => kindOf(f.name, f.type) || isImageFile(f))
      const bad = files.filter((f) => !ok.includes(f))
      if (bad.length)
        toast.error(t('errors.unsupportedFile'), {
          description: t('errors.unsupportedFileDesc', { name: bad[0].name }),
        })
      if (!ok.length) return
      const texts = ok.filter((f) => kindOf(f.name, f.type))
      if (texts[0]) useRecents.getState().visit('pdf', texts[0].name)
      if (texts.some((f) => f.size > BIG_TEXT_BYTES)) {
        setPendingBig(ok)
        return
      }
      void addFiles(ok)
    },
    [addFiles, t],
  )

  // 從 PDF 工具或首頁帶進來的檔案
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !initialFiles?.length) return
    seeded.current = true
    accept(initialFiles)
  }, [initialFiles, accept])

  // 整頁貼上：檔案照常加入；純文字（含 Markdown）變成一份文件
  useEffect(() => {
    if (phase === 'working' || pasteOpen) return
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return
      const files = filesFromClipboard(e).filter((f) => matchesAccept(f, ACCEPT))
      if (files.length) {
        e.preventDefault()
        accept(files)
        return
      }
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text.trim()) {
        e.preventDefault()
        addText(text, looksLikeMarkdown(text) ? 'md' : 'txt')
        toast.success(t('doc2pdf.pastedToast'))
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [phase, pasteOpen, accept, addText, t])

  /* ---------- 轉檔 ---------- */

  const ready = sources.filter((s) => s.status === 'ready' && s.doc)
  const parsing = sources.some((s) => s.status === 'parsing')
  const autoTitle = useMemo(
    () =>
      docTitle(
        ready.map((s) => s.doc!),
        '',
      ),
    [ready],
  )
  const canStart = ready.length > 0 && !parsing && phase !== 'working'

  const start = useCallback(async () => {
    const st = useDoc2Pdf.getState()
    const list = st.sources.filter((s) => s.status === 'ready' && s.doc)
    if (!list.length) return
    const groups = st.merge && list.length > 1 ? [list] : list.map((s) => [s])
    const options = { ...st.options, exclude: st.exclude, date: Date.now() }
    const images = st.attachments.map((a) => ({
      name: a.name,
      path: a.path,
      bytes: a.bytes,
      mime: a.mime,
    }))
    const c = new AbortController()
    ctrl.current = c
    setPhase('working')
    setProgress({ value: 0, title: t('doc2pdf.working.title'), detail: '' })
    const report = (p: Progress) => alive.current && setProgress(p)
    const taskName =
      list.length === 1
        ? t('doc2pdf.working.task', { name: list[0].name })
        : t('doc2pdf.working.taskMany', { count: list.length })
    const results: Output[] = []
    try {
      await run(
        taskName,
        async ({ signal, progress }) => {
          const set = (p: Progress) => {
            progress(p.value)
            report(p)
          }
          // 1. 中文字型（第一次才下載）
          const cached = await fontsCached()
          const fontShare = cached ? 0.03 : 0.35
          const fonts = await loadFonts((loaded, total) => {
            set({
              value: (loaded / total) * fontShare,
              title: t('doc2pdf.working.fonts'),
              detail: cached
                ? ''
                : t('doc2pdf.working.fontsDetail', {
                    loaded: formatBytes(loaded),
                    total: formatBytes(total || FONT_TOTAL_BYTES),
                  }),
            })
          }, signal)
          // 2. 每份輸出：解析圖片 → Worker 排版與產生 PDF
          const dedupe = createDeduper()
          for (let gi = 0; gi < groups.length; gi++) {
            const group = groups[gi]
            const docs: DocModel[] = []
            for (const s of group)
              docs.push(await resolveImages(structuredClone(s.doc!), images, convertImageToPng))
            const fileLabel =
              groups.length > 1
                ? t('doc2pdf.working.fileOf', { i: gi + 1, n: groups.length, name: group[0].name })
                : ''
            const r = await convertInWorker(
              docs,
              options,
              fonts,
              (stage, v) => {
                const within = stage === 'layout' ? v * 0.25 : 0.25 + v * 0.75
                set({
                  value: fontShare + ((1 - fontShare) * (gi + within)) / groups.length,
                  title:
                    stage === 'layout' ? t('doc2pdf.working.layout') : t('doc2pdf.working.render'),
                  detail: fileLabel,
                })
              },
              signal,
            )
            const base = group.length > 1 ? r.title : splitExt(group[0].name).base
            results.push({
              name: dedupe(`${sanitizeFilename(base, 'document')}.pdf`),
              blob: new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
              pages: r.pages,
              missing: r.missing,
              title: r.title,
            })
          }
          return results.map((o) => ({ blob: o.blob, name: o.name }))
        },
        { signal: c.signal },
      )
      if (!alive.current) return
      setOutputs(results)
      setPhase('idle')
    } catch (e) {
      if (!alive.current) return
      if (isAbortError(e) || c.signal.aborted) {
        setPhase('idle')
        toast(t('doc2pdf.errors.canceled'))
        return
      }
      console.error(e)
      if (
        e instanceof FontLoadError ||
        (e instanceof TypeError && /fetch|network/i.test(e.message))
      ) {
        setPhase('fontError')
        return
      }
      setPhase('idle')
      if (e instanceof RangeError || (e instanceof EngineError && e.code === 'memory'))
        toast.error(t('doc2pdf.errors.memory'), { description: t('doc2pdf.errors.memoryDesc') })
      else toast.error(t('doc2pdf.errors.failed'), { description: t('doc2pdf.errors.failedDesc') })
    } finally {
      if (ctrl.current === c) ctrl.current = null
    }
  }, [run, setOutputs, t])

  const cancel = () => ctrl.current?.abort()

  // ⌘／Ctrl + Enter 開始轉換
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canStart && !outputs && !pasteOpen) {
        e.preventDefault()
        void start()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canStart, outputs, pasteOpen, start])

  /* ---------- 畫面 ---------- */

  const stage =
    phase === 'working'
      ? 'working'
      : phase === 'fontError'
        ? 'error'
        : outputs
          ? 'done'
          : sources.length
            ? 'ready'
            : 'empty'

  const startLabel =
    ready.length > 1
      ? merge
        ? t('doc2pdf.panel.startMerged', { n: ready.length })
        : t('doc2pdf.panel.startMany', { n: ready.length })
      : t('doc2pdf.panel.start')
  const disabledReason = parsing
    ? t('doc2pdf.panel.notReady')
    : !ready.length
      ? t('doc2pdf.panel.nothing')
      : undefined

  return (
    <div className="doc2pdf">
      <StageContainer stage={stage}>
        {stage === 'empty' && (
          <div>
            <DropZone
              onFiles={accept}
              accept={ACCEPT}
              paste={false}
              folder
              formats={t('doc2pdf.formats')}
              title={t('doc2pdf.dropTitle')}
              illustration={<EmptyIllustration module="pdf" />}
              className="border-0 shadow-none"
            >
              <p className="mt-1 text-caption text-text-3">
                {t('doc2pdf.pasteHint', { shortcut: `${modKey()}+V` })}
              </p>
              <Button
                variant="secondary"
                className="mt-4"
                leading={<ClipboardPaste size={16} aria-hidden />}
                onClick={() => setPasteOpen(true)}
              >
                {t('doc2pdf.pasteText')}
              </Button>
              <p className="mt-5 max-w-md text-balance text-small text-text-2">
                {t('doc2pdf.emptyHint')}
              </p>
            </DropZone>
          </div>
        )}

        {stage === 'ready' && (
          <DropTarget onFiles={accept} accept={ACCEPT}>
            <Workspace
              main={
                <div className="flex flex-col gap-5">
                  <SourceList onFiles={accept} onPaste={() => setPasteOpen(true)} />
                  <StructurePreview />
                </div>
              }
              panel={
                <SettingsPanel
                  onStart={() => void start()}
                  autoTitle={autoTitle}
                  canStart={canStart}
                  disabledReason={disabledReason}
                  startLabel={startLabel}
                />
              }
            />
          </DropTarget>
        )}

        {stage === 'working' && (
          <WorkingCard
            title={progress.title}
            detail={progress.detail}
            progress={progress.value}
            onCancel={cancel}
          />
        )}

        {stage === 'error' && (
          <div className="card">
            <ErrorState
              title={t('doc2pdf.errors.fontsTitle')}
              description={t('doc2pdf.errors.fontsDesc')}
              onRetry={() => void start()}
              retryLabel={t('doc2pdf.errors.retry')}
            />
            <div className="-mt-4 flex justify-center pb-8">
              <Button
                variant="ghost"
                leading={<ArrowLeft size={16} aria-hidden />}
                onClick={() => setPhase('idle')}
              >
                {t('doc2pdf.errors.back')}
              </Button>
            </div>
          </div>
        )}

        {stage === 'done' && outputs && (
          <Result
            outputs={outputs}
            onEdit={() => setOutputs(null)}
            onReset={() => {
              clear()
              setOutputs(null)
            }}
          />
        )}
      </StageContainer>

      <PasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        onAdd={(text, kind) => addText(text, kind)}
      />
      <ConfirmDialog
        open={!!pendingBig}
        onOpenChange={(o) => !o && setPendingBig(null)}
        title={t('doc2pdf.big.title', {
          size: formatBytes(
            Math.max(
              0,
              ...(pendingBig ?? []).filter((f) => kindOf(f.name, f.type)).map((f) => f.size),
            ),
          ),
        })}
        description={t('doc2pdf.big.desc')}
        confirmLabel={t('doc2pdf.big.confirm')}
        onConfirm={() => {
          if (pendingBig) void addFiles(pendingBig)
          setPendingBig(null)
        }}
      />
    </div>
  )
}

export default TextToPdfTool
