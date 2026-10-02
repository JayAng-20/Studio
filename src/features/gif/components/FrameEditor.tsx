import { Copy, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Dialog, NumberField, Skeleton, SortableList, toast } from '@/components/ui'
import { formatTime } from '@/lib/format'
import { uid } from '@/lib/files'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { useGT } from '../useGT'
import { useGifStore, type Source } from '../store'
import { VideoGrabber } from '../source'
import { MIN_DELAY_CS, totalDuration } from '../timeline'
import type { PlanItem } from '../settings'

/** 影片模式：依來源時間產生縮圖（同一時間只產生一次），關閉時取消並釋放 */
function useFrameThumbs(source: Source | null, items: PlanItem[], open: boolean) {
  const [thumbs, setThumbs] = useState<Map<number, string>>(() => new Map())
  const video = source?.kind === 'video' ? source : null
  const times = Array.from(new Set(items.map((i) => i.src))).sort((a, b) => a - b)
  const key = video && open ? `${video.url}|${times.join(',')}` : ''
  useEffect(() => {
    if (!video || !key) return
    const ac = new AbortController()
    const urls: string[] = []
    const grabber = new VideoGrabber(video.url, video.duration)
    const h = 160
    const w = Math.max(1, Math.round((h * video.width) / video.height))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    const list = key.split('|')[1].split(',').map(Number)
    ;(async () => {
      for (const t of list) {
        if (ac.signal.aborted) return
        try {
          const v = await grabber.seek(t, ac.signal)
          ctx?.drawImage(v, 0, 0, w, h)
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.7))
          if (!blob || ac.signal.aborted) return
          const url = URL.createObjectURL(blob)
          urls.push(url)
          setThumbs((m) => new Map(m).set(t, url))
        } catch (e) {
          if ((e as Error)?.name !== 'AbortError') console.error(e)
          return
        }
      }
    })()
    return () => {
      ac.abort()
      grabber.dispose()
      canvas.width = 0
      urls.forEach((u) => URL.revokeObjectURL(u))
      setThumbs(new Map())
    }
  }, [video, key])
  return thumbs
}

/** 影格編輯器：刪除、複製、重排、單格延遲 */
export function FrameEditor({
  open,
  onOpenChange,
  plan,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  plan: PlanItem[]
}) {
  const t = useGT()
  const tc = useT()
  const source = useGifStore((s) => s.source)
  const setCustomPlan = useGifStore((s) => s.setCustomPlan)
  const [items, setItems] = useState<PlanItem[]>(plan)
  const [prevOpen, setPrevOpen] = useState(open)
  const [allDelay, setAllDelay] = useState(100)
  // 每次開啟時以目前計畫為起點
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setItems(plan.map((p) => ({ ...p })))
      setAllDelay(plan[0] ? plan[0].delayCs * 10 : 100)
    }
  }
  const thumbs = useFrameThumbs(source, plan, open)
  const imageUrl = (src: number) => (source?.kind === 'images' ? source.items[src]?.url : undefined)
  const total = totalDuration(items.map((i) => i.delayCs))

  const apply = () => {
    if (!items.length) {
      toast.error(t('errors.noFrames'), { description: t('errors.noFramesDesc') })
      return
    }
    setCustomPlan(items)
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('frames.editorTitle')}
      description={t('frames.editorDesc')}
      footer={
        <>
          <span className="mr-auto text-small tabular-nums text-text-2">
            {t('frames.summary', { count: items.length, duration: formatTime(total, { tenths: true }) })}
          </span>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tc('common.cancel')}
          </Button>
          <Button variant="primary" onClick={apply} disabled={!items.length}>
            {t('frames.apply')}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <NumberField
          label={t('frames.setAllDelay')}
          value={allDelay}
          min={MIN_DELAY_CS * 10}
          max={10000}
          step={10}
          suffix="ms"
          size="sm"
          className="w-40"
          onChange={setAllDelay}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            setItems((list) => list.map((i) => ({ ...i, delayCs: Math.max(MIN_DELAY_CS, Math.round(allDelay / 10)) })))
          }
        >
          {tc('common.applyAll')}
        </Button>
      </div>
      <SortableList
        items={items}
        getId={(i) => i.id}
        onReorder={setItems}
        layout="grid"
        label={t('frames.editorTitle')}
        className="grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
        render={(item, index, handle) => {
          const url = source?.kind === 'video' ? thumbs.get(item.src) : imageUrl(item.src)
          return (
            <div className="card flex h-full flex-col overflow-hidden">
              <div className={cn('relative aspect-video bg-surface-2', source?.kind === 'images' && 'gif-checker')}>
                {url ? (
                  <img src={url} alt="" className="absolute inset-0 size-full object-contain" draggable={false} />
                ) : (
                  <Skeleton className="absolute inset-0 rounded-none" />
                )}
                <span className="absolute left-1.5 top-1.5 rounded-xs bg-black/60 px-1.5 text-caption tabular-nums text-white">
                  {index + 1}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 p-2">
                <div className="flex items-center justify-between gap-1">
                  {handle}
                  <span className="sr-only">{t('frames.frameN', { index: index + 1 })}</span>
                  <div className="flex">
                    <Button
                      variant="ghost"
                      icon
                      size="sm"
                      aria-label={`${t('frames.duplicate')}（${index + 1}）`}
                      onClick={() =>
                        setItems((list) => {
                          const next = [...list]
                          next.splice(index + 1, 0, { ...item, id: uid('f') })
                          return next
                        })
                      }
                    >
                      <Copy size={15} aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      icon
                      size="sm"
                      aria-label={`${t('frames.remove')}（${index + 1}）`}
                      onClick={() => setItems((list) => list.filter((x) => x.id !== item.id))}
                    >
                      <Trash2 size={15} aria-hidden />
                    </Button>
                  </div>
                </div>
                <NumberField
                  label={`${t('frames.delay')}（${index + 1}）`}
                  hideLabel
                  value={item.delayCs * 10}
                  min={MIN_DELAY_CS * 10}
                  max={10000}
                  step={10}
                  suffix="ms"
                  size="sm"
                  onChange={(v) =>
                    setItems((list) =>
                      list.map((x) => (x.id === item.id ? { ...x, delayCs: Math.max(MIN_DELAY_CS, Math.round(v / 10)) } : x)),
                    )
                  }
                />
              </div>
            </div>
          )
        }}
      />
    </Dialog>
  )
}
