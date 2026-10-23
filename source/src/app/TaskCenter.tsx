import { AnimatePresence, motion } from 'motion/react'
import { Check, Download, ListChecks, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { moduleById } from '@/config/modules'
import {
  Button,
  FileName,
  IconTile,
  ProgressBar,
  ProgressRing,
  Sheet,
  Badge,
} from '@/components/ui'
import { isActive, useTasks, type Task } from '@/stores/tasks'
import { useIsMobile } from '@/lib/useMedia'
import { downloadBlob } from '@/lib/download'
import { spring } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'

/** 任務中心：右下角浮動膠囊（進行中數量＋迷你環形進度）；點開展開成面板；手機改成抽屜 */
export function TaskCenter() {
  const t = useT()
  const tasks = useTasks((s) => s.tasks)
  const open = useTasks((s) => s.panelOpen)
  const setOpen = useTasks((s) => s.setPanelOpen)
  const isMobile = useIsMobile()
  const active = tasks.filter(isActive)
  const overall = active.length
    ? active.reduce((a, x) => a + (x.progress ?? 0), 0) / active.length
    : 1
  const indeterminate = active.length > 0 && active.every((x) => x.progress === null)
  const allDone = tasks.length > 0 && active.length === 0
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || isMobile) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => {
      const el = panelRef.current
      if (
        el &&
        !el.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('[data-task-pill]')
      )
        setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open, isMobile, setOpen])

  const list = <TaskList tasks={tasks} />

  return (
    <>
      <AnimatePresence>
        {tasks.length > 0 && !(open && !isMobile) && (
          <motion.button
            data-task-pill
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={t('tasks.open')}
            className={cn(
              'glass fixed right-4 z-50 flex h-11 items-center gap-2 rounded-full pl-2 pr-4 text-small font-semibold shadow-e3 sm:right-6',
              'bottom-[calc(76px+env(safe-area-inset-bottom))] sm:bottom-6',
            )}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={spring.smooth}
            layout
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {allDone ? (
                <motion.span
                  key="done"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={spring.bouncy}
                  className="grid size-7 place-items-center rounded-full bg-success text-white"
                >
                  <Check size={16} strokeWidth={3} aria-hidden />
                </motion.span>
              ) : (
                <motion.span
                  key="ring"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  <ProgressRing value={indeterminate ? null : overall} size={28} stroke={3} />
                </motion.span>
              )}
            </AnimatePresence>
            <span aria-live="polite">
              {allDone ? t('tasks.allDone') : t('tasks.running', { count: active.length })}
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {isMobile ? (
        <Sheet open={open} onOpenChange={setOpen} title={t('tasks.title')}>
          {list}
        </Sheet>
      ) : (
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-label={t('tasks.title')}
              className="floating fixed bottom-6 right-6 z-[60] flex max-h-[min(560px,calc(100dvh-120px))] w-[380px] flex-col overflow-hidden"
              style={{ transformOrigin: 'bottom right' }}
              initial={{ opacity: 0, scale: 0.9, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 12 }}
              transition={spring.smooth}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <h2 className="flex items-center gap-2 text-h3 font-semibold">
                  <ListChecks size={18} aria-hidden className="text-text-2" />
                  {t('tasks.title')}
                </h2>
                <div className="flex items-center gap-1">
                  {tasks.some((x) => !isActive(x)) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => useTasks.getState().clearFinished()}
                    >
                      {t('tasks.clearDone')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={t('common.close')}
                    onClick={() => setOpen(false)}
                    autoFocus
                  >
                    <X size={16} aria-hidden />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">{list}</div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </>
  )
}

function TaskList({ tasks }: { tasks: Task[] }) {
  const t = useT()
  if (!tasks.length) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="font-semibold">{t('tasks.empty')}</p>
        <p className="mt-1 text-small text-text-3">{t('tasks.emptyDesc')}</p>
      </div>
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {tasks.map((task) => (
          <motion.li
            key={task.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={spring.smooth}
          >
            <TaskRow task={task} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

function TaskRow({ task }: { task: Task }) {
  const t = useT()
  const status = {
    queued: t('tasks.statusQueued'),
    running: t('tasks.statusRunning'),
    done: t('tasks.statusDone'),
    error: t('tasks.statusError'),
    canceled: t('tasks.statusCanceled'),
  }[task.status]
  const tone =
    task.status === 'done'
      ? 'success'
      : task.status === 'error'
        ? 'danger'
        : task.status === 'canceled'
          ? 'neutral'
          : 'accent'
  const download = async () => {
    const r = task.results
    if (!r?.length) return
    if (r.length === 1) return downloadBlob(r[0].blob, r[0].name)
    const { createZip } = await import('@/lib/zip')
    downloadBlob(
      await createZip(r.map((x) => ({ name: x.name, data: x.blob }))),
      `${task.name}.zip`,
    )
  }
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center gap-2.5">
        <IconTile module={task.module} size="sm" label={t(moduleById[task.module].nameKey)} />
        <div className="min-w-0 flex-1">
          <FileName name={task.name} className="text-body font-medium" />
          <div className="mt-0.5 flex items-center gap-2">
            <Badge tone={tone}>{status}</Badge>
            {task.status === 'running' && task.progress !== null && (
              <span className="text-caption tabular-nums text-text-3">
                {Math.round(task.progress * 100)}%
              </span>
            )}
          </div>
        </div>
        {isActive(task) ? (
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={t('tasks.cancel')}
            onClick={() => useTasks.getState().cancel(task.id)}
          >
            <X size={16} aria-hidden />
          </Button>
        ) : task.results?.length ? (
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={t('common.download')}
            onClick={download}
          >
            <Download size={16} aria-hidden />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={t('common.remove')}
            onClick={() => useTasks.getState().remove(task.id)}
          >
            <X size={16} aria-hidden />
          </Button>
        )}
      </div>
      {task.status === 'running' && (
        <ProgressBar
          value={task.progress}
          className="mt-2.5"
          size="sm"
          label={t('tasks.progressLabel', {
            name: task.name,
            percent: Math.round((task.progress ?? 0) * 100),
          })}
        />
      )}
      {task.status === 'error' && task.error && (
        <p className="mt-2 text-caption text-danger-ink">{t('errors.genericDesc')}</p>
      )}
    </div>
  )
}
