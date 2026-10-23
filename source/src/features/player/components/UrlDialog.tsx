import { Link2 } from 'lucide-react'
import { useId, useState } from 'react'
import { Button, Dialog } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { addUrl } from '../actions'

/** P2：HLS（hls.js）或一般影音網址；限同源或有 CORS 的來源 */
export function UrlDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const t = useT()
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const submit = () => {
    const v = value.trim()
    let ok = false
    try {
      const u = new URL(v)
      ok = u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      ok = false
    }
    if (!ok) {
      setError(true)
      return
    }
    addUrl(v)
    setValue('')
    setError(false)
    onOpenChange(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setError(false)
      }}
      title={t('player.url.title')}
      description={t('player.url.desc')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} leading={<Link2 size={16} aria-hidden />}>
            {t('player.url.open')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label htmlFor={id} className="label">
          {t('player.url.label')}
        </label>
        <input
          id={id}
          type="url"
          inputMode="url"
          autoFocus
          className={cn('field', error && 'shake border-danger!')}
          placeholder={t('player.url.placeholder')}
          value={value}
          aria-invalid={error || undefined}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            setValue(e.target.value)
            setError(false)
          }}
        />
        <p
          id={`${id}-hint`}
          className={cn('mt-1.5 text-caption', error ? 'text-danger-ink' : 'text-text-3')}
        >
          {error ? t('player.url.invalid') : t('player.url.privacy')}
        </p>
      </form>
    </Dialog>
  )
}
