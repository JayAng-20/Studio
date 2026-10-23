import { Send } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from './Button'
import { Menu } from './Menu'
import { IconTile } from './IconTile'
import { moduleById, type ModuleId } from '@/config/modules'
import { useFileBus, type BusMeta } from '@/stores/fileBus'
import { useT } from '@/i18n'
import { toast } from './Toast'

/** 結果卡上的「傳送到…」：以記憶體把檔案交給其他模組並跳轉 */
export function SendToMenu({
  from,
  targets,
  getFiles,
  meta,
  size = 'md',
  variant = 'secondary',
}: {
  from: ModuleId
  targets: ModuleId[]
  getFiles: () => File[] | Promise<File[]>
  meta?: BusMeta
  size?: 'sm' | 'md'
  variant?: 'secondary' | 'ghost'
}) {
  const t = useT()
  const nav = useNavigate()
  const send = useFileBus((s) => s.send)
  return (
    <Menu
      label={t('common.sendTo')}
      trigger={
        <Button variant={variant} size={size} leading={<Send size={16} aria-hidden />}>
          {t('common.sendTo')}
        </Button>
      }
      items={targets.map((id) => ({
        key: id,
        icon: <IconTile module={id} size="sm" />,
        label: t(moduleById[id].nameKey),
        onSelect: async () => {
          const files = await getFiles()
          if (!files.length) return
          send(id, from, files, meta)
          toast.success(t('common.sentTo', { target: t(moduleById[id].nameKey) }))
          nav(moduleById[id].path)
        },
      }))}
    />
  )
}
