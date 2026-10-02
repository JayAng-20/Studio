/**
 * 圖片工具（#/tools）：單一工作台，裁切縮放、壓縮、EXIF 與 GPS、調整濾鏡、浮水印、遮蔽、取色、拼貼。
 * 工作區「空 → 已載入」在同一個容器內以 layout 動畫切換。
 */
import { Badge, DropZone } from '@/components/ui'
import { ModulePage, StageContainer } from '@/components/layout/ModulePage'
import { EmptyIllustration } from '@/design/illustrations'
import { useIncomingFiles } from '@/stores/fileBus'
import { fileKind } from '@/lib/files'
import { useT } from '@/i18n'
import { useTools } from './store'
import { ACCEPT } from './constants'
import { Workbench } from './Workbench'
import './tools.css'

export default function Page() {
  const t = useT()
  const count = useTools((s) => s.docs.length)
  const addFiles = useTools((s) => s.addFiles)

  // 來自播放器截圖、圖片互轉、PDF 轉圖片、首頁拖放
  useIncomingFiles('tools', (p) => addFiles(p.files.filter((f) => fileKind(f) === 'image')))

  return (
    <ModulePage
      module="tools"
      wide
      status={
        count > 0 ? (
          <Badge tone="accent">
            {count === 1 ? t('tools.imageCountOne') : t('tools.imageCount', { count })}
          </Badge>
        ) : undefined
      }
    >
      <StageContainer stage={count ? 'work' : 'empty'}>
        {count ? (
          <Workbench />
        ) : (
          <DropZone
            onFiles={addFiles}
            accept={ACCEPT}
            title={t('tools.dropTitle')}
            formats={t('tools.formats')}
            illustration={<EmptyIllustration module="tools" />}
          >
            <p className="mt-5 max-w-md text-small text-text-2">{t('tools.sample.hint')}</p>
          </DropZone>
        )}
      </StageContainer>
    </ModulePage>
  )
}
