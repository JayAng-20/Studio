/// <reference lib="webworker" />
/**
 * 錄影計時器：Worker 內的 setInterval 不會像背景分頁的主執行緒計時器一樣被節流，
 * 所以切到別的視窗錄影時，畫面合成與計時仍然準確。
 * 主執行緒處理完一次 tick 會回傳 ack；還沒 ack 前不再送新的 tick，
 * 避免主執行緒忙碌時訊息越積越多、把頁面拖垮。
 */
type TickerMessage = { type: 'start'; interval: number } | { type: 'stop' } | { type: 'ack' }

let timer: ReturnType<typeof setInterval> | undefined
let waiting = false

self.onmessage = (e: MessageEvent<TickerMessage>) => {
  const msg = e.data
  if (msg.type === 'ack') {
    waiting = false
    return
  }
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  waiting = false
  if (msg.type === 'start') {
    const interval = Math.max(8, Math.min(1000, msg.interval))
    timer = setInterval(() => {
      if (waiting) return
      waiting = true
      self.postMessage(0)
    }, interval)
  }
}

export {}
