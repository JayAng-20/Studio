import { splitExt } from '@/lib/filename'
import { cn } from '@/lib/cn'

/**
 * 長檔名：中段省略並保留副檔名（IMG_20260930_…_final.heic）。
 * 以 CSS 實作：前段 truncate，尾段（最後 8 字＋副檔名）固定顯示。
 */
export function FileName({ name, className }: { name: string; className?: string }) {
  const { base, ext } = splitExt(name)
  const tailLen = Math.min(8, Math.max(0, base.length - 8))
  const head = base.slice(0, base.length - tailLen)
  const tail = base.slice(base.length - tailLen) + (ext ? `.${ext}` : '')
  return (
    <span className={cn('flex min-w-0 max-w-full', className)} title={name}>
      {/* 視覺上分成兩段；螢幕閱讀器只讀完整檔名 */}
      <span className="sr-only">{name}</span>
      <span aria-hidden className="truncate whitespace-pre">
        {head}
      </span>
      <span aria-hidden className="shrink-0 whitespace-pre">
        {tail}
      </span>
    </span>
  )
}
