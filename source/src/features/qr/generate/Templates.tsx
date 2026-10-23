import { AnimatePresence, motion } from 'motion/react'
import { BookmarkPlus, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { Button, Dialog, Field, toast } from '@/components/ui'
import { spring, staggerDelay } from '@/design/motion'
import { useT } from '@/i18n'
import { buildContent, contentSlug, type ContentType, type ContentValues } from '../lib/content'
import { buildGeometry } from '../lib/geometry'
import { createMatrix, type QrMatrix } from '../lib/matrix'
import { loadTemplates, saveTemplates, TEMPLATES_MAX, type QrTemplate } from '../lib/storage'
import { uid } from '@/lib/files'
import { QrArt } from '../components/QrArt'
import { TYPE_ICONS } from './TypePicker'
import { useQrStore } from '../store'

/** 範本縮圖：用範本自己的內容與樣式畫小 QR */
function TemplateThumb({ tpl }: { tpl: QrTemplate }) {
  const [matrix, setMatrix] = useState<QrMatrix | null>(null)
  const content = buildContent(tpl.type, tpl.values)
  const ecc = tpl.style.logo ? 'H' : tpl.style.ecc
  useEffect(() => {
    if (!content) return
    let alive = true
    createMatrix(content, ecc)
      .then((m) => alive && setMatrix(m))
      .catch(() => alive && setMatrix(null))
    return () => {
      alive = false
    }
  }, [content, ecc])
  const geo = useMemo(
    () => (matrix ? buildGeometry(matrix, { ...tpl.style, margin: 1 }) : null),
    [matrix, tpl.style],
  )
  const Icon = TYPE_ICONS[tpl.type]
  return (
    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-sm border border-border bg-surface-2">
      {geo && content ? (
        <QrArt geo={geo} style={{ ...tpl.style, margin: 1 }} idPrefix={`tpl-${tpl.id}`} />
      ) : (
        <Icon size={18} className="text-text-3" aria-hidden />
      )}
    </span>
  )
}

export function Templates() {
  const t = useT()
  const nameId = useId()
  const [list, setList] = useState<QrTemplate[]>(() => loadTemplates())
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const applyTemplate = useQrStore((s) => s.applyTemplate)

  const openSave = () => {
    if (list.length >= TEMPLATES_MAX) {
      toast.error(t('qr.templates.limit', { max: TEMPLATES_MAX }))
      return
    }
    const s = useQrStore.getState()
    const slug = contentSlug(s.type, s.values[s.type])
    setName([t(`qr.types.${s.type}.label`), slug].filter(Boolean).join('・'))
    setOpen(true)
  }

  const save = () => {
    const s = useQrStore.getState()
    const tpl: QrTemplate = {
      id: uid('tpl'),
      name: name.trim() || t(`qr.types.${s.type}.label`),
      type: s.type,
      values: s.values[s.type] as ContentValues[ContentType],
      style: s.style,
      createdAt: Date.now(),
    }
    const next = [tpl, ...list]
    if (!saveTemplates(next)) {
      toast.error(t('qr.templates.saveFailed'), { description: t('qr.templates.saveFailedDesc') })
      return
    }
    setList(next)
    setOpen(false)
    toast.success(t('qr.templates.saved', { name: tpl.name }))
  }

  const remove = (tpl: QrTemplate) => {
    const before = list
    const next = list.filter((x) => x.id !== tpl.id)
    saveTemplates(next)
    setList(next)
    toast(t('qr.templates.removed'), {
      action: {
        label: t('common.undo'),
        onClick: () => {
          saveTemplates(before)
          setList(before)
        },
      },
    })
  }

  return (
    <section className="card flex flex-col gap-3 p-4" aria-labelledby="qr-tpl-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="qr-tpl-title" className="text-h3 font-semibold">
          {t('qr.templates.title')}
        </h2>
        <Button
          size="sm"
          variant="secondary"
          leading={<BookmarkPlus size={15} aria-hidden />}
          onClick={openSave}
        >
          {t('qr.templates.save')}
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="text-small text-text-3">{t('qr.templates.empty')}</p>
      ) : (
        <ul className="-mx-1 flex flex-col">
          <AnimatePresence initial={false}>
            {list.map((tpl, i) => (
              <motion.li
                key={tpl.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { ...spring.smooth, delay: staggerDelay(i) },
                }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={spring.smooth}
                className="group flex items-center gap-1 rounded-md hover:bg-surface-2"
              >
                <button
                  type="button"
                  onClick={() => {
                    applyTemplate(tpl.type, tpl.values, tpl.style)
                    toast.success(t('qr.templates.applied', { name: tpl.name }))
                  }}
                  aria-label={t('qr.templates.apply', { name: tpl.name })}
                  className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 text-left"
                >
                  <TemplateThumb tpl={tpl} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-text">
                      {tpl.name}
                    </span>
                    <span className="block text-caption text-text-3">
                      {t(`qr.types.${tpl.type}.label`)}
                    </span>
                  </span>
                </button>
                <Button
                  icon
                  size="sm"
                  variant="ghost"
                  aria-label={t('qr.templates.remove', { name: tpl.name })}
                  onClick={() => remove(tpl)}
                  className="max-sm:size-11 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                >
                  <Trash2 size={15} aria-hidden />
                </Button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('qr.templates.saveTitle')}
        description={t('qr.templates.saveDesc')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={save}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Field label={t('qr.templates.name')} htmlFor={nameId}>
            <input
              id={nameId}
              className="field"
              value={name}
              maxLength={60}
              autoFocus
              placeholder={t('qr.templates.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </form>
      </Dialog>
    </section>
  )
}
