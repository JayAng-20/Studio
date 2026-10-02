import { FileCard, FileName, SortableList } from '@/components/ui'
import { useGT } from '../useGT'
import { useGifStore, type ImageItem } from '../store'

/** 圖片模式：可拖曳排序的圖片清單（順序即播放順序） */
export function ImageStrip({ items }: { items: ImageItem[] }) {
  const t = useGT()
  const setImages = useGifStore((s) => s.setImages)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-h3 font-semibold">{t('images.list')}</h3>
        <span className="text-caption text-text-3">{t('images.reorderHint')}</span>
      </div>
      <SortableList
        items={items}
        getId={(i) => i.id}
        onReorder={setImages}
        layout="grid"
        label={t('images.list')}
        className="grid-cols-1 sm:grid-cols-2"
        render={(item, index, handle) => (
          <FileCard
            onRemove={() => setImages(items.filter((x) => x.id !== item.id))}
            removeLabel={`${t('images.remove')}（${item.file.name}）`}
          >
            {handle}
            <span className="gif-checker relative size-12 shrink-0 overflow-hidden rounded-sm ring-1 ring-border">
              <img src={item.url} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <FileName name={item.file.name} className="text-body font-medium text-text" />
              <span className="text-caption tabular-nums text-text-3">
                {t('images.order', { index: index + 1 })} · {item.width}×{item.height}
              </span>
            </div>
          </FileCard>
        )}
      />
    </div>
  )
}
