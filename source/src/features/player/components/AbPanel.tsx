import { AnimatePresence, motion } from 'motion/react'
import {
  Bookmark,
  Crosshair,
  Download,
  Film,
  ListPlus,
  Repeat,
  Scissors,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Button,
  Callout,
  FileName,
  ProgressBar,
  SendToMenu,
  Switch,
  Tooltip,
  toast,
} from '@/components/ui'
import { saveLargeBlob } from '@/lib/download'
import { formatBytes, formatTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { asFile, useFileBus } from '@/stores/fileBus'
import { isAbortError, useTask } from '@/stores/tasks'
import { useSettings } from '@/stores/settings'
import { spring } from '@/design/motion'
import { useT } from '@/i18n'
import { usePlayer, useCurrent } from '../store'
import { addChapter, addFiles, clearAB, seek, setAPoint, setBPoint, toggleABLoop } from '../actions'
import { abLength, dragHandle, isComplete, setB as calcSetB } from '../logic/ab'
import { formatPrecise, parseTimecode } from '../logic/timecode'
import { exportClip, isFFmpegLoaded } from '../export'

/** 可輸入的時間欄位：失焦或 Enter 才套用；格式錯誤時抖動 */
function TimeField({
  label,
  value,
  onCommit,
  onSetNow,
  setNowLabel,
}: {
  label: string
  value: number | null
  onCommit: (v: number) => boolean
  onSetNow: () => void
  setNowLabel: string
}) {
  const t = useT()
  const id = useId()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const shown = text ?? (value === null ? '' : formatPrecise(value))
  const commit = () => {
    if (text === null) return
    const v = parseTimecode(text)
    if (v === null || !onCommit(v)) {
      setError(true)
      return
    }
    setText(null)
    setError(false)
  }
  return (
    <div className="flex min-w-0 flex-col">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          inputMode="decimal"
          className={cn(
            'field min-w-0 flex-1 px-2.5! font-mono text-small! tabular-nums',
            error && 'shake border-danger!',
          )}
          value={shown}
          placeholder={t('player.ab.notSet')}
          aria-invalid={error || undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            setText(e.target.value)
            setError(false)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setText(null)
              setError(false)
            }
          }}
        />
        <Tooltip content={setNowLabel}>
          <Button
            variant="secondary"
            icon
            aria-label={`${label}：${setNowLabel}`}
            onClick={onSetNow}
          >
            <Crosshair size={16} aria-hidden />
          </Button>
        </Tooltip>
      </div>
      {error && (
        <p id={`${id}-err`} className="mt-1 text-caption text-danger-ink">
          {t('player.ab.invalid')}
        </p>
      )}
    </div>
  )
}

interface ExportResult {
  blob: Blob
  name: string
}

export function AbPanel() {
  const t = useT()
  const nav = useNavigate()
  const run = useTask('player')
  const item = useCurrent()
  const loop = usePlayer((s) => s.abLoop)
  const duration = usePlayer((s) => s.duration)
  const template = useSettings((s) => s.filenamePattern)
  const [precise, setPrecise] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const ctl = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  if (!item) return null
  const ab = item.ab
  const full = isComplete(ab)
  const len = abLength(ab)
  const canExport = full && item.source === 'file' && !!item.file

  const commitA = (v: number) => {
    if (ab.b !== null && v > ab.b - 0.2) return false
    usePlayer
      .getState()
      .updateItem(item.id, { ab: dragHandle({ ...ab, a: ab.a ?? 0 }, 'a', v, duration) })
    return true
  }
  const commitB = (v: number) => {
    const r = calcSetB(ab, v, duration)
    if (r.warning) return false
    usePlayer.getState().updateItem(item.id, { ab: r.ab })
    return true
  }

  const doExport = async () => {
    if (!canExport || !item.file || !full) return
    const file = item.file
    const controller = new AbortController()
    ctl.current = controller
    setBusy(true)
    setProgress(null)
    setResult(null)
    try {
      const res = await run(
        t('player.ab.exportTask', { name: file.name }),
        async ({ signal, progress: report }) => {
          const r = await exportClip({
            file,
            start: ab.a,
            end: ab.b,
            precise,
            template,
            signal,
            progress: (p) => {
              report(p)
              if (mounted.current) setProgress(p)
            },
          })
          return [r]
        },
        { signal: controller.signal },
      )
      const r = res[0]
      if (mounted.current) setResult(r)
      toast.success(t('player.ab.exportDone', { name: r.name }))
    } catch (e) {
      if (!isAbortError(e)) {
        console.error(e)
        toast.error(t('player.ab.exportFailed'), { description: t('player.ab.exportFailedDesc') })
      }
    } finally {
      ctl.current = null
      if (mounted.current) {
        setBusy(false)
        setProgress(null)
      }
    }
  }

  const makeGif = () => {
    if (!full || !item.file) return
    useFileBus.getState().send('gif', 'player', [item.file], { range: { start: ab.a, end: ab.b } })
    toast.success(t('common.sentTo', { target: t('modules.gif.name') }))
    nav('/gif')
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-small text-text-2">{t('player.ab.desc')}</p>
      <div className="grid grid-cols-2 gap-3">
        <TimeField
          key={`a-${item.id}`}
          label={t('player.ab.a')}
          value={ab.a}
          onCommit={commitA}
          onSetNow={() => setAPoint()}
          setNowLabel={t('player.ab.setA')}
        />
        <TimeField
          key={`b-${item.id}`}
          label={t('player.ab.b')}
          value={ab.b}
          onCommit={commitB}
          onSetNow={() => setBPoint()}
          setNowLabel={t('player.ab.setB')}
        />
      </div>
      <AnimatePresence initial={false}>
        {full && (
          <motion.div
            className="flex flex-col gap-3"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={spring.smooth}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-small font-medium tabular-nums text-text">
                {t('player.ab.length', { value: formatPrecise(len) })}
              </span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => seek(ab.a)}>
                  {t('player.ab.jumpA')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  leading={<X size={14} aria-hidden />}
                  onClick={clearAB}
                >
                  {t('player.ab.clear')}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-body font-medium">
                <Repeat size={16} className="text-accent-ink" aria-hidden />
                {t('player.ab.loop')}
              </span>
              <Switch checked={loop} onChange={toggleABLoop} ariaLabel={t('player.ab.loop')} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 匯出 */}
      <section
        className="flex flex-col gap-3 border-t border-border pt-3"
        aria-labelledby="ab-export-title"
      >
        <h4 id="ab-export-title" className="text-h3 font-semibold">
          {t('player.ab.export')}
        </h4>
        {!full && <p className="text-small text-text-3">{t('player.ab.needAB')}</p>}
        {item.source === 'url' && <Callout tone="neutral">{t('player.ab.exportNoFile')}</Callout>}
        <p className="text-small text-text-2">{t('player.ab.exportDesc')}</p>
        <Switch
          checked={precise}
          onChange={setPrecise}
          label={t('player.ab.precise')}
          description={t('player.ab.preciseDesc')}
          disabled={busy}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            leading={<Scissors size={16} aria-hidden />}
            loading={busy}
            disabled={!canExport}
            onClick={() => void doExport()}
          >
            {t('player.ab.export')}
          </Button>
          {busy && (
            <Button variant="ghost" onClick={() => ctl.current?.abort()}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
        {busy && (
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <ProgressBar value={progress} label={t('player.ab.exporting')} />
            <p className="text-caption tabular-nums text-text-3">
              {progress === null && !isFFmpegLoaded()
                ? t('player.ab.exportLoading')
                : t('player.ab.exporting')}
              {progress !== null && ` ${Math.round(progress * 100)}%`}
            </p>
          </div>
        )}
        <AnimatePresence>
          {result && !busy && (
            <motion.div
              className="card flex flex-col gap-2 p-3"
              initial={{ opacity: 0, scale: 0.96, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={spring.smooth}
            >
              <span className="text-caption font-medium text-text-3">{t('player.ab.result')}</span>
              <div className="flex min-w-0 items-center gap-2">
                <Film size={16} className="shrink-0 text-accent-ink" aria-hidden />
                <FileName name={result.name} className="text-body font-medium" />
                <span className="ml-auto shrink-0 text-caption tabular-nums text-text-3">
                  {formatBytes(result.blob.size)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  leading={<Download size={15} aria-hidden />}
                  onClick={() => void saveLargeBlob(result.blob, result.name)}
                >
                  {t('common.download')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leading={<ListPlus size={15} aria-hidden />}
                  onClick={() => void addFiles([asFile(result.blob, result.name)], { play: false })}
                >
                  {t('player.ab.addToPlaylist')}
                </Button>
                <SendToMenu
                  size="sm"
                  from="player"
                  targets={['gif']}
                  getFiles={() => [asFile(result.blob, result.name)]}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <Button
            variant="secondary"
            disabled={!full || !item.file}
            onClick={makeGif}
            leading={<GifGlyph />}
          >
            {t('player.ab.makeGif')}
          </Button>
          {full && len > 30 && (
            <p className="text-caption text-warning-ink">{t('player.ab.gifTooLong')}</p>
          )}
        </div>
      </section>

      <Chapters />
    </div>
  )
}

function GifGlyph() {
  return (
    <span
      aria-hidden
      className="grid h-4 w-5 place-items-center rounded-[4px] border-[1.5px] border-current text-[7px] font-extrabold leading-none"
    >
      GIF
    </span>
  )
}

/** 章節標記（P2）：時間軸上顯示分段，可命名、跳轉、移除 */
function Chapters() {
  const t = useT()
  const item = useCurrent()
  if (!item) return null
  const update = (id: string, name: string) =>
    usePlayer.getState().updateItem(item.id, (it) => ({
      chapters: it.chapters.map((c) => (c.id === id ? { ...c, name } : c)),
    }))
  const remove = (id: string) =>
    usePlayer
      .getState()
      .updateItem(item.id, (it) => ({ chapters: it.chapters.filter((c) => c.id !== id) }))
  return (
    <section
      className="flex flex-col gap-2 border-t border-border pt-3"
      aria-labelledby="chapters-title"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 id="chapters-title" className="text-h3 font-semibold">
          {t('player.ab.chapters')}
        </h4>
        <Button
          size="sm"
          variant="secondary"
          leading={<Bookmark size={15} aria-hidden />}
          onClick={addChapter}
        >
          {t('player.ab.addChapter')}
        </Button>
      </div>
      <p className="text-small text-text-3">{t('player.ab.chaptersDesc')}</p>
      {item.chapters.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          <AnimatePresence initial={false}>
            {item.chapters.map((c, i) => (
              <motion.li
                key={c.id}
                layout="position"
                className="flex items-center gap-1.5"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={spring.smooth}
              >
                <button
                  type="button"
                  className="h-9 shrink-0 rounded-sm px-2 font-mono text-small tabular-nums text-accent-ink hover:bg-surface-2"
                  onClick={() => seek(c.t)}
                  aria-label={`${formatTime(c.t)}`}
                >
                  {formatTime(c.t)}
                </button>
                <input
                  className="field h-9! min-w-0 flex-1"
                  value={c.name}
                  placeholder={t('player.ab.chapterName', { n: i + 1 })}
                  aria-label={t('player.ab.chapterRename')}
                  onChange={(e) => update(c.id, e.target.value)}
                />
                <button
                  type="button"
                  aria-label={t('player.ab.chapterRemove')}
                  className="grid size-9 shrink-0 place-items-center rounded-sm text-text-3 hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-danger-ink"
                  onClick={() => remove(c.id)}
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  )
}
