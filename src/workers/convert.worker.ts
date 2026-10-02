/// <reference lib="webworker" />
/**
 * 圖片互轉 Worker：以 OffscreenCanvas 解碼、縮放、編碼。
 * 一次處理一個工作；取消時由主執行緒直接 terminate。
 */
import { convertImage, makeThumb } from '@/features/convert/engine/pipeline'
import { setCodecProgress } from '@/features/convert/engine/codecs'
import { EngineError, type WorkerRequest, type WorkerResponse } from '@/features/convert/types'

declare const self: DedicatedWorkerGlobalScope

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer)

setCodecProgress((codec, loaded, total, done) => post({ type: 'codec', codec, loaded, total, done }))

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  const id = req.job.id
  try {
    if (req.type === 'convert') {
      let last = 0
      const result = await convertImage(req.job, (value) => {
        // 節流：進度至少變化 1% 才回報
        if (value - last >= 0.01 || value >= 1) {
          last = value
          post({ type: 'progress', id, value })
        }
      })
      post({ type: 'convert-done', id, result }, [result.buffer])
    } else {
      const result = await makeThumb(req.job)
      post({ type: 'thumb-done', id, result }, [result.buffer])
    }
  } catch (err) {
    const code = err instanceof EngineError ? err.code : 'unknown'
    // EngineError 的原始例外已在流程中記錄過，這裡只記錄未預期的錯誤
    if (!(err instanceof EngineError)) console.error(err)
    post({ type: 'error', id, code, message: String((err as Error)?.message ?? err) })
  }
}
