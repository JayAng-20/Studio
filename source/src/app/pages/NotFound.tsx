import { Link } from 'react-router'
import { Button, EmptyState } from '@/components/ui'
import { Logo } from '@/design/Logo'
import { useT } from '@/i18n'

export default function NotFound() {
  const t = useT()
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <EmptyState
        illustration={<Logo size={72} hoverSpin />}
        title={t('errors.notFound')}
        description={t('errors.notFoundDesc')}
        action={
          <Button asChild variant="primary">
            <Link to="/">{t('nav.back')}</Link>
          </Button>
        }
      />
    </div>
  )
}
