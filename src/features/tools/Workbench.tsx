/**
 * 工作台：左側縮圖列、中央畫布、右側分頁面板。
 * < 1024 px：縮圖改成橫列、畫布黏在頂欄下方（調整時仍看得到），面板在下方捲動。
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Button, DropTarget, ErrorState, usePasteFiles } from '@/components/ui'
import { matchesAccept } from '@/lib/files'
import { modKey } from '@/lib/capabilities'
import { useIsDesktop } from '@/lib/useMedia'
import { createCanvas, releaseCanvas } from '@/lib/image'
import { useModuleShortcuts, useUnsaved } from '@/stores/ui'
import { useT } from '@/i18n'
import { downloadDoc, detectEncoders } from './actions'
import { useEstimateRunner } from './estimate'
import { rotateState, outputSize } from './lib/geometry'
import { renderEdit } from './lib/render'
import { pixelsChanged, stateKey } from './lib/state'
import { useCurrent, useTools, type Doc, type States } from './store'
import { bitmapOf, useColorStore } from './ui'
import { ACCEPT } from './constants'
import { SidePanel, TabStrip } from './SidePanel'
import { StageView } from './stage/StageView'
import { ThumbRail } from './ThumbRail'
import { Toolbar } from './Toolbar'
import { BatchBar } from './BatchBar'

const CollageDialog = lazy(() => import('./CollageDialog'))

const isTyping = (el: Element | null) =>
  !!el &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    (el as HTMLElement).isContentEditable)

/** 編輯後重畫縮圖（停止變動 400 ms 後，依序處理） */
function useThumbUpdater() {
  const present = useTools((s) => s.history.present)
  const docs = useTools((s) => s.docs)
  const seen = useRef<{ states: States; ready: Set<string> }>({ states: {}, ready: new Set() })
  const pending = useRef(new Set<string>())
  useEffect(() => {
    const prev = seen.current
    for (const d of docs) {
      if (d.status !== 'ready') continue
      if (present[d.id] !== prev.states[d.id] || !prev.ready.has(d.id)) pending.current.add(d.id)
    }
    seen.current = {
      states: present,
      ready: new Set(docs.filter((d) => d.status === 'ready').map((d) => d.id)),
    }
    if (!pending.current.size) return
    const timer = setTimeout(async () => {
      const ids = [...pending.current]
      pending.current.clear()
      for (const id of ids) {
        const { docs: list, history } = useTools.getState()
        const doc = list.find((x) => x.id === id)
        const st = history.present[id]
        if (doc?.proxy && st) await renderThumb(doc, st)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [present, docs])
}

async function renderThumb(doc: Doc, state: States[string]) {
  const patch = useTools.getState().patchDoc
  if (!pixelsChanged(state, doc.srcW, doc.srcH)) {
    if (doc.editedThumbUrl) {
      URL.revokeObjectURL(doc.editedThumbUrl)
      patch(doc.id, { editedThumbUrl: undefined })
    }
    return
  }
  try {
    const out = outputSize(state, doc.srcW, doc.srcH)
    const wm =
      state.watermark.enabled && state.watermark.kind === 'image' && state.watermark.image
        ? await bitmapOf(state.watermark.image)
        : null
    const c = renderEdit({
      source: doc.proxy!,
      srcW: doc.srcW,
      srcH: doc.srcH,
      state,
      stage: 'final',
      scale: Math.min(1, 160 / Math.max(out.w, out.h)),
      make: createCanvas,
      watermarkImage: wm,
    }) as HTMLCanvasElement
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    releaseCanvas(c)
    if (!blob) return
    const cur = useTools.getState().docs.find((d) => d.id === doc.id)
    if (!cur) return
    if (cur.editedThumbUrl) URL.revokeObjectURL(cur.editedThumbUrl)
    patch(doc.id, { editedThumbUrl: URL.createObjectURL(blob) })
  } catch (e) {
    console.error(e)
  }
}

function useKeys() {
  const t = useT()
  const mod = modKey()
  useModuleShortcuts([
    { keys: [mod, 'Z'], label: t('tools.shortcuts.undo') },
    { keys: ['⇧', mod, 'Z'], label: t('tools.shortcuts.redo') },
    { keys: ['R'], label: t('tools.shortcuts.rotate') },
    { keys: ['[', ']'], label: t('tools.shortcuts.prevNext') },
    { keys: ['←', '→', '↑', '↓'], label: t('tools.shortcuts.nudge') },
    { keys: [mod, 'S'], label: t('tools.shortcuts.download') },
  ])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(document.activeElement)) return
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return
      const s = useTools.getState()
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        s.redo()
        return
      }
      const doc = s.docs.find((d) => d.id === s.selectedId)
      if (mod && key === 's') {
        e.preventDefault()
        if (doc?.status === 'ready') void downloadDoc(doc)
        return
      }
      if (mod || e.altKey) return
      if (key === 'r' && doc?.status === 'ready') {
        e.preventDefault()
        s.edit(doc.id, t('tools.crop.actions.rotate'), (st) =>
          rotateState(st, doc.srcW, doc.srcH, e.shiftKey ? -1 : 1),
        )
      } else if (e.key === '[') s.selectRelative(-1)
      else if (e.key === ']') s.selectRelative(1)
      else if (e.key === 'Escape') useColorStore.getState().setPicking(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [t])
}

/** 有尚未下載的編輯時，離開頁面要警告 */
function useDirty() {
  const docs = useTools((s) => s.docs)
  const present = useTools((s) => s.history.present)
  const past = useTools((s) => s.history.past.length)
  const dirty =
    past > 0 &&
    docs.some((d) => {
      const st = present[d.id]
      if (d.status !== 'ready' || !st) return false
      const changed =
        pixelsChanged(st, d.srcW, d.srcH) ||
        st.meta !== 'keep' ||
        st.output.mode !== 'none' ||
        st.output.format !== 'original'
      return changed && d.exportedKey !== stateKey(st)
    })
  useUnsaved('tools', dirty)
}

export function Workbench() {
  const t = useT()
  const addFiles = useTools((s) => s.addFiles)
  const removeDoc = useTools((s) => s.removeDoc)
  const { doc, state } = useCurrent()
  const [collage, setCollage] = useState(false)
  const desktop = useIsDesktop()
  // 工作畫面中也能直接貼上圖片（⌘／Ctrl＋V）
  usePasteFiles((files) => addFiles(files.filter((f) => matchesAccept(f, ACCEPT))))
  useEstimateRunner()
  useThumbUpdater()
  useKeys()
  useDirty()
  useEffect(() => {
    void detectEncoders()
  }, [])

  return (
    <DropTarget onFiles={addFiles} accept={ACCEPT}>
      <div className="grid gap-3 [--tl-h:max(540px,calc(100dvh-var(--topbar-h)-150px))] sm:gap-4 lg:grid-cols-[84px_minmax(0,1fr)_336px] lg:items-start xl:grid-cols-[88px_minmax(0,1fr)_356px]">
        <ThumbRail onCollage={() => setCollage(true)} />
        <section
          aria-label={doc?.name}
          className="card flex min-w-0 flex-col overflow-hidden max-lg:sticky! max-lg:top-(--topbar-h) max-lg:z-20 max-lg:shadow-e3! lg:h-(--tl-h)"
        >
          <Toolbar doc={doc} state={state} />
          <div className="relative h-[clamp(220px,36dvh,520px)] md:h-[clamp(320px,46dvh,620px)] lg:h-auto lg:min-h-0 lg:flex-1">
            {doc && state && doc.status !== 'error' ? (
              <StageView doc={doc} state={state} />
            ) : doc?.status === 'error' ? (
              <ErrorState
                className="h-full"
                title={t('tools.errors.decode')}
                description={t('tools.errors.decodeDesc', { name: doc.name })}
              />
            ) : null}
            <BatchBar />
            {doc?.status === 'error' && (
              <div className="absolute inset-x-0 bottom-6 flex justify-center">
                <Button variant="secondary" onClick={() => removeDoc(doc.id)}>
                  {t('common.remove')}
                </Button>
              </div>
            )}
          </div>
          {!desktop && <TabStrip className="border-t" />}
        </section>
        <SidePanel />
      </div>
      {collage && (
        <Suspense fallback={null}>
          <CollageDialog open={collage} onOpenChange={setCollage} />
        </Suspense>
      )}
    </DropTarget>
  )
}
