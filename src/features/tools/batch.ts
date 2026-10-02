/** 批次處理在工作區內的狀態（處理中 → 完成），與任務中心同步 */
import { create } from 'zustand'

export interface BatchState {
  status: 'idle' | 'running' | 'done'
  label: string
  /** 0 到 1；null 表示不確定 */
  progress: number | null
  summary: string
  /** 完成後是否提供「下載 ZIP」 */
  offerZip: boolean
  controller: AbortController | null
}

export const useBatch = create<BatchState>(() => ({
  status: 'idle',
  label: '',
  progress: 0,
  summary: '',
  offerZip: false,
  controller: null,
}))

export const resetBatch = () =>
  useBatch.setState({
    status: 'idle',
    label: '',
    progress: 0,
    summary: '',
    offerZip: false,
    controller: null,
  })
