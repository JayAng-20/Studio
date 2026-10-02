import { Check } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import type { PdfSource } from '../store'
import { PageThumb } from './PageThumb'

export interface GridItemState {
  selected?: boolean
  /** 角落標籤（例如「檔案 2」） */
  badge?: ReactNode
  /** 交錯色調（分組顯示） */
  alt?: boolean
  dim?: boolean
}

/** 頁面縮圖格：點選切換（支援 Shift 範圍選取），懶渲染 */
export function PageGrid({
  source,
  state,
  onItemClick,
  label,
  selectable = true,
}: {
  source: PdfSource
  state: (i: number) => GridItemState
  onItemClick?: (i: number, e: MouseEvent) => void
  label: string
  selectable?: boolean
}) {
  const t = useT()
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(124px,1fr))]"
    >
      {Array.from({ length: source.pageCount }, (_, i) => {
        const st = state(i)
        const size = source.sizes[i] ?? source.sizes[0] ?? { w: 595, h: 842 }
        const inner = (
          <>
            <span
              className={cn(
                'relative grid aspect-square w-full place-items-center rounded-md p-2 transition-colors duration-(--dur-fast)',
                st.selected
                  ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]'
                  : st.alt
                    ? 'bg-[color-mix(in_srgb,var(--text)_7%,transparent)]'
                    : 'bg-surface-2',
              )}
            >
              <span
                className={cn(
                  'relative block overflow-hidden rounded-[3px] shadow-e2 transition-opacity duration-(--dur-fast)',
                  st.dim && 'opacity-40',
                )}
                style={
                  size.w >= size.h
                    ? { width: '100%', aspectRatio: String(size.w / size.h) }
                    : { height: '100%', aspectRatio: String(size.w / size.h) }
                }
              >
                <PageThumb
                  docId={source.id}
                  index={i}
                  aspect={size.w / size.h}
                  renderWidth={120}
                  className="size-full"
                />
              </span>
              {selectable && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full border transition-all duration-(--dur-fast)',
                    st.selected
                      ? 'scale-100 border-transparent bg-accent-strong text-white'
                      : 'scale-90 border-border-strong bg-surface/90 text-transparent',
                  )}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              {st.badge && (
                <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface/95 px-2 text-caption font-medium text-text-2 shadow-e1">
                  {st.badge}
                </span>
              )}
            </span>
            <span
              className={cn(
                'mt-1 block text-center text-caption tabular-nums',
                st.selected ? 'font-semibold text-accent-ink' : 'text-text-3',
              )}
            >
              {i + 1}
            </span>
          </>
        )
        return (
          <li key={i}>
            {onItemClick ? (
              <button
                type="button"
                className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-pressed={selectable ? !!st.selected : undefined}
                aria-label={t('pdf.grid.page', { n: i + 1 })}
                onClick={(e) => onItemClick(i, e)}
              >
                {inner}
              </button>
            ) : (
              <div>{inner}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** 點選頁面切換選取；Shift 點選選取一段範圍 */
export function toggleSelection(
  current: Set<number>,
  i: number,
  e: { shiftKey: boolean },
  last: number | null,
): Set<number> {
  const next = new Set(current)
  if (e.shiftKey && last !== null) {
    const [a, b] = last < i ? [last, i] : [i, last]
    const on = !current.has(i) || current.has(last)
    for (let k = a; k <= b; k++) {
      if (on) next.add(k)
      else next.delete(k)
    }
    return next
  }
  if (next.has(i)) next.delete(i)
  else next.add(i)
  return next
}
