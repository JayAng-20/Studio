/** 單檔前後對比：CompareSlider＋縮放檢視（符合視窗／100%／200%） */
import { Download } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, CompareSlider, Dialog, SegmentedControl, SendToMenu, Spinner } from '@/components/ui'
import { formatBytes, percentChange } from '@/lib/format'
import { downloadBlob } from '@/lib/download'
import { asFile } from '@/stores/fileBus'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { useConvert, type ConvertItem } from '../store'
import { getPool } from '../engine/pool'
import { decodeHeic } from '../engine/mainDecode'
import { FORMATS } from '../types'
import { OUTPUT_LABEL, sourceLabel } from '../texts'
import { SavingsBadge } from './bits'

type Zoom = 'fit' | '1' | '2'

/** 瀏覽器可直接以 <img> 顯示的來源格式 */
const DISPLAYABLE = new Set(['jpeg', 'png', 'apng', 'gif', 'webp', 'bmp', 'svg', 'ico'])

/** 原圖預覽 URL：可直接顯示就用原檔，否則（HEIC、AVIF…）解碼成無損 PNG */
function useBeforeUrl(item: ConvertItem | undefined, maxSide: number) {
  const [state, setState] = useState<{ id: string; url: string } | null>(null)
  const id = item?.id
  useEffect(() => {
    if (!item) return
    let url: string | null = null
    let alive = true
    const fmt = item.probe?.format ?? 'unknown'
    void (async () => {
      try {
        if (DISPLAYABLE.has(fmt)) {
          url = URL.createObjectURL(fmt === 'svg' ? new Blob([item.file], { type: 'image/svg+xml' }) : item.file)
          await Promise.resolve()
          if (alive) setState({ id: item.id, url })
          return
        }
        const bitmap = fmt === 'heic' ? await decodeHeic(item.file) : undefined
        const r = await getPool().thumb({ file: bitmap ? undefined : item.file, bitmap, source: fmt, maxSide, lossless: true })
        if (!alive) return
        url = URL.createObjectURL(new Blob([r.buffer], { type: r.mime }))
        setState({ id: item.id, url })
      } catch (e) {
        console.error(e)
      }
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
    // 只在換項目時重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, maxSide])
  return state && state.id === id ? state.url : null
}

export function CompareDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT()
  const item = useConvert((s) => s.items.find((x) => x.id === id))
  const markDelivered = useConvert((s) => s.markDelivered)
  const result = item?.status === 'done' ? item.result : undefined
  const open = !!id && !!item && !!result
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [boxW, setBoxW] = useState(0)
  // Dialog 內容由 Portal 延後掛載，用 callback ref 在元素出現時才開始量測
  const ro = useRef<ResizeObserver | null>(null)
  const box = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect()
    ro.current = null
    if (!el) return
    const measure = () => setBoxW(el.clientWidth)
    ro.current = new ResizeObserver(measure)
    ro.current.observe(el)
    measure()
  }, [])
  const maxSide = Math.min(4096, Math.max(result?.width ?? 0, result?.height ?? 0) || 2048)
  const beforeUrl = useBeforeUrl(open ? item : undefined, maxSide)


  if (!item || !result) return <Dialog open={false} onOpenChange={() => onClose()} title="" />

  const ratio = result.width / result.height
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const maxH = typeof window !== 'undefined' ? Math.max(240, window.innerHeight * 0.58) : 600
  const fitW = Math.min(boxW || 320, maxH * ratio)
  const w = zoom === 'fit' ? fitW : (result.width / dpr) * Number(zoom)
  const h = w / ratio
  const pct = percentChange(item.size, result.size)

  const img = (src: string | null, label: string) =>
    src ? (
      <img src={src} alt={label} draggable={false} className="absolute inset-0 size-full object-contain" />
    ) : (
      <span className="absolute inset-0 grid place-items-center">
        <Spinner size={28} />
      </span>
    )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('convert.compare.title')}
      description={item.name}
      className="max-w-[min(1100px,96vw)]!"
      footer={
        <>
          <SendToMenu
            from="convert"
            targets={['tools']}
            getFiles={() => {
              markDelivered()
              return [asFile(result.blob, result.name)]
            }}
          />
          <Button
            variant="primary"
            leading={<Download size={16} aria-hidden />}
            onClick={() => {
              downloadBlob(result.blob, result.name)
              markDelivered()
            }}
          >
            {t('common.download')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-small tabular-nums text-text-2">
            <span>
              {t('common.before')}：{sourceLabel(item.probe?.format, item.name)} · {item.probe?.width ?? '?'}×
              {item.probe?.height ?? '?'} · {formatBytes(item.size)}
            </span>
            <span>
              {t('common.after')}：{OUTPUT_LABEL[result.format]} · {result.width}×{result.height} · {formatBytes(result.size)}
            </span>
            <SavingsBadge pct={pct} />
          </div>
          <SegmentedControl<Zoom>
            size="sm"
            label={t('convert.compare.zoom')}
            value={zoom}
            onChange={setZoom}
            options={[
              { value: 'fit', label: t('convert.compare.fit') },
              { value: '1', label: '100%' },
              { value: '2', label: '200%' },
            ]}
          />
        </div>
        <div
          ref={box}
          className={cn(
            'relative max-h-[62dvh] overflow-auto rounded-lg border border-border bg-surface-2',
            zoom !== 'fit' && 'cv-pixelated',
          )}
        >
          <div className="mx-auto" style={{ width: w, height: h }}>
            <CompareSlider
              className="size-full rounded-none"
              before={img(beforeUrl, t('convert.compare.before', { format: sourceLabel(item.probe?.format, item.name) }))}
              after={img(result.url, t('convert.compare.after', { format: FORMATS[result.format].ext.toUpperCase() }))}
              beforeLabel={t('common.before')}
              afterLabel={t('common.after')}
            />
          </div>
        </div>
        <p className="text-caption text-text-3">{t('convert.compare.hint')}</p>
      </div>
    </Dialog>
  )
}
