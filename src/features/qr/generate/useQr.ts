import { useEffect, useMemo, useState } from 'react'
import { timing } from '@/design/motion'
import { buildContent, type ContentType } from '../lib/content'
import { buildGeometry, type Geometry } from '../lib/geometry'
import { createMatrix, QrTooLongError, type QrMatrix } from '../lib/matrix'
import { loadLogoImage } from '../lib/render'
import type { Ecc, QrStyle } from '../lib/style'
import { useQrStore } from '../store'

/** 延遲更新（即時預覽的 150 ms debounce） */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export interface QrComputed {
  /** 目前表單組出的內容（未延遲） */
  content: string
  /** 預覽中顯示的內容與類型（已延遲） */
  shown: { type: ContentType; content: string }
  matrix: QrMatrix | null
  /** 目前顯示的矩陣屬於哪個內容類型（交叉淡化與漣漪動畫用） */
  displayType: ContentType
  geo: Geometry | null
  error: 'tooLong' | 'failed' | null
  pending: boolean
}

/**
 * 產生流程：表單 → 內容字串 →（150 ms）→ 矩陣 → 幾何。
 * 樣式變更不經過 debounce，只重算幾何（很快）。
 */
export function useQr(): QrComputed {
  const type = useQrStore((s) => s.type)
  const values = useQrStore((s) => s.values)
  const style = useQrStore((s) => s.style)
  const content = useMemo(() => buildContent(type, values[type]), [type, values])
  const pair = useMemo(() => ({ type, content }), [type, content])
  const shown = useDebounced(pair, timing.previewDebounce)
  const ecc: Ecc = style.logo ? 'H' : style.ecc

  const [result, setResult] = useState<{
    key: string
    type: ContentType
    matrix: QrMatrix | null
    error: QrComputed['error']
  }>({ key: '', type, matrix: null, error: null })
  const key = `${ecc}\u0000${shown.type}\u0000${shown.content}`

  useEffect(() => {
    if (!shown.content) return
    let alive = true
    const forType = shown.type
    createMatrix(shown.content, ecc)
      .then((matrix) => alive && setResult({ key, type: forType, matrix, error: null }))
      .catch((e: unknown) => {
        if (!alive) return
        if (!(e instanceof QrTooLongError)) console.error(e)
        setResult({ key, type: forType, matrix: null, error: e instanceof QrTooLongError ? 'tooLong' : 'failed' })
      })
    return () => {
      alive = false
    }
  }, [key, shown.content, shown.type, ecc])

  const current = shown.content && result.key === key ? result : null
  // 內容清空時立即隱藏；計算中保留上一個結果避免閃爍
  const matrix = shown.content ? (current?.matrix ?? result.matrix) : null
  const error = shown.content ? (current ? current.error : result.error) : null
  const geo = useMemo(() => (matrix ? buildGeometry(matrix, style) : null), [matrix, style])
  return {
    content,
    shown,
    matrix: error ? null : matrix,
    displayType: current?.type ?? result.type,
    geo: error ? null : geo,
    error,
    pending: content !== shown.content || (!!shown.content && !current),
  }
}

/** 把 Logo 載入成可畫到 canvas 的影像 */
export function useLogoImage(style: QrStyle): HTMLImageElement | null {
  const src = style.logo?.src ?? null
  const [img, setImg] = useState<{ src: string; el: HTMLImageElement } | null>(null)
  useEffect(() => {
    if (!src) return
    let alive = true
    loadLogoImage(src)
      .then((el) => alive && setImg({ src, el }))
      .catch((e: unknown) => console.error(e))
    return () => {
      alive = false
    }
  }, [src])
  return src && img?.src === src ? img.el : null
}
