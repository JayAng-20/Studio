import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AnimatePresence, animate, motion } from 'motion/react'
import { GripVertical, X } from 'lucide-react'
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { duration, sec, spring } from '@/design/motion'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { dropOrigin } from './useFileIntake'

/** 新卡片若在放下檔案後不久出現，從游標位置以彈簧飛入 */
export function useFlyIn<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const motionPref = useSettings((s) => s.motion)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || motionPref !== 'full') return
    if (performance.now() - dropOrigin.t > 700) return
    const r = el.getBoundingClientRect()
    const dx = dropOrigin.x - (r.left + r.width / 2)
    const dy = dropOrigin.y - (r.top + r.height / 2)
    animate(
      el,
      { x: [dx, 0], y: [dy, 0], scale: [0.5, 1], opacity: [0, 1] },
      { ...spring.smooth, opacity: { duration: sec(duration.fast) } },
    )
  }, [motionPref])
  return ref
}

interface SortableListProps<T> {
  items: T[]
  getId: (item: T) => string
  onReorder?: (items: T[]) => void
  render: (item: T, index: number, handle: ReactNode) => ReactNode
  layout?: 'list' | 'grid'
  className?: string
  label?: string
}

/** 可拖曳排序的清單（滑鼠、觸控、鍵盤皆可）；新增／移除用 layout 動畫 */
export function SortableList<T>({
  items,
  getId,
  onReorder,
  render,
  layout = 'list',
  className,
  label,
}: SortableListProps<T>) {
  const t = useT()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = items.map(getId)
  // 拖曳期間與放下後兩格內停用 layout 動畫，避免與 dnd-kit 的位移互相干擾
  const [suppress, setSuppress] = useState(false)
  const release = () => requestAnimationFrame(() => requestAnimationFrame(() => setSuppress(false)))
  const end = (e: DragEndEvent) => {
    release()
    if (!onReorder || !e.over || e.active.id === e.over.id) return
    const from = ids.indexOf(String(e.active.id))
    const to = ids.indexOf(String(e.over.id))
    onReorder(arrayMove(items, from, to))
  }
  return (
    <SuppressCtx.Provider value={suppress}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setSuppress(true)}
        onDragCancel={release}
        onDragEnd={end}
      >
        <SortableContext
          items={ids}
          strategy={layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}
        >
          <ul
            aria-label={label ?? t('a11y.fileList')}
            className={cn(layout === 'grid' ? 'grid gap-3' : 'flex flex-col gap-2', className)}
          >
            <AnimatePresence initial={false}>
              {items.map((item, i) => (
                <SortableItem key={ids[i]} id={ids[i]} disabled={!onReorder}>
                  {(handle) => render(item, i, handle)}
                </SortableItem>
              ))}
            </AnimatePresence>
          </ul>
        </SortableContext>
      </DndContext>
    </SuppressCtx.Provider>
  )
}

const SuppressCtx = createContext(false)

function SortableItem({
  id,
  children,
  disabled,
}: {
  id: string
  children: (handle: ReactNode) => ReactNode
  disabled?: boolean
}) {
  const t = useT()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    setActivatorNodeRef,
  } = useSortable({ id, disabled })
  const fly = useFlyIn<HTMLLIElement>()
  const handle = disabled ? null : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={t('a11y.dragHandle')}
      className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text active:cursor-grabbing"
    >
      <GripVertical size={16} aria-hidden />
    </button>
  )
  const suppress = useContext(SuppressCtx)
  return (
    <motion.li
      ref={fly}
      layout={suppress ? false : 'position'}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: sec(duration.fast) } }}
      transition={spring.smooth}
      className="relative"
      style={{ zIndex: isDragging ? 20 : undefined }}
    >
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        className={cn('h-full', isDragging && 'opacity-90 [&>*]:shadow-e3')}
      >
        {children(handle)}
      </div>
    </motion.li>
  )
}

/** 檔案卡外框 */
export function FileCard({
  children,
  className,
  onRemove,
  removeLabel,
  active,
}: {
  children: ReactNode
  className?: string
  onRemove?: () => void
  removeLabel?: string
  active?: boolean
}) {
  const t = useT()
  return (
    <div
      className={cn(
        'card relative flex items-center gap-3 p-2.5 pr-3',
        active && 'ring-2 ring-accent',
        className,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? t('common.remove')}
          className="grid size-8 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-danger-ink"
        >
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  )
}
