import { motion } from 'motion/react'
import {
  Database,
  Download,
  ExternalLink,
  Info,
  Keyboard,
  Palette,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { app } from '@/config/app'
import thirdParty from '@/config/thirdParty.json'
import { Logo } from '@/design/Logo'
import { Button, ConfirmDialog, SegmentedControl, SliderField, toast, Field } from '@/components/ui'
import { useSettings, type MotionPref, type ThemePref } from '@/stores/settings'
import { useRecents } from '@/stores/recents'
import { useUi } from '@/stores/ui'
import {
  clearRecordings,
  removeKey,
  resetAllData,
  STORAGE_KEYS,
  storageEstimate,
} from '@/lib/storage'
import { formatBytes } from '@/lib/format'
import { spring, staggerDelay } from '@/design/motion'
import { applyDocumentAttrs, switchTheme } from '../theme'
import { useInstallPrompt } from '../pwa'
import { useT } from '@/i18n'

export default function Settings() {
  const t = useT()
  const s = useSettings()
  const clearRecents = useRecents((x) => x.clear)
  const setUi = useUi((x) => x.set)
  const [confirmReset, setConfirmReset] = useState(false)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const install = useInstallPrompt()
  const refreshUsage = () => storageEstimate().then(setUsage)
  useEffect(() => {
    refreshUsage()
  }, [])

  const sections: Array<{ id: string; icon: ReactNode; title: string; body: ReactNode }> = [
    {
      id: 'appearance',
      icon: <Palette size={18} aria-hidden />,
      title: t('settings.appearance'),
      body: (
        <div className="flex flex-col gap-5">
          <Row label={t('settings.theme')}>
            <SegmentedControl<ThemePref>
              label={t('settings.theme')}
              value={s.theme}
              onChange={(v) => switchTheme(v)}
              options={[
                { value: 'auto', label: t('settings.themeAuto') },
                { value: 'light', label: t('settings.themeLight') },
                { value: 'dark', label: t('settings.themeDark') },
              ]}
            />
          </Row>
          <Row label={t('settings.motion')} hint={t('settings.motionHint')}>
            <SegmentedControl<MotionPref>
              label={t('settings.motion')}
              value={s.motion}
              onChange={(v) => {
                s.set({ motion: v })
                applyDocumentAttrs()
              }}
              options={[
                { value: 'full', label: t('settings.motionFull') },
                { value: 'lite', label: t('settings.motionLite') },
                { value: 'off', label: t('settings.motionOff') },
              ]}
            />
          </Row>
          <Row label={t('settings.language')}>
            <SegmentedControl
              label={t('settings.language')}
              value={s.lang}
              onChange={(v) => s.set({ lang: v })}
              options={[
                { value: 'zh-TW', label: t('lang.zh') },
                { value: 'en', label: t('lang.en') },
              ]}
            />
          </Row>
        </div>
      ),
    },
    {
      id: 'defaults',
      icon: <SlidersHorizontal size={18} aria-hidden />,
      title: t('settings.defaults'),
      body: (
        <div className="flex flex-col gap-5">
          <SliderField
            label={t('settings.imageQuality')}
            hint={t('settings.imageQualityHint')}
            value={s.imageQuality}
            min={1}
            max={100}
            onChange={(v) => s.set({ imageQuality: v })}
          />
          <Field
            label={t('settings.filenamePattern')}
            htmlFor="fn-pattern"
            hint={t('settings.filenamePatternHint')}
          >
            <input
              id="fn-pattern"
              className="field font-mono text-small"
              value={s.filenamePattern}
              onChange={(e) => s.set({ filenamePattern: e.target.value })}
              onBlur={(e) =>
                !e.target.value.trim() && s.set({ filenamePattern: '{name}_{action}' })
              }
            />
          </Field>
        </div>
      ),
    },
    {
      id: 'data',
      icon: <Database size={18} aria-hidden />,
      title: t('settings.data'),
      body: (
        <div className="flex flex-col gap-4">
          <p className="text-small text-text-2">
            {t('settings.dataDesc')}
            {usage &&
              ` ${t('settings.storageUsage', { used: formatBytes(usage.used), quota: formatBytes(usage.quota) })}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                clearRecents()
                toast.success(t('settings.clearRecentsDone'))
              }}
            >
              {t('settings.clearRecents')}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                await clearRecordings()
                refreshUsage()
                toast.success(t('settings.clearRecordingsDone'))
              }}
            >
              {t('settings.clearRecordings')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                removeKey(STORAGE_KEYS.progress)
                toast.success(t('settings.clearProgressDone'))
              }}
            >
              {t('settings.clearProgress')}
            </Button>
            <Button
              variant="danger"
              leading={<Trash2 size={16} aria-hidden />}
              onClick={() => setConfirmReset(true)}
            >
              {t('settings.resetAll')}
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: 'about',
      icon: <Info size={18} aria-hidden />,
      title: t('settings.about'),
      body: (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <Logo size={48} hoverSpin />
            <div>
              <p className="text-h3 font-semibold">{app.name}</p>
              <p className="text-small text-text-3">
                {t('settings.version')} {app.version} ·{' '}
                {t('home.footer.license', { license: app.license })}
              </p>
            </div>
          </div>
          {install.available && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-2 p-4">
              <div>
                <p className="font-semibold">{t('settings.install')}</p>
                <p className="text-small text-text-2">{t('settings.installDesc')}</p>
              </div>
              <Button
                variant="primary"
                leading={<Download size={16} aria-hidden />}
                onClick={install.prompt}
              >
                {t('settings.installButton')}
              </Button>
            </div>
          )}
          <div>
            <h3 className="text-h3 font-semibold">{t('settings.privacyTitle')}</h3>
            <p className="mt-1 text-body text-text-2">{t('settings.privacyBody')}</p>
            <h4 className="mt-4 text-small font-semibold text-text-2">
              {t('settings.storedTitle')}
            </h4>
            <ul className="mt-1.5 list-disc pl-5 text-body text-text-2 marker:text-text-3">
              <li>{t('settings.stored.settings')}</li>
              <li>{t('settings.stored.recents')}</li>
              <li>{t('settings.stored.recordings')}</li>
              <li>{t('settings.stored.progress')}</li>
              <li>{t('settings.stored.qrHistory')}</li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              leading={<Keyboard size={16} aria-hidden />}
              onClick={() => setUi({ shortcutsOpen: true })}
            >
              {t('settings.openShortcuts')}
            </Button>
            <Button asChild variant="secondary">
              <a href={app.github} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={16} aria-hidden />
                {t('settings.sourceCode')}
              </a>
            </Button>
          </div>
          <details className="group rounded-md border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-4 py-3 font-semibold">
              {t('settings.thirdParty')}
              <span className="text-small font-normal text-text-3">{thirdParty.length}</span>
            </summary>
            <div className="border-t border-border px-4 py-3">
              <p className="mb-2 text-small text-text-2">{t('settings.thirdPartyDesc')}</p>
              <ul className="grid gap-x-6 gap-y-1 text-small sm:grid-cols-2">
                {thirdParty.map((p) => (
                  <li
                    key={p.name}
                    className="flex justify-between gap-3 border-b border-border py-1.5"
                  >
                    <span className="truncate font-mono text-[12px]">{p.name}</span>
                    <span className="shrink-0 text-text-3">{p.license}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      ),
    },
  ]

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-28 pt-6 sm:px-6 sm:pb-16 lg:pt-8">
      <header className="mb-6">
        <h1 className="text-h1 font-semibold tracking-[-0.01em]">{t('settings.title')}</h1>
        <p className="mt-0.5 text-body text-text-2">{t('settings.desc')}</p>
      </header>
      <div className="flex flex-col gap-4">
        {sections.map((sec, i) => (
          <motion.section
            key={sec.id}
            aria-labelledby={`set-${sec.id}`}
            className="card p-5 sm:p-6"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.gentle, delay: staggerDelay(i) }}
          >
            <h2 id={`set-${sec.id}`} className="mb-5 flex items-center gap-2 text-h2 font-semibold">
              <span className="text-accent-ink">{sec.icon}</span>
              {sec.title}
            </h2>
            {sec.body}
          </motion.section>
        ))}
      </div>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('settings.resetAllConfirmTitle')}
        description={t('settings.resetAllConfirmDesc')}
        confirmLabel={t('settings.resetAll')}
        danger
        onConfirm={async () => {
          await resetAllData()
          useSettings.getState().reset()
          clearRecents()
          applyDocumentAttrs()
          refreshUsage()
          toast.success(t('settings.resetAllDone'))
        }}
      />
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-body font-medium">{label}</p>
        {hint && <p className="mt-0.5 max-w-sm text-small text-text-3">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
