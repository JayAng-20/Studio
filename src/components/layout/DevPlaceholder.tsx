import { Link } from 'react-router'
import type { ModuleId } from '@/config/modules'
import { Badge, Button, EmptyState } from '@/components/ui'
import { EmptyIllustration } from '@/design/illustrations'
import { ModulePage } from './ModulePage'
import { useT } from '@/i18n'

/** 開發中骨架頁（只在模組尚未完成時使用） */
export function DevPlaceholder({ module }: { module: ModuleId }) {
  const t = useT()
  return (
    <ModulePage module={module} status={<Badge tone="warning">{t('common.inDevelopment')}</Badge>}>
      <div className="card">
        <EmptyState
          illustration={<EmptyIllustration module={module} />}
          title={t('dev.title')}
          description={t('dev.desc')}
          action={
            <Button asChild variant="secondary">
              <Link to="/">{t('nav.back')}</Link>
            </Button>
          }
        />
      </div>
    </ModulePage>
  )
}
