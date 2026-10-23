/// <reference lib="webworker" />
/**
 * GIF 製作 Worker：量化／抖色、GIF 組裝（gifenc）、APNG 壓縮（fflate）、WebP 影格編碼（@jsquash/webp）。
 * 同一支程式可當「量化池」或「組裝器」使用；組裝器一次只處理一個工作階段。
 */
import { computePalette, quantizeFrame, GifAssembler } from '@/features/gif/gifCore'
import { filterScanlines, extractWebpPayload } from '@/features/gif/containers'
import type { WorkerRequest, WorkerResponse } from '@/features/gif/protocol'

declare const self: DedicatedWorkerGlobalScope

let assembler: GifAssembler | null = null

type WebpEncode = (data: ImageData, opts: Record<string, number>) => Promise<ArrayBuffer>
let webpEncoder: Promise<WebpEncode> | null = null

/** WebP 編碼器延後載入；WASM 以 ?url 交給 Vite 打包，不從外部網域載入 */
function loadWebp(): Promise<WebpEncode> {
  webpEncoder ??= (async () => {
    const [mod, simdUrl, plainUrl] = await Promise.all([
      import('@jsquash/webp/encode.js'),
      import('@jsquash/webp/codec/enc/webp_enc_simd.wasm?url').then((m) => m.default),
      import('@jsquash/webp/codec/enc/webp_enc.wasm?url').then((m) => m.default),
    ])
    await mod.init({
      locateFile: (path: string) => (path.includes('simd') ? simdUrl : plainUrl),
    } as Parameters<typeof mod.init>[0])
    return mod.default as unknown as WebpEncode
  })()
  // 載入失敗時允許下次重試
  webpEncoder.catch(() => {
    webpEncoder = null
  })
  return webpEncoder
}

function reply(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer)
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data
  try {
    switch (m.type) {
      case 'palette': {
        const palette = computePalette(new Uint8Array(m.samples), m.colors, m.reserve)
        reply({ id: m.id, ok: true, type: 'palette', palette })
        break
      }
      case 'quantize': {
        const r = quantizeFrame(
          new Uint8ClampedArray(m.rgba),
          m.width,
          m.height,
          m.colors,
          m.dither,
          m.palette,
          m.reserve,
        )
        const index = r.index.buffer as ArrayBuffer
        reply(
          {
            id: m.id,
            ok: true,
            type: 'quantize',
            index,
            palette: r.palette,
            transparentIndex: r.transparentIndex,
          },
          [index],
        )
        break
      }
      case 'gif-begin': {
        assembler = new GifAssembler({
          width: m.width,
          height: m.height,
          repeat: m.repeat,
          global: m.global,
          diff: m.diff,
          tolerance: m.tolerance,
          transparent: m.transparent,
        })
        reply({ id: m.id, ok: true, type: 'gif-begin' })
        break
      }
      case 'gif-frame': {
        if (!assembler) throw new Error('assembler not started')
        assembler.add(new Uint8Array(m.index), m.palette, m.transparentIndex, m.delayCs)
        reply({ id: m.id, ok: true, type: 'gif-frame', written: 0 })
        break
      }
      case 'gif-end': {
        if (!assembler) throw new Error('assembler not started')
        const bytes = assembler.finish()
        const frames = assembler.framesWritten
        const frameSizes = [...assembler.frameSizes]
        assembler = null
        const buf = bytes.buffer as ArrayBuffer
        reply({ id: m.id, ok: true, type: 'gif-end', bytes: buf, frameSizes, frames }, [buf])
        break
      }
      case 'deflate': {
        const { zlibSync } = await import('fflate')
        const raw = filterScanlines(new Uint8Array(m.rgba), m.width, m.height, m.colorType)
        const data = zlibSync(raw, { level: 9 }).buffer as ArrayBuffer
        reply({ id: m.id, ok: true, type: 'deflate', data }, [data])
        break
      }
      case 'webp': {
        const encode = await loadWebp()
        const img = new ImageData(new Uint8ClampedArray(m.rgba), m.width, m.height)
        const out = await encode(img, {
          quality: m.quality,
          lossless: m.lossless ? 1 : 0,
          method: 4,
          // 動畫影格常有大面積平坦色塊，exact 讓透明區保持乾淨
          exact: 1,
          alpha_quality: 100,
        })
        const { chunks, hasAlpha } = extractWebpPayload(new Uint8Array(out))
        const copy = chunks.slice().buffer as ArrayBuffer
        reply({ id: m.id, ok: true, type: 'webp', chunks: copy, hasAlpha }, [copy])
        break
      }
    }
  } catch (err) {
    console.error(err)
    reply({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
