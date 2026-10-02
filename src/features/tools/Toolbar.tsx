/** 畫布上方工具列：復原／重做、按住看原圖、檔名與尺寸、GPS 提示、匯出動作 */
import {
  Archive,
  Copy,
  Download,
  Eye,
  MapPin,
  MoreHorizontal,
  Redo2,
  Send,
  Undo2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button, FileName, Menu, SendToMenu, Tooltip, toast } from '@/components/ui'
import { caps, modKey } from '@/lib/capabilities'
import { cn } from '@/lib/cn'
import { useMedia } from '@/lib/useMedia'
import { useFileBus } from '@/stores/fileBus'
import { moduleById } from '@/config/modules'
import { useT } from '@/i18n'
import { canRedo, canUndo, redoLabel, undoLabel } from './lib/history'
import { outputSize } from './lib/geometry'
import { copyDoc, downloadAllZip, downloadDoc, filesForSend } from './actions'
import { useTools, type Doc } from './store'
import { useViewStore } from './ui'
import type { EditState } from './lib/types'

export function Toolbar({ doc, state }: { doc: Doc | null; state: EditState | undefined }) {
  const t = useT()
  const nav = useNavigate()
  const history = useTools((s) => s.history)
  const undo = useTools((s) => s.undo)
  const redo = useTools((s) => s.redo)
  const setTab = useTools((s) => s.setTab)
  const docCount = useTools((s) => s.docs.filter((d) => d.status === 'ready').length)
  const setPeek = useViewStore((s) => s.setPeek)
  const wide = useMedia('(min-width: 640px)')
  const [busy, setBusy] = useState(false)
  const ready = doc?.status === 'ready' && !!state
  const out = ready ? outputSize(state, doc.srcW, doc.srcH) : null
  const mod = modKey()

  const download = async () => {
    if (!ready || busy) return
    setBusy(true)
    await downloadDoc(doc)
    setBusy(false)
  }
  const copy = async () => {
    if (!ready) return
    if (await copyDoc(doc)) toast.success(t('tools.toolbar.copied'))
    else toast.error(t('common.copyFailed'))
  }
  const sendToConvert = async () => {
    const files = await filesForSend(null)
    if (!files.length) return
    useFileBus.getState().send('convert', 'tools', files)
    toast.success(t('common.sentTo', { target: t(moduleById.convert.nameKey) }))
    nav(moduleById.convert.path)
  }

  const peekHandlers = {
    onPointerDown: () => setPeek(true),
    onPointerUp: () => setPeek(false),
    onPointerLeave: () => setPeek(false),
    onPointerCancel: () => setPeek(false),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setPeek(true)
      }
    },
    onKeyUp: () => setPeek(false),
    onBlur: () => setPeek(false),
  }

  const moreItems = [
    ...(docCount > 1
      ? [
          {
            key: 'zip',
            icon: <Archive size={16} aria-hidden />,
            label: t('tools.toolbar.downloadAll'),
            onSelect: () => void downloadAllZip(),
          },
        ]
      : []),
    {
      key: 'copy',
      icon: <Copy size={16} aria-hidden />,
      label: caps.clipboardWrite() ? t('tools.toolbar.copy') : t('tools.toolbar.copyUnsupported'),
      onSelect: () => void copy(),
      disabled: !caps.clipboardWrite() || !ready,
    },
    ...(!wide
      ? [
          {
            key: 'send',
            icon: <Send size={16} aria-hidden />,
            label: `${t('common.sendTo')} ${t(moduleById.convert.nameKey)}`,
            onSelect: () => void sendToConvert(),
          },
        ]
      : []),
  ]

  return (
    <div
      role="toolbar"
      aria-label={t('tools.toolbar.label')}
      className="flex min-h-13 items-center gap-1 border-b border-border px-2 py-1.5"
    >
      <IconAction
        label={
          canUndo(history)
            ? t('tools.toolbar.undoWhat', { action: undoLabel(history) })
            : t('tools.toolbar.nothingToUndo')
        }
        aria={t('tools.toolbar.undo')}
        shortcut={`${mod}Z`}
        disabled={!canUndo(history)}
        onClick={undo}
      >
        <Undo2 size={18} aria-hidden />
      </IconAction>
      <IconAction
        label={
          canRedo(history)
            ? t('tools.toolbar.redoWhat', { action: redoLabel(history) })
            : t('tools.toolbar.nothingToRedo')
        }
        aria={t('tools.toolbar.redo')}
        shortcut={`⇧${mod}Z`}
        disabled={!canRedo(history)}
        onClick={redo}
      >
        <Redo2 size={18} aria-hidden />
      </IconAction>
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      <Tooltip content={t('tools.toolbar.holdOriginal')}>
        <Button
          variant="ghost"
          icon
          size="md"
          aria-label={t('tools.toolbar.holdOriginal')}
          disabled={!ready}
          {...peekHandlers}
        >
          <Eye size={18} aria-hidden />
        </Button>
      </Tooltip>

      <div className="min-w-0 flex-1 px-2">
        {doc && (
          <div className="hidden min-w-0 flex-col sm:flex">
            <FileName name={doc.name} className="text-small font-medium text-text" />
            {out && (
              <span className="truncate whitespace-nowrap text-caption tabular-nums text-text-3">
                {doc.srcW} × {doc.srcH}
                {(out.w !== doc.srcW || out.h !== doc.srcH) && ` → ${out.w} × ${out.h}`}
              </span>
            )}
          </div>
        )}
      </div>

      {doc?.hasGps && state?.meta === 'keep' && (
        <button
          type="button"
          onClick={() => setTab('info')}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] px-2.5 text-caption font-medium text-warning-ink transition-[filter] hover:brightness-95"
          aria-label={t('tools.info.gpsTitle')}
        >
          <MapPin size={14} aria-hidden />
          <span className="hidden md:inline">{t('tools.toolbar.gpsChip')}</span>
        </button>
      )}

      {wide && (
        <SendToMenu
          from="tools"
          targets={['convert']}
          size="sm"
          variant="ghost"
          getFiles={() => filesForSend(null)}
        />
      )}
      <Button
        variant="primary"
        size="sm"
        leading={<Download size={16} aria-hidden />}
        disabled={!ready}
        loading={busy}
        onClick={download}
        className="shrink-0"
      >
        {t('tools.toolbar.download')}
      </Button>
      <Menu
        label={t('tools.toolbar.more')}
        items={moreItems}
        trigger={
          <Button
            variant="ghost"
            icon
            size="sm"
            aria-label={t('tools.toolbar.more')}
            className={cn('shrink-0')}
          >
            <MoreHorizontal size={18} aria-hidden />
          </Button>
        }
      />
    </div>
  )
}

function IconAction({
  label,
  aria,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string
  aria: string
  shortcut?: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      {/* 停用時仍要能顯示提示：包一層 span */}
      <span className="inline-flex">
        <Button variant="ghost" icon aria-label={aria} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </span>
    </Tooltip>
  )
}
