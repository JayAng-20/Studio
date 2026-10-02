import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui'
import { isAbortError, useTask, type TaskContext } from '@/stores/tasks'
import { t } from '@/i18n'
import { PdfOpError } from '../lib/ops'
import type { ResultFile } from './ResultCard'

export type Phase = 'idle' | 'working' | 'done'

export interface RunOutput<T> {
  files: ResultFile[]
  data?: T
}

/**
 * 工具的處理流程：走 useTask（任務中心可看進度、取消、下載結果），
 * 同時在畫面上顯示進度；處理取消、錯誤與元件卸載。
 */
export function useRunner<T = undefined>() {
  const run = useTask('pdf')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<number | null>(0)
  const [output, setOutput] = useState<RunOutput<T> | null>(null)
  const ctrl = useRef<AbortController | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const start = useCallback(
    async (
      name: string,
      fn: (ctx: TaskContext) => Promise<RunOutput<T>>,
      opts: { minDuration?: number } = {},
    ) => {
      const c = new AbortController()
      const t0 = performance.now()
      ctrl.current = c
      setPhase('working')
      setProgress(0)
      setOutput(null)
      try {
        let out: RunOutput<T> | null = null
        await run(
          name,
          async (ctx) => {
            out = await fn({
              signal: ctx.signal,
              progress: (p) => {
                ctx.progress(p)
                if (alive.current) setProgress(p)
              },
            })
            return out.files.map((f) => ({ blob: f.blob, name: f.name }))
          },
          { signal: c.signal },
        )
        // 讓招牌動畫（例如合併的疊紙）至少完整播放一次
        const rest = (opts.minDuration ?? 0) - (performance.now() - t0)
        if (rest > 0) await new Promise((r) => setTimeout(r, rest))
        if (!alive.current) return
        setOutput(out)
        setPhase('done')
      } catch (e) {
        if (!alive.current) return
        setPhase('idle')
        if (isAbortError(e) || c.signal.aborted) {
          toast(t('pdf.errors.canceled'))
          return
        }
        showOpError(e)
      } finally {
        if (ctrl.current === c) ctrl.current = null
      }
    },
    [run],
  )

  const cancel = useCallback(() => ctrl.current?.abort(), [])
  const reset = useCallback(() => {
    setPhase('idle')
    setOutput(null)
    setProgress(0)
  }, [])

  return { phase, progress, output, start, cancel, reset }
}

/** 把錯誤轉成「發生什麼事＋可以怎麼辦」 */
export function showOpError(e: unknown) {
  if (e instanceof PdfOpError) {
    const map = {
      encrypted: ['pdf.errors.encrypted', 'pdf.errors.encryptedDesc'],
      invalid: ['pdf.errors.invalid', 'pdf.errors.invalidDesc'],
      image: ['pdf.errors.image', 'pdf.errors.imageDesc'],
      empty: ['pdf.errors.empty', 'pdf.errors.emptyDesc'],
    } as const
    const [title, desc] = map[e.code]
    toast.error(t(title), { description: t(desc, { name: e.detail ?? '' }) })
    return
  }
  if (e instanceof RangeError || (e as Error)?.name === 'QuotaExceededError') {
    toast.error(t('errors.outOfMemory'), { description: t('errors.outOfMemoryDesc') })
    return
  }
  toast.error(t('pdf.errors.failed'), { description: t('pdf.errors.failedDesc') })
}

export type Runner<T = undefined> = ReturnType<typeof useRunner<T>>
