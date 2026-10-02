import './player.css'
import { AnimatePresence, motion } from 'motion/react'
import { Camera, Captions, Link2, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  DropTarget,
  DropZone,
  Panel,
  Sheet,
  TabPanel,
  Tabs,
  Tooltip,
  useFileIntake,
  usePasteFiles,
} from '@/components/ui'
import { ModulePage, StageContainer, TopBarActions, Workspace } from '@/components/layout/ModulePage'
import { EmptyIllustration } from '@/design/illustrations'
import { duration as dur, sec, spring } from '@/design/motion'
import { splitExt } from '@/lib/filename'
import { useIsDesktop, useIsMobile } from '@/lib/useMedia'
import { useIncomingFiles } from '@/stores/fileBus'
import { useT } from '@/i18n'
import { usePlayer, useCurrent, type PanelTab } from './store'
import { addFiles, clearSnapshot, loadSubtitle, stopIdleTimer, takeSnapshot } from './actions'
import { disposeFFmpeg } from './export'
import { usePlayerShortcuts } from './keyboard'
import { Stage } from './components/Stage'
import { MEDIA_ACCEPT, PlaylistList, PlaylistPanel, SavedPlaylists } from './components/PlaylistPanel'
import { SubtitlePanel } from './components/SubtitlePanel'
import { AbPanel } from './components/AbPanel'
import { AudioPanel, InfoPanel } from './components/InfoAudioPanels'
import { UrlDialog } from './components/UrlDialog'
import { useTasks, isActive } from '@/stores/tasks'

/** 空狀態：拖放、選擇、貼上；也可開啟串流網址或已儲存的清單 */
function EmptyView({ onOpenUrl }: { onOpenUrl: () => void }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-4">
      <DropZone
        onFiles={(f) => void addFiles(f)}
        accept={MEDIA_ACCEPT}
        title={t('player.empty.title')}
        formats={t('player.empty.formats')}
        illustration={<EmptyIllustration module="player" />}
      >
        <Button variant="ghost" className="mt-2" leading={<Link2 size={16} aria-hidden />} onClick={onOpenUrl}>
          {t('player.empty.openUrl')}
        </Button>
      </DropZone>
      <SavedSection />
    </div>
  )
}

function SavedSection() {
  const t = useT()
  return (
    <div className="card p-4 empty:hidden [&:not(:has(li))]:hidden">
      <SavedPlaylists compact hint={t('player.empty.savedHint')} />
    </div>
  )
}

/** 播放畫面下方：目前曲目標題（換曲時交叉淡化）與常用動作 */
function NowPlaying({ onLoadSub, onAdd }: { onLoadSub: () => void; onAdd: () => void }) {
  const t = useT()
  const item = useCurrent()
  const paused = usePlayer((s) => s.paused)
  if (!item) return null
  const title = item.meta?.title || splitExt(item.name).base
  const sub = item.meta?.artist || item.name
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="relative min-w-0 flex-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: sec(dur.fast) } }}
            transition={spring.smooth}
            className="min-w-0"
          >
            <p className="text-caption font-medium text-accent-ink">
              {paused ? t('player.status.paused') : t('player.status.nowPlaying')}
            </p>
            <h2 className="truncate text-h2 font-semibold" title={item.name}>
              {title}
            </h2>
            {sub !== title && <p className="truncate text-small text-text-3">{sub}</p>}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="secondary" size="sm" leading={<Captions size={15} aria-hidden />} onClick={onLoadSub}>
          {t('player.actions.loadSubtitle')}
        </Button>
        {item.kind === 'video' && !item.noVideo && (
          <Tooltip content={t('player.actions.screenshot')} shortcut="S">
            <Button variant="secondary" size="sm" icon aria-label={t('player.actions.screenshot')} onClick={() => void takeSnapshot()}>
              <Camera size={16} aria-hidden />
            </Button>
          </Tooltip>
        )}
        <Tooltip content={t('player.actions.addFiles')}>
          <Button variant="secondary" size="sm" icon aria-label={t('player.actions.addFiles')} onClick={onAdd}>
            <Plus size={16} aria-hidden />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

function SidePanel() {
  const t = useT()
  const tab = usePlayer((s) => s.tab)
  const set = usePlayer((s) => s.set)
  const content: Record<PanelTab, React.ReactNode> = {
    playlist: <PlaylistPanel />,
    subtitles: <SubtitlePanel />,
    ab: <AbPanel />,
    info: <InfoPanel />,
    audio: <AudioPanel />,
  }
  return (
    <Panel className="gap-3 p-3 sm:p-4">
      <Tabs<PanelTab>
        value={tab}
        onChange={(v) => set({ tab: v })}
        label={t('player.tabs.label')}
        fullWidth
        listClassName="-mx-1 gap-0"
        items={[
          { value: 'playlist', label: t('player.tabs.playlist') },
          { value: 'subtitles', label: t('player.tabs.subtitles') },
          { value: 'ab', label: t('player.tabs.ab') },
          { value: 'info', label: t('player.tabs.info') },
          { value: 'audio', label: t('player.tabs.audio') },
        ]}
      >
        <TabPanel value={tab} className="pt-3">
          {content[tab]}
        </TabPanel>
      </Tabs>
    </Panel>
  )
}

export default function PlayerPage() {
  const t = useT()
  const hasItems = usePlayer((s) => s.items.length > 0)
  const count = usePlayer((s) => s.items.length)
  const drawerOpen = usePlayer((s) => s.drawerOpen)
  const fullscreen = usePlayer((s) => s.fullscreen)
  const isMobile = useIsMobile()
  const isDesktop = useIsDesktop()
  const [urlOpen, setUrlOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const subInput = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useIncomingFiles('player', (p) => void addFiles(p.files, { range: p.meta?.range }))
  usePlayerShortcuts(hasItems)
  const intake = useFileIntake({ accept: MEDIA_ACCEPT, onFiles: (f) => void addFiles(f, { play: false }) })
  usePasteFiles(intake.intake, hasItems)

  useEffect(
    () => () => {
      stopIdleTimer()
      clearSnapshot()
      usePlayer.getState().set({ drawerOpen: false, infoOverlay: false, fullscreen: false, controlsVisible: true })
      // 沒有進行中的匯出才釋放 ffmpeg
      if (!useTasks.getState().tasks.some((x) => x.module === 'player' && isActive(x))) disposeFFmpeg()
    },
    [],
  )

  const openPlaylist = () => {
    const s = usePlayer.getState()
    if (s.fullscreen || isMobile) {
      s.set({ drawerOpen: true })
      return
    }
    s.set({ tab: 'playlist' })
    if (!isDesktop) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <ModulePage
      module="player"
      status={hasItems ? <Badge tone="accent">{t('player.status.count', { count })}</Badge> : undefined}
    >
      <TopBarActions>
        <Tooltip content={t('player.actions.openUrl')}>
          <Button variant="ghost" size="sm" icon aria-label={t('player.actions.openUrl')} onClick={() => setUrlOpen(true)}>
            <Link2 size={17} aria-hidden />
          </Button>
        </Tooltip>
      </TopBarActions>
      <StageContainer stage={hasItems ? 'loaded' : 'empty'}>
        {hasItems ? (
          <Workspace
            main={
              <DropTarget onFiles={(f) => void addFiles(f, { play: false })} accept={MEDIA_ACCEPT}>
                <Stage onChooseFile={() => fileInput.current?.click()} onOpenPlaylist={openPlaylist} />
                <NowPlaying onLoadSub={() => subInput.current?.click()} onAdd={() => fileInput.current?.click()} />
                <p className="mt-2 text-caption text-text-3 [@media(hover:hover)]:hidden">{t('player.touch.hint')}</p>
              </DropTarget>
            }
            panel={
              <div ref={panelRef} className="scroll-mt-20">
                <SidePanel />
              </div>
            }
          />
        ) : (
          <EmptyView onOpenUrl={() => setUrlOpen(true)} />
        )}
      </StageContainer>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept={MEDIA_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          intake.intake(Array.from(e.target.files || []))
          e.target.value = ''
        }}
      />
      <input
        ref={subInput}
        type="file"
        multiple
        accept=".srt,.vtt,text/vtt"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          for (const f of files) await loadSubtitle(f)
        }}
      />
      <ConfirmDialog
        open={!!intake.pendingLarge}
        onOpenChange={(o) => !o && intake.cancelLarge()}
        title={t('errors.fileTooLarge', { size: intake.largeSize })}
        description={t('errors.fileTooLargeDesc')}
        confirmLabel={t('errors.continueAnyway')}
        onConfirm={intake.confirmLarge}
      />
      <UrlDialog open={urlOpen} onOpenChange={setUrlOpen} />
      <Sheet
        open={drawerOpen && !fullscreen}
        onOpenChange={(o) => usePlayer.getState().set({ drawerOpen: o })}
        title={t('player.playlist.drawer')}
      >
        <div className="pb-4">
          <PlaylistList />
        </div>
      </Sheet>
    </ModulePage>
  )
}
