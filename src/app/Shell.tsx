import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { modules, moduleFromPath, type ModuleDef } from '@/config/modules'
import { Ambient } from '@/design/Ambient'
import { Skeleton } from '@/components/ui'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { duration, easing, offset, scale, sec, spring } from '@/design/motion'
import { useMedia } from '@/lib/useMedia'
import { useT } from '@/i18n'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { MobileTabBar } from './MobileTabBar'
import { TaskCenter } from './TaskCenter'
import { ShortcutsDialog } from './ShortcutsDialog'
import { useGlobalKeys } from './useGlobalKeys'
import { useUi } from '@/stores/ui'

// 不在首屏的部分延後載入：指令面板第一次開啟（或閒置時）才載入，設定頁進入時才載入
const loadPalette = () => import('./CommandPalette')
const CommandPalette = lazy(() => loadPalette().then((m) => ({ default: m.CommandPalette })))
const Settings = lazy(() => import('./pages/Settings'))
// 錄影中切到其他工具時的浮動控制列：只有錄影模組標記未儲存時才載入
const RecorderGlobalHud = lazy(() => import('@/features/recorder/GlobalHud'))
import Home from './pages/Home'
import NotFound from './pages/NotFound'

/** 主捲動容器 id（各頁捲動到頂端、sticky 參考用） */
export const SCROLLER_ID = 'main-scroll'

export function Shell() {
  const t = useT()
  const location = useLocation()
  const mod = moduleFromPath(location.pathname)
  const isDesktop = useMedia('(min-width: 1024px)')
  const scroller = useRef<HTMLDivElement>(null)
  useGlobalKeys()
  const paletteWanted = useUi((s) => s.commandOpen)
  const recorderActive = useUi((s) => s.unsavedReasons.has('recorder'))
  const [paletteReady, setPaletteReady] = useState(false)
  if (paletteWanted && !paletteReady) setPaletteReady(true)
  useEffect(() => {
    const id = setTimeout(() => loadPalette(), 3000)
    return () => clearTimeout(id)
  }, [])

  // 強調色換成模組色（tokens.css 以 @property 平滑過渡 400 ms）
  useEffect(() => {
    const root = document.documentElement
    if (mod) root.dataset.module = mod.id
    else delete root.dataset.module
  }, [mod])

  // 換頁：舊頁維持原本的視覺位置淡出，新頁從頂端開始
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const st = el.scrollTop
    if (st) {
      el.querySelectorAll<HTMLElement>('[data-page]').forEach((p) => {
        if (p.dataset.page !== location.pathname) p.style.translate = `0 ${-st}px`
      })
      el.scrollTop = 0
    }
    // 換頁後把焦點移到主內容，方便鍵盤與螢幕閱讀器
    const main = document.getElementById('main')
    if (
      main &&
      document.activeElement &&
      document.activeElement !== document.body &&
      !main.contains(document.activeElement)
    ) {
      main.focus({ preventScroll: true })
    }
  }, [location.pathname])

  return (
    <div className="flex h-dvh overflow-hidden">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-e3"
      >
        {t('app.skipToContent')}
      </a>
      <Ambient module={mod?.id} />
      <Sidebar mode={isDesktop ? 'desktop' : 'tablet'} />
      <div
        ref={scroller}
        id={SCROLLER_ID}
        className="relative flex min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
      >
        <TopBar />
        <main id="main" tabIndex={-1} className="relative flex-1 outline-none">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={location.pathname}
              data-page={location.pathname}
              className="w-full"
              initial={{ opacity: 0, y: offset.page }}
              animate={{
                opacity: 1,
                y: 0,
                transition: {
                  ...spring.smooth,
                  opacity: { duration: sec(duration.base), ease: easing.standard },
                },
              }}
              exit={{
                opacity: 0,
                scale: scale.pageExit,
                filter: 'blur(4px)',
                transition: { duration: sec(duration.fast), ease: easing.accelerate },
              }}
            >
              <Routes location={location}>
                <Route path="/" element={<Home />} />
                <Route
                  path="/settings"
                  element={
                    <Suspense fallback={<ModuleSkeleton />}>
                      <Settings />
                    </Suspense>
                  }
                />
                {modules.map((m) => (
                  <Route key={m.id} path={`${m.path}/*`} element={<ModuleRoute m={m} />} />
                ))}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      {recorderActive && (
        <Suspense fallback={null}>
          <RecorderGlobalHud />
        </Suspense>
      )}
      <MobileTabBar />
      <TaskCenter />
      {paletteReady && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
      <ShortcutsDialog />
    </div>
  )
}

function ModuleRoute({ m }: { m: ModuleDef }) {
  return (
    <ErrorBoundary resetKey={m.id}>
      <Suspense fallback={<ModuleSkeleton />}>
        <m.Page />
      </Suspense>
    </ErrorBoundary>
  )
}

/** 懶載入期間：模組色骨架，不出現白閃 */
function ModuleSkeleton() {
  const t = useT()
  return (
    <div
      className="mx-auto w-full max-w-[var(--content-max)] px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8"
      aria-busy="true"
      aria-label={t('a11y.loading')}
    >
      <div className="mb-8 flex items-center gap-4">
        <Skeleton className="size-14 rounded-[12.6px]" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72 max-w-[60vw]" />
        </div>
      </div>
      <Skeleton className="h-[360px] w-full rounded-2xl" />
    </div>
  )
}
