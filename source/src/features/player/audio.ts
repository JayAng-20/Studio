/**
 * Web Audio 圖：MediaElementSource → 5 段等化器 → GainNode（> 100% 音量）→ Analyser → 輸出。
 * 每個媒體元素只能建立一次 MediaElementSource，因此以元素為單位快取。
 * 必須在使用者手勢內建立（瀏覽器的自動播放政策）。
 */

export const EQ_BANDS = [60, 230, 910, 3600, 14000] as const

export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0],
  bass: [7, 4, 0, -1, 0],
  vocal: [-2, -1, 4, 3, 0],
  treble: [0, -1, 0, 3, 6],
} as const satisfies Record<string, readonly number[]>

export type EqPreset = keyof typeof EQ_PRESETS

interface Graph {
  el: HTMLMediaElement
  ctx: AudioContext
  source: MediaElementAudioSourceNode
  filters: BiquadFilterNode[]
  gain: GainNode
  analyser: AnalyserNode
}

let graph: Graph | null = null

type AudioCtor = typeof AudioContext

export function webAudioSupported(): boolean {
  const w = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
  return typeof (w.AudioContext ?? w.webkitAudioContext) === 'function'
}

/** 取得（必要時建立）音訊圖；不支援時回傳 null */
export function ensureGraph(el: HTMLMediaElement): Graph | null {
  if (graph && graph.el === el) {
    if (graph.ctx.state === 'suspended') graph.ctx.resume().catch(() => {})
    return graph
  }
  closeGraph()
  const w = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  if (!Ctor) return null
  try {
    const ctx = new Ctor()
    const source = ctx.createMediaElementSource(el)
    const filters = EQ_BANDS.map((freq, i) => {
      const f = ctx.createBiquadFilter()
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
      f.frequency.value = freq
      f.Q.value = 1
      f.gain.value = 0
      return f
    })
    const gain = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.78
    let node: AudioNode = source
    for (const f of filters) {
      node.connect(f)
      node = f
    }
    node.connect(gain)
    gain.connect(analyser)
    analyser.connect(ctx.destination)
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    graph = { el, ctx, source, filters, gain, analyser }
    return graph
  } catch (e) {
    console.error(e)
    return null
  }
}

export function closeGraph() {
  if (!graph) return
  try {
    graph.source.disconnect()
    graph.analyser.disconnect()
    void graph.ctx.close()
  } catch (e) {
    console.error(e)
  }
  graph = null
}

export const hasGraph = (el: HTMLMediaElement | null) => !!graph && !!el && graph.el === el

export function getAnalyser(): AnalyserNode | null {
  return graph?.analyser ?? null
}

/** 套用音量：0–1 用元素音量，> 1 由 GainNode 放大 */
export function applyVolume(el: HTMLMediaElement, volume: number, muted: boolean) {
  el.volume = Math.max(0, Math.min(1, volume))
  el.muted = muted
  if (graph && graph.el === el) {
    const g = Math.max(1, volume)
    graph.gain.gain.setTargetAtTime(g, graph.ctx.currentTime, 0.02)
  }
}

export function applyEq(enabled: boolean, gains: number[]) {
  if (!graph) return
  graph.filters.forEach((f, i) => {
    f.gain.setTargetAtTime(enabled ? (gains[i] ?? 0) : 0, graph!.ctx.currentTime, 0.03)
  })
}
