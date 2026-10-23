/** 執行階段偵測各輸出格式的編碼支援（能力偵測，不看瀏覽器名稱） */
import { useEffect, useState } from 'react'
import { canEncode } from '@/lib/image'
import { wasmSupported } from './engine/wasm'
import { OUTPUT_ORDER, type OutputFormat } from './types'

/** native：瀏覽器內建；wasm：用內建的 WebAssembly 編碼器；none：無法輸出 */
export type Support = 'native' | 'wasm' | 'none'
export type SupportMap = Record<OutputFormat, Support>

const initial: SupportMap = {
  jpeg: 'native',
  png: 'native',
  webp: 'native',
  avif: 'wasm',
  ico: 'native',
  bmp: 'native',
  gif: 'native',
}

let cached: Promise<SupportMap> | null = null

export function detectSupport(): Promise<SupportMap> {
  cached ??= (async () => {
    const wasm = wasmSupported()
    const [webp, avif] = await Promise.all([canEncode('image/webp'), canEncode('image/avif')])
    const map: SupportMap = { ...initial }
    map.webp = webp ? 'native' : wasm ? 'wasm' : 'none'
    map.avif = avif ? 'native' : wasm ? 'wasm' : 'none'
    for (const f of OUTPUT_ORDER) if (map[f] === undefined) map[f] = 'native'
    return map
  })()
  return cached
}

export function useFormatSupport(): { support: SupportMap; ready: boolean } {
  const [state, setState] = useState<{ support: SupportMap; ready: boolean }>({
    support: initial,
    ready: false,
  })
  useEffect(() => {
    let alive = true
    void detectSupport().then((support) => alive && setState({ support, ready: true }))
    return () => {
      alive = false
    }
  }, [])
  return state
}
