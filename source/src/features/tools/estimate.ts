/**
 * 壓縮分頁的即時預估：設定停止變動 350 ms 後，用跟下載完全相同的管線實際編碼一次，
 * 結果進快取（之後下載直接沿用），並提供對比滑桿用的物件 URL。
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { isAbortError } from '@/stores/tasks'
import { cacheKey, exportDoc } from './actions'
import { useCurrent, useTools } from './store'

export interface EstimateState {
  docId: string | null
  key: string | null
  status: 'idle' | 'running' | 'done' | 'error'
  size: number
  quality: number | null
  reached: boolean
  passthrough: boolean
  mime: string
  /** 結果的物件 URL（前後對比用） */
  url: string | null
  width: number
  height: number
}

export const useEstimate = create<EstimateState>(() => ({
  docId: null,
  key: null,
  status: 'idle',
  size: 0,
  quality: null,
  reached: true,
  passthrough: false,
  mime: '',
  url: null,
  width: 0,
  height: 0,
}))

export const ESTIMATE_DEBOUNCE = 350

/** 掛在工作台：壓縮分頁開著時自動估算目前圖片 */
export function useEstimateRunner() {
  const tab = useTools((s) => s.tab)
  const { doc, state } = useCurrent()
  const active = tab === 'compress' && doc?.status === 'ready' && !!state
  useEffect(() => {
    if (!active || !doc || !state) return
    const key = cacheKey(doc, state)
    const cur = useEstimate.getState()
    if (cur.key === key && cur.status !== 'error') return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      useEstimate.setState({ status: 'running', docId: doc.id })
      try {
        const r = await exportDoc(doc, state, ctrl.signal)
        if (ctrl.signal.aborted) return
        const prev = useEstimate.getState().url
        if (prev) URL.revokeObjectURL(prev)
        useEstimate.setState({
          docId: doc.id,
          key,
          status: 'done',
          size: r.blob.size,
          quality: r.quality,
          reached: r.reached,
          passthrough: r.passthrough,
          mime: r.mime,
          url: URL.createObjectURL(r.blob),
          width: r.width,
          height: r.height,
        })
      } catch (e) {
        if (isAbortError(e) || ctrl.signal.aborted) return
        console.error(e)
        useEstimate.setState({ status: 'error', key, docId: doc.id })
      }
    }, ESTIMATE_DEBOUNCE)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [active, doc, state])

  // 離開工作台時釋放物件 URL
  useEffect(
    () => () => {
      const u = useEstimate.getState().url
      if (u) URL.revokeObjectURL(u)
      useEstimate.setState({ url: null, key: null, docId: null, status: 'idle' })
    },
    [],
  )
}
