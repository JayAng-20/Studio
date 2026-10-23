import { AnimatePresence, motion } from 'motion/react'
import { Download, FilePlus2, Paperclip, Save, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { AddFilesButton, Badge, Button, EmptyState, FileName, Skeleton, Tooltip } from '@/components/ui'
import { spring, staggerDelay } from '@/design/motion'
import { downloadBlob } from '@/lib/download'
import { outputName } from '@/lib/filename'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { writeAttachments, type AttachmentFile } from '../lib/acrobat'
import { getDoc, sourceBytes, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { ToolFrame, rectId } from '../components/Frame'
import { PanelFooter, ToolPanel } from '../components/Shared'

interface Entry extends AttachmentFile {
  id: string
  isNew: boolean
  removed: boolean
}

export function AttachmentsTool() {
  const t = useT()
  const runner = useRunner()
  return (
    <ToolFrame
      tool="attachments"
      runner={runner}
      workingTitle={t('pdf.attachments.working')}
      resetLabel={t('pdf.attachments.again')}
    >
      {(source) => <Editor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

function Editor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [list, setList] = useState<Entry[] | null>(null)

  useEffect(() => {
    let alive = true
    getDoc(source.id)
      .then(async (doc) => {
        const map = await doc.getAttachments()
        const entries = (map instanceof Map ? [...map.entries()] : Object.entries(map ?? {})) as Array<
          [string, { filename: string; content?: Uint8Array | null; description?: string }]
        >
        // pdf.js 6 的 getAttachments() 只回傳名稱與說明，內容要以名稱另外讀取
        const list = await Promise.all(
          entries.map(async ([key, a]) => ({
            id: rectId(),
            name: a.filename,
            data: a.content ?? (await doc.getAttachmentContent(key)) ?? new Uint8Array(0),
            description: a.description,
            isNew: false,
            removed: false,
          })),
        )
        if (alive) setList(list)
      })
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [source.id])

  const add = async (files: File[]) => {
    const entries = await Promise.all(
      files.map(async (f) => ({
        id: rectId(),
        name: f.name,
        data: new Uint8Array(await f.arrayBuffer()),
        mime: f.type,
        isNew: true,
        removed: false,
      })),
    )
    setList((l) => [...(l ?? []), ...entries])
  }
  const dirty = !!list?.some((e) => e.isNew || e.removed)
  const save = () => {
    const keep = (list ?? []).filter((e) => !e.removed)
    const name = outputName(source.name, t('pdf.actions.attachments'), 'pdf', pattern)
    void runner.start(t('pdf.attachments.task', { name: source.name }), async ({ progress }) => {
      progress(null)
      const out = await writeAttachments(await sourceBytes(source), keep)
      return { files: [{ blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name }] }
    })
  }

  return (
    <Workspace
      main={
        <div className="card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-h3 font-semibold">{t('pdf.attachments.title')}</h3>
            <AddFilesButton onFiles={(f) => void add(f)} size="sm" label={t('pdf.attachments.add')} />
          </div>
          {list === null ? (
            <Skeleton className="h-14" />
          ) : list.length === 0 ? (
            <EmptyState
              illustration={
                <motion.span
                  animate={{ rotate: [0, -10, 10, 0] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                  className="text-accent-ink"
                >
                  <Paperclip size={34} aria-hidden />
                </motion.span>
              }
              title={t('pdf.attachments.empty')}
              description={t('pdf.attachments.emptyDesc')}
            />
          ) : (
            <ul className="flex flex-col gap-1.5">
              <AnimatePresence initial={false}>
                {list.map((e, i) => (
                  <motion.li
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: e.removed ? 0.5 : 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ ...spring.smooth, delay: e.isNew ? 0 : staggerDelay(i) }}
                    className="flex items-center gap-3 rounded-md border border-border bg-surface p-2.5"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
                      {e.isNew ? <FilePlus2 size={17} aria-hidden /> : <Paperclip size={17} aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <FileName
                        name={e.name}
                        className={cn('text-body font-medium', e.removed && 'line-through')}
                      />
                      <p className="flex items-center gap-2 text-caption text-text-3">
                        {formatBytes(e.data.length)}
                        {e.isNew && <Badge tone="accent" className="h-5 px-2">{t('pdf.attachments.new')}</Badge>}
                        {e.removed && <Badge tone="danger" className="h-5 px-2">{t('pdf.attachments.willRemove')}</Badge>}
                      </p>
                    </div>
                    <Tooltip content={t('common.download')}>
                      <Button
                        icon
                        size="sm"
                        variant="ghost"
                        aria-label={t('common.download')}
                        onClick={() =>
                          downloadBlob(new Blob([e.data as Uint8Array<ArrayBuffer>], { type: e.mime || 'application/octet-stream' }), e.name)
                        }
                      >
                        <Download size={16} aria-hidden />
                      </Button>
                    </Tooltip>
                    <Tooltip content={e.removed ? t('common.undo') : t('common.remove')}>
                      <Button
                        icon
                        size="sm"
                        variant="ghost"
                        aria-label={e.removed ? t('common.undo') : t('common.remove')}
                        onClick={() =>
                          setList((l) =>
                            e.isNew
                              ? (l ?? []).filter((x) => x.id !== e.id)
                              : (l ?? []).map((x) => (x.id === e.id ? { ...x, removed: !x.removed } : x)),
                          )
                        }
                      >
                        {e.removed ? <Undo2 size={16} aria-hidden /> : <Trash2 size={16} aria-hidden />}
                      </Button>
                    </Tooltip>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.tools.attachments.name')}>
          <p className="text-small text-text-2">{t('pdf.attachments.desc')}</p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!dirty}
              leading={<Save size={18} aria-hidden />}
              onClick={save}
            >
              {t('pdf.attachments.save')}
            </Button>
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
