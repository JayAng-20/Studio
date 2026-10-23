import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Button, Dialog, FileName } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'
import { PASSWORD_INCORRECT } from '../lib/pdfjs'
import { usePdf, type PasswordRequest } from '../store'

/** 有密碼的 PDF：彈出輸入密碼的對話框（密碼錯誤時抖動並提示） */
export function PasswordDialog() {
  const req = usePdf((s) => s.password)
  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => !o && req?.resolve(null)}
      title={<PasswordTitle />}
      size="sm"
    >
      {req && <PasswordForm key={req.seq} req={req} />}
    </Dialog>
  )
}

function PasswordTitle() {
  const t = useT()
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent-ink">
        <KeyRound size={18} aria-hidden />
      </span>
      {t('pdf.password.title')}
    </span>
  )
}

function PasswordForm({ req }: { req: PasswordRequest }) {
  const t = useT()
  const id = useId()
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const wrong = req.reason === PASSWORD_INCORRECT
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!value || req.verifying) return
    req.resolve(value)
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
      <p className="flex min-w-0 flex-wrap items-center gap-1 text-body text-text-2">
        <span>{t('pdf.password.desc')}</span>
        <FileName name={req.name} className="font-medium text-text" />
      </p>
      <div>
        <label htmlFor={id} className="label">
          {t('pdf.password.label')}
        </label>
        <div className={cn('relative', wrong && 'shake')}>
          <input
            id={id}
            type={show ? 'text' : 'password'}
            autoFocus
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? `${id}-err` : undefined}
            className="field pr-11"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? t('pdf.password.hide') : t('pdf.password.show')}
            aria-pressed={show}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-text-3 hover:text-text"
          >
            {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </button>
        </div>
        {wrong && (
          <p id={`${id}-err`} role="alert" className="mt-1.5 text-small text-danger-ink">
            {t('pdf.password.wrong')}
          </p>
        )}
        <p className="mt-1.5 text-caption text-text-3">{t('pdf.password.privacy')}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => req.resolve(null)}>
          {t('pdf.password.skip')}
        </Button>
        <Button variant="primary" type="submit" disabled={!value} loading={req.verifying}>
          {t('pdf.password.unlock')}
        </Button>
      </div>
    </form>
  )
}
