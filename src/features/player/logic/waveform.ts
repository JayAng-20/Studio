/** 波形：把音訊樣本壓成固定數量的峰值（0 到 1） */

export function computePeaks(channels: Float32Array[], buckets: number): Float32Array {
  const out = new Float32Array(Math.max(1, buckets))
  if (!channels.length || !channels[0].length) return out
  const len = channels[0].length
  const per = len / out.length
  let max = 0
  for (let b = 0; b < out.length; b++) {
    const s = Math.floor(b * per)
    const e = Math.min(len, Math.floor((b + 1) * per))
    let peak = 0
    // 大區間時跳著取樣，維持運算量固定
    const step = Math.max(1, Math.floor((e - s) / 256))
    for (const ch of channels) {
      for (let i = s; i < e; i += step) {
        const v = Math.abs(ch[i])
        if (v > peak) peak = v
      }
    }
    out[b] = peak
    if (peak > max) max = peak
  }
  if (max > 0) for (let b = 0; b < out.length; b++) out[b] /= max
  return out
}

/** 解碼音訊並計算峰值（低取樣率解碼以節省記憶體） */
export async function decodePeaks(
  file: Blob,
  buckets: number,
  signal?: AbortSignal,
): Promise<Float32Array | null> {
  const Ctx =
    typeof OfflineAudioContext === 'function'
      ? OfflineAudioContext
      : ((globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext ?? null)
  if (!Ctx) return null
  const buf = await file.arrayBuffer()
  if (signal?.aborted) return null
  const ctx = new Ctx(1, 1, 8000)
  const audio = await ctx.decodeAudioData(buf)
  if (signal?.aborted) return null
  const chans: Float32Array[] = []
  for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) chans.push(audio.getChannelData(c))
  return computePeaks(chans, buckets)
}
