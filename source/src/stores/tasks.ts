import { create } from 'zustand'
import { useCallback } from 'react'
import type { ModuleId } from '@/config/moduleIds'
import { uid } from '@/lib/files'

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export interface TaskResult {
  blob: Blob
  name: string
}

export interface Task {
  id: string
  module: ModuleId
  name: string
  /** 0 到 1；null 表示不確定進度 */
  progress: number | null
  status: TaskStatus
  error?: string
  results?: TaskResult[]
  createdAt: number
  finishedAt?: number
  controller: AbortController
}

interface TasksState {
  tasks: Task[]
  panelOpen: boolean
  add: (t: Task) => void
  update: (id: string, patch: Partial<Task>) => void
  cancel: (id: string) => void
  remove: (id: string) => void
  clearFinished: () => void
  setPanelOpen: (open: boolean) => void
}

export const useTasks = create<TasksState>((set, get) => ({
  tasks: [],
  panelOpen: false,
  add: (t) => set((s) => ({ tasks: [t, ...s.tasks].slice(0, 50) })),
  update: (id, patch) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  cancel: (id) => {
    const t = get().tasks.find((x) => x.id === id)
    if (t && (t.status === 'running' || t.status === 'queued')) {
      t.controller.abort()
      get().update(id, { status: 'canceled', finishedAt: Date.now() })
    }
  },
  remove: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  clearFinished: () =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.status === 'running' || t.status === 'queued') })),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
}))

export const isActive = (t: Task) => t.status === 'running' || t.status === 'queued'

export interface TaskContext {
  signal: AbortSignal
  /** 0 到 1，或 null 表示不確定 */
  progress: (p: number | null) => void
}

export class TaskCanceledError extends Error {
  constructor() {
    super('canceled')
    this.name = 'AbortError'
  }
}

export const isAbortError = (e: unknown) =>
  (e instanceof DOMException && e.name === 'AbortError') || (e as Error)?.name === 'AbortError'

/** 進度更新節流：每 ~60 ms 最多一次寫入 store */
function throttleProgress(id: string) {
  let last = 0
  let pending: number | null | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    timer = undefined
    if (pending !== undefined) useTasks.getState().update(id, { progress: pending })
    pending = undefined
    last = performance.now()
  }
  return (p: number | null) => {
    pending = p === null ? null : Math.max(0, Math.min(1, p))
    if (performance.now() - last > 60) flush()
    else if (!timer) timer = setTimeout(flush, 60)
  }
}

/**
 * 執行一個長時間作業並登記到任務中心。
 * 作業函式收到 signal 與 progress；回傳結果檔（可空）。
 */
export async function runTask<T extends TaskResult[] | void>(
  module: ModuleId,
  name: string,
  fn: (ctx: TaskContext) => Promise<T>,
  opts: { signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const id = uid('task')
  const store = useTasks.getState()
  store.add({ id, module, name, progress: 0, status: 'running', createdAt: Date.now(), controller })
  const progress = throttleProgress(id)
  try {
    const result = await fn({ signal: controller.signal, progress })
    if (controller.signal.aborted) throw new TaskCanceledError()
    useTasks.getState().update(id, {
      status: 'done',
      progress: 1,
      finishedAt: Date.now(),
      results: Array.isArray(result) ? result : undefined,
    })
    return result
  } catch (e) {
    if (isAbortError(e) || controller.signal.aborted) {
      useTasks.getState().update(id, { status: 'canceled', finishedAt: Date.now() })
    } else {
      console.error(e)
      useTasks.getState().update(id, {
        status: 'error',
        finishedAt: Date.now(),
        error: e instanceof Error ? e.message : String(e),
      })
    }
    throw e
  }
}

/** React hook 版本：綁定模組 id */
export function useTask(module: ModuleId) {
  return useCallback(
    <T extends TaskResult[] | void>(
      name: string,
      fn: (ctx: TaskContext) => Promise<T>,
      opts?: { signal?: AbortSignal },
    ) => runTask<T>(module, name, fn, opts),
    [module],
  )
}

export const useActiveTaskCount = () => useTasks((s) => s.tasks.filter(isActive).length)
