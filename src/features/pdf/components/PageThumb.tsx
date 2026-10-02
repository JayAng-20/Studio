import { motion } from 'motion/react'
import { FileWarning } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui'
import { duration, sec } from '@/design/motion'
import { isAbortError } from '@/stores/tasks'
import { cn } from '@/lib/cn'
import { getThumb, peekThumb, thumbKey } from '../lib/pdfjs'
import { getDoc } from '../store'

interface PageThumbProps {
  docId: string
  /** 0 起算 */
  index: number
  /** 頁面寬高比（w / h） */
  aspect: number
  /** 渲染寬度（CSS px；同寬度共用快取） */
  renderWidth?: number
  className?: string
  /** 優先度（目前頁、可見頁較高） */
  priority?: number
  alt?: string
}

/**
 * 頁面縮圖：進入視窗附近才渲染（IntersectionObserver），離開時取消尚未開始的渲染；
 * 渲染結果放在 LRU 快取，捲回來不必重畫。載入前顯示骨架。
 */
export function PageThumb({
  docId,
  index,
  aspect,
  renderWidth = 160,
  className,
  priority = 0,
  alt = '',
}: PageThumbProps) {
  const ref = useRef<HTMLDivElement>(null)
  const key = thumbKey(docId, index, renderWidth)
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const url = loaded?.key === key ? loaded.url : peekThumb(key)

  useEffect(() => {
    if (url) return
    const el = ref.current
    if (!el) return
    let ctrl: AbortController | null = null
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !ctrl) {
          const c = new AbortController()
          ctrl = c
          getDoc(docId)
            .then((doc) => getThumb(docId, doc, index, renderWidth, { signal: c.signal, priority }))
            .then((u) => {
              if (!c.signal.aborted) setLoaded({ key, url: u })
            })
            .catch((e) => {
              if (isAbortError(e) || c.signal.aborted) return
              console.error(e)
              setFailed(key)
            })
        } else if (!entry.isIntersecting && ctrl) {
          ctrl.abort()
          ctrl = null
        }
      },
      { rootMargin: '320px 320px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      ctrl?.abort()
    }
  }, [docId, index, renderWidth, key, url, priority])

  return (
    <div
      ref={ref}
      className={cn('relative overflow-hidden bg-white', className)}
      style={{ aspectRatio: String(aspect) }}
    >
      {url ? (
        <motion.img
          key={url}
          src={url}
          alt={alt}
          draggable={false}
          className="absolute inset-0 size-full select-none object-contain"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: sec(duration.fast) }}
        />
      ) : failed === key ? (
        <div className="absolute inset-0 grid place-items-center bg-surface-2 text-text-3">
          <FileWarning size={20} aria-hidden />
        </div>
      ) : (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
    </div>
  )
}
