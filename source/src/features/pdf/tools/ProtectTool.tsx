import { motion } from 'motion/react'
import { Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useId, useState } from 'react'
import { Workspace } from '@/components/layout/ModulePage'
import { Button, Callout, Switch } from '@/components/ui'
import { spring } from '@/design/motion'
import { outputName } from '@/lib/filename'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { useT, type TKey } from '@/i18n'
import { encryptPdf, ALL_PERMISSIONS, type Permissions } from '../lib/encrypt'
import { sourceBytes, type PdfSource } from '../store'
import { useRunner, type Runner } from '../components/useRunner'
import { ToolFrame } from '../components/Frame'
import { PanelFooter, PanelSection, ToolPanel } from '../components/Shared'

const PERM_KEYS: Array<keyof Permissions> = [
  'print',
  'printHigh',
  'copy',
  'modify',
  'annotate',
  'fillForms',
  'assemble',
  'accessibility',
]

/** 密碼強度 0–4（長度、字元種類） */
export function passwordScore(pw: string): number {
  if (!pw) return 0
  let s = 0
  if (pw.length >= 6) s++
  if (pw.length >= 10) s++
  // eslint-disable-next-line no-control-regex
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /[^\x00-\x7f]/].filter((r) => r.test(pw)).length
  if (kinds >= 2) s++
  if (kinds >= 3 && pw.length >= 8) s++
  return Math.min(4, s)
}

export function ProtectTool() {
  const t = useT()
  const runner = useRunner()
  return (
    <ToolFrame
      tool="protect"
      runner={runner}
      workingTitle={t('pdf.protect.working')}
      resetLabel={t('pdf.protect.again')}
      resultSummary={() => t('pdf.protect.summary')}
      workingArt={<LockArt />}
    >
      {(source) => <ProtectEditor key={source.id} source={source} runner={runner} />}
    </ToolFrame>
  )
}

function LockArt() {
  return (
    <motion.div
      className="grid size-20 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent-ink"
      animate={{ rotate: [0, -6, 6, -3, 0], scale: [1, 1.06, 1] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
    >
      <LockKeyhole size={38} aria-hidden />
    </motion.div>
  )
}

function PasswordInput({
  label,
  value,
  onChange,
  hint,
  invalid,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
  invalid?: boolean
}) {
  const t = useT()
  const id = useId()
  const [show, setShow] = useState(false)
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          className={cn('field pr-11', invalid && 'border-danger')}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? t('pdf.password.hide') : t('pdf.password.show')}
          className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text"
        >
          {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
      {hint && (
        <p className={cn('mt-1 text-caption', invalid ? 'text-danger-ink' : 'text-text-3')}>
          {hint}
        </p>
      )}
    </div>
  )
}

function Strength({ score }: { score: number }) {
  const t = useT()
  const colors = ['var(--border-strong)', 'var(--danger)', 'var(--warning)', 'var(--accent)', 'var(--success)']
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <motion.div
              className="h-full rounded-full"
              initial={false}
              animate={{
                width: score >= i ? '100%' : '0%',
                backgroundColor: colors[score],
              }}
              transition={{ ...spring.snappy, delay: (i - 1) * 0.04 }}
            />
          </div>
        ))}
      </div>
      <span className="w-16 text-right text-caption text-text-2">
        {t(`pdf.protect.strength.${score}` as TKey)}
      </span>
    </div>
  )
}

function ProtectEditor({ source, runner }: { source: PdfSource; runner: Runner }) {
  const t = useT()
  const pattern = useSettings((s) => s.filenamePattern)
  const [user, setUser] = useState('')
  const [confirm, setConfirm] = useState('')
  const [owner, setOwner] = useState('')
  const [perms, setPerms] = useState<Permissions>({ ...ALL_PERMISSIONS, modify: false, assemble: false })
  const mismatch = !!confirm && confirm !== user
  const restricted = PERM_KEYS.some((k) => !perms[k])
  const canRun = (!!user && !mismatch && confirm === user) || (!user && restricted)

  const run = () => {
    const name = outputName(source.name, t('pdf.actions.protect'), 'pdf', pattern)
    void runner.start(t('pdf.protect.task', { name: source.name }), async ({ progress, signal }) => {
      const out = await encryptPdf(
        await sourceBytes(source),
        { userPassword: user, ownerPassword: owner, permissions: perms },
        progress,
        signal,
      )
      return { files: [{ blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name }] }
    }, { minDuration: 900 })
  }

  return (
    <Workspace
      main={
        <div className="card flex flex-col gap-5 p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_13%,transparent)] text-accent-ink">
              <KeyRound size={20} aria-hidden />
            </span>
            <div>
              <h3 className="text-h3 font-semibold">{t('pdf.protect.openTitle')}</h3>
              <p className="text-small text-text-2">{t('pdf.protect.openDesc')}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordInput label={t('pdf.protect.user')} value={user} onChange={setUser} />
            <PasswordInput
              label={t('pdf.protect.confirm')}
              value={confirm}
              onChange={setConfirm}
              invalid={mismatch}
              hint={mismatch ? t('pdf.protect.mismatch') : undefined}
            />
          </div>
          <Strength score={passwordScore(user)} />
          <PasswordInput
            label={t('pdf.protect.owner')}
            value={owner}
            onChange={setOwner}
            hint={t('pdf.protect.ownerHint')}
          />
          <Callout tone="neutral" icon={<ShieldCheck size={16} aria-hidden />}>
            {t('pdf.protect.note')}
          </Callout>
        </div>
      }
      panel={
        <ToolPanel title={t('pdf.protect.permissions')}>
          <PanelSection>
            {PERM_KEYS.map((k) => (
              <Switch
                key={k}
                label={t(`pdf.protect.perm.${k}` as TKey)}
                checked={perms[k]}
                disabled={k === 'printHigh' && !perms.print}
                onChange={(v) => setPerms((p) => ({ ...p, [k]: v }))}
              />
            ))}
          </PanelSection>
          <p className="text-caption text-text-3">{t('pdf.protect.permNote')}</p>
          <PanelFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!canRun}
              leading={<LockKeyhole size={18} aria-hidden />}
              onClick={run}
            >
              {t('pdf.protect.run')}
            </Button>
            {!canRun && (
              <p className="text-center text-caption text-text-3">{t('pdf.protect.needPassword')}</p>
            )}
          </PanelFooter>
        </ToolPanel>
      }
    />
  )
}
