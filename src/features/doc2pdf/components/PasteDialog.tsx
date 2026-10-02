import { useId, useState } from 'react'
import { Button, Dialog, SegmentedControl } from '@/components/ui'
import { useT } from '@/i18n'
import { looksLikeMarkdown } from '../store'

/** 貼上文字：Markdown 或純文字（自動判斷，可手動切換） */
export function PasteDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onAdd: (text: string, kind: 'md' | 'txt') => void
}) {
  const t = useT()
  const id = useId()
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'md' | 'txt' | null>(null)
  const detected: 'md' | 'txt' = looksLikeMarkdown(text) ? 'md' : 'txt'
  const current = kind ?? detected
  const close = (o: boolean) => {
    onOpenChange(o)
    if (!o) {
      setText('')
      setKind(null)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('doc2pdf.paste.title')}
      description={t('doc2pdf.paste.desc')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() => {
              onAdd(text, current)
              close(false)
            }}
          >
            {t('doc2pdf.paste.add')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label htmlFor={`${id}-text`} className="sr-only">
          {t('doc2pdf.paste.title')}
        </label>
        <textarea
          id={`${id}-text`}
          className="field min-h-[240px] font-mono text-small"
          value={text}
          autoFocus
          spellCheck={false}
          placeholder={t('doc2pdf.paste.placeholder')}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl<'md' | 'txt'>
            size="sm"
            label={t('doc2pdf.paste.format')}
            value={current}
            onChange={setKind}
            options={[
              { value: 'md', label: t('doc2pdf.paste.markdown') },
              { value: 'txt', label: t('doc2pdf.paste.plain') },
            ]}
          />
          {text.trim() && kind === null && (
            <span className="text-caption text-text-3" aria-live="polite">
              {t('doc2pdf.paste.detected', { format: detected === 'md' ? 'Markdown' : t('doc2pdf.paste.plain') })}
            </span>
          )}
        </div>
      </div>
    </Dialog>
  )
}
