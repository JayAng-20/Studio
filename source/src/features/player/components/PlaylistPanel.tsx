import { motion } from 'motion/react'
import {
  Film,
  FolderOpen,
  Globe,
  Music,
  Repeat,
  Repeat1,
  Save,
  Shuffle,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AddFilesButton,
  Button,
  ConfirmDialog,
  Dialog,
  FileName,
  SortableList,
  Switch,
  Tooltip,
  toast,
} from '@/components/ui'
import { formatBytes, formatTime } from '@/lib/format'
import { uid } from '@/lib/files'
import { cn } from '@/lib/cn'
import { spring } from '@/design/motion'
import { useT, useLang } from '@/i18n'
import { usePlayer, type PlayItem } from '../store'
import {
  addFiles,
  clearAll,
  cycleRepeat,
  playItem,
  removeItem,
  reorder,
  toggleShuffle,
} from '../actions'
import { orderByNames } from '../logic/playlist'
import { loadSaved, upsertSaved, writeSaved, type SavedPlaylist } from '../logic/savedPlaylists'

export const MEDIA_ACCEPT =
  'video/*,audio/*,.srt,.vtt,.mkv,.mov,.m4v,.avi,.wmv,.flv,.ts,.3gp,.mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus,.weba,.webm,.mp4,.ac3'

/** 播放中的小等化器圖示 */
function EqBars({ paused }: { paused: boolean }) {
  return (
    <span className={cn('flex h-3.5 items-end gap-[2px]', paused && 'eq-paused')} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="eq-bar motion-decor block h-full w-[3px] rounded-full bg-current"
        />
      ))}
    </span>
  )
}

function Row({ item, handle, dark }: { item: PlayItem; handle: React.ReactNode; dark?: boolean }) {
  const t = useT()
  const current = usePlayer((s) => s.currentId === item.id)
  const paused = usePlayer((s) => s.paused)
  const Icon = item.source === 'url' ? Globe : item.kind === 'audio' ? Music : Film
  const meta = [
    item.duration ? formatTime(item.duration) : null,
    item.size !== undefined ? formatBytes(item.size) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div
      className={cn(
        'relative flex items-center gap-1 rounded-md py-1 pl-0.5 pr-1 transition-colors duration-(--dur-fast)',
        dark ? 'hover:bg-[var(--stage-hover)]' : 'hover:bg-surface-2',
      )}
    >
      {current && (
        <motion.span
          layoutId={dark ? 'pl-current-dark' : 'pl-current'}
          className={cn(
            'absolute inset-0 -z-0 rounded-md',
            dark
              ? 'bg-[color-mix(in_srgb,var(--accent)_28%,transparent)]'
              : 'bg-[color-mix(in_srgb,var(--accent)_11%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]',
          )}
          transition={spring.snappy}
        />
      )}
      <span className="relative">{handle}</span>
      <button
        type="button"
        onClick={() => playItem(item.id)}
        aria-current={current ? 'true' : undefined}
        aria-label={[
          item.meta?.title || item.name,
          current ? t('player.playlist.current') : null,
          meta,
        ]
          .filter(Boolean)
          .join('，')}
        className="relative flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          className={cn(
            'relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-md',
            current
              ? 'text-white'
              : dark
                ? 'bg-[var(--stage-hover)] text-[var(--stage-fg-2)]'
                : 'bg-surface-2 text-text-3',
          )}
          style={
            current ? { background: 'linear-gradient(135deg, var(--m-1), var(--m-2))' } : undefined
          }
        >
          {item.meta?.coverUrl ? (
            <img
              src={item.meta.coverUrl}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          ) : null}
          {current ? (
            <span
              className={cn(
                'relative grid size-full place-items-center',
                item.meta?.coverUrl && 'bg-black/40',
              )}
            >
              <EqBars paused={paused} />
            </span>
          ) : (
            !item.meta?.coverUrl && <Icon size={17} aria-hidden />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              'flex min-w-0 items-center gap-1.5 text-body',
              current ? 'font-semibold' : 'font-medium',
              dark ? 'text-[var(--stage-fg)]' : 'text-text',
            )}
          >
            <FileName name={item.meta?.title || item.name} className="min-w-0" />
          </span>
          <span
            className={cn(
              'flex min-w-0 items-center gap-1.5 text-caption',
              dark ? 'text-[var(--stage-fg-2)]' : 'text-text-3',
            )}
          >
            {current && <span className="sr-only">{t('player.playlist.current')}</span>}
            {meta && <span className="truncate tabular-nums">{meta}</span>}
            {item.source === 'url' && <span>{t('player.playlist.stream')}</span>}
            {(item.error || item.suspect) && (
              <span
                className={cn('inline-flex items-center gap-0.5', dark ? '' : 'text-warning-ink')}
                style={
                  dark ? { color: 'color-mix(in srgb, var(--warning) 70%, white)' } : undefined
                }
              >
                <TriangleAlert size={12} aria-hidden />
                {t('player.playlist.unsupported')}
              </span>
            )}
          </span>
        </span>
      </button>
      <Tooltip content={t('player.playlist.remove')}>
        <button
          type="button"
          onClick={() => removeItem(item.id)}
          aria-label={`${t('player.playlist.remove')}：${item.name}`}
          className={cn(
            'relative grid size-9 shrink-0 place-items-center rounded-sm transition-colors pointer-coarse:size-11',
            dark
              ? 'text-[var(--stage-fg-2)] hover:bg-[var(--stage-hover)] hover:text-[var(--stage-fg)]'
              : 'text-text-3 hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-danger-ink',
          )}
        >
          <X size={16} aria-hidden />
        </button>
      </Tooltip>
    </div>
  )
}

/** 播放清單本體（側欄、手機抽屜、全螢幕抽屜共用） */
export function PlaylistList({ dark }: { dark?: boolean }) {
  const t = useT()
  const items = usePlayer((s) => s.items)
  if (!items.length)
    return (
      <p className="px-2 py-6 text-center text-small text-text-3">{t('player.playlist.empty')}</p>
    )
  return (
    <SortableList
      items={items}
      getId={(i) => i.id}
      onReorder={(next) => reorder(next.map((i) => i.id))}
      label={t('player.playlist.title')}
      className="gap-0.5!"
      render={(item, _i, handle) => <Row item={item} handle={handle} dark={dark} />}
    />
  )
}

/** 清單模式控制：隨機、循環、自動下一個 */
function QueueControls() {
  const t = useT()
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const autoNext = usePlayer((s) => s.autoNext)
  const repeatLabel =
    repeat === 'one'
      ? t('player.playlist.repeatOne')
      : repeat === 'all'
        ? t('player.playlist.repeatAll')
        : t('player.playlist.repeatOff')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        variant={shuffle ? 'primary' : 'secondary'}
        aria-pressed={shuffle}
        leading={<Shuffle size={15} aria-hidden />}
        onClick={toggleShuffle}
      >
        {t('player.playlist.shuffle')}
      </Button>
      <Button
        size="sm"
        variant={repeat !== 'off' ? 'primary' : 'secondary'}
        aria-label={`${t('player.playlist.repeat')}：${repeatLabel}`}
        leading={
          repeat === 'one' ? <Repeat1 size={15} aria-hidden /> : <Repeat size={15} aria-hidden />
        }
        onClick={cycleRepeat}
      >
        {repeatLabel}
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-small text-text-2" aria-hidden>
          {t('player.playlist.autoNext')}
        </span>
        <Switch
          checked={autoNext}
          onChange={(v) => usePlayer.getState().set({ autoNext: v })}
          ariaLabel={t('player.playlist.autoNext')}
        />
      </div>
    </div>
  )
}

/** 已儲存的播放清單：重新開啟時要使用者再選一次檔案 */
export function SavedPlaylists({ compact, hint }: { compact?: boolean; hint?: string }) {
  const t = useT()
  const lang = useLang()
  const [list, setList] = useState<SavedPlaylist[]>(() => loadSaved())
  const [pending, setPending] = useState<SavedPlaylist | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const refresh = useCallback(() => setList(loadSaved()), [])

  // 其他地方儲存後重新讀取
  useSavedSync(refresh)

  if (!list.length) return null
  const fmt = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' })

  const open = (p: SavedPlaylist) => {
    setPending(p)
    requestAnimationFrame(() => input.current?.click())
  }

  const onFiles = async (files: File[]) => {
    const p = pending
    setPending(null)
    if (!p || !files.length) return
    const { ordered, missing, extra } = orderByNames(files, p.names)
    clearAll()
    await addFiles([...ordered, ...extra])
    if (ordered.length)
      toast.success(t('player.playlist.restored', { name: p.name, count: ordered.length }))
    if (missing.length) {
      toast.warning(
        t('player.playlist.missing', {
          count: missing.length,
          names: missing.slice(0, 3).join('、') + (missing.length > 3 ? '…' : ''),
        }),
      )
    }
  }

  return (
    <section className={cn('flex flex-col gap-1.5', !compact && 'border-t border-border pt-3')}>
      <h4 className="text-small font-semibold text-text-2">{t('player.playlist.savedList')}</h4>
      {hint && <p className="-mt-1 text-caption text-text-3">{hint}</p>}
      <ul className="flex flex-col gap-1">
        {list.map((p) => (
          <li key={p.id} className="flex items-center gap-1 rounded-md pr-1 hover:bg-surface-2">
            <button
              type="button"
              onClick={() => open(p)}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-left"
              aria-label={`${t('player.playlist.open')}：${p.name}`}
            >
              <FolderOpen size={16} className="shrink-0 text-accent-ink" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body font-medium">{p.name}</span>
                <span className="text-caption tabular-nums text-text-3">
                  {t('player.playlist.itemCount', { count: p.names.length })} ·{' '}
                  {t('player.playlist.savedAt', { date: fmt.format(p.savedAt) })}
                </span>
              </span>
            </button>
            <Tooltip content={t('player.playlist.deleteSaved', { name: p.name })}>
              <button
                type="button"
                aria-label={t('player.playlist.deleteSaved', { name: p.name })}
                className="grid size-9 shrink-0 place-items-center rounded-sm text-text-3 hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-danger-ink"
                onClick={() => {
                  writeSaved(loadSaved().filter((x) => x.id !== p.id))
                  refresh()
                }}
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>
      <input
        ref={input}
        type="file"
        multiple
        accept={MEDIA_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void onFiles(Array.from(e.target.files || []))
          e.target.value = ''
        }}
      />
    </section>
  )
}

const savedListeners = new Set<() => void>()
function useSavedSync(cb: () => void) {
  useEffect(() => {
    savedListeners.add(cb)
    return () => {
      savedListeners.delete(cb)
    }
  }, [cb])
}
function notifySaved() {
  savedListeners.forEach((f) => f())
}

function SaveDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const save = () => {
    const items = usePlayer.getState().items.filter((i) => i.source === 'file')
    const finalName = name.trim() || t('player.playlist.saveDefault')
    writeSaved(
      upsertSaved(loadSaved(), {
        id: uid('plist'),
        name: finalName,
        names: items.map((i) => i.name),
        savedAt: Date.now(),
      }),
    )
    notifySaved()
    toast.success(t('player.playlist.saved', { name: finalName }))
    onOpenChange(false)
    setName('')
  }
  const hasStream = usePlayer((s) => s.items.some((i) => i.source === 'url'))
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('player.playlist.saveTitle')}
      description={t('player.playlist.saveDesc')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={save} leading={<Save size={16} aria-hidden />}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <label htmlFor="pl-save-name" className="label">
          {t('player.playlist.saveName')}
        </label>
        <input
          id="pl-save-name"
          className="field"
          value={name}
          autoFocus
          placeholder={t('player.playlist.saveDefault')}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        {hasStream && (
          <p className="mt-2 text-caption text-text-3">{t('player.playlist.noStreamSave')}</p>
        )}
      </form>
    </Dialog>
  )
}

export function PlaylistPanel() {
  const t = useT()
  const count = usePlayer((s) => s.items.length)
  const hasFiles = usePlayer((s) => s.items.some((i) => i.source === 'file'))
  const [confirm, setConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <QueueControls />
      <div className="-mx-1 max-h-[min(52vh,520px)] overflow-y-auto px-1">
        <PlaylistList />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <AddFilesButton
          onFiles={(f) => void addFiles(f, { play: false })}
          accept={MEDIA_ACCEPT}
          size="sm"
          label={t('player.actions.addFiles')}
        />
        <Button
          size="sm"
          variant="ghost"
          leading={<Save size={15} aria-hidden />}
          onClick={() => setSaving(true)}
          disabled={!hasFiles}
        >
          {t('player.playlist.save')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          leading={<Trash2 size={15} aria-hidden />}
          onClick={() => setConfirm(true)}
        >
          {t('player.playlist.clear')}
        </Button>
      </div>
      <p className="sr-only" aria-live="polite">
        {t('player.status.count', { count })}
      </p>
      <SavedPlaylists />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('player.playlist.clearConfirm')}
        description={t('player.playlist.clearConfirmDesc')}
        confirmLabel={t('player.playlist.clear')}
        danger
        onConfirm={clearAll}
      />
      <SaveDialog open={saving} onOpenChange={setSaving} />
    </div>
  )
}
