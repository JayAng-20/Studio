import { LayoutGroup, motion } from 'motion/react'
import { LayoutGrid } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { Button, Card, DropZone } from '@/components/ui'
import { EmptyIllustration } from '@/design/illustrations'
import { spring, staggerDelay } from '@/design/motion'
import { cn } from '@/lib/cn'
import { useT, type TKey } from '@/i18n'
import { TOOLS, TOOL_GROUPS, toolDesc, toolName, type ToolId } from '../tools'
import { IMAGE_ACCEPT, PDF_ACCEPT, TEXT_ACCEPT } from './Shared'

/** 工具首頁：拖放區＋依用途分組的工具卡 */
export function ToolHome({
  onFiles,
  onPick,
}: {
  onFiles: (files: File[]) => void
  onPick: (id: ToolId) => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-8">
      <div className="card overflow-hidden p-2">
        <DropZone
          onFiles={onFiles}
          accept={`${PDF_ACCEPT},${IMAGE_ACCEPT},${TEXT_ACCEPT}`}
          formats={t('pdf.home.formats')}
          title={t('pdf.home.dropTitle')}
          illustration={<EmptyIllustration module="pdf" size={124} />}
          compact
          className="min-h-[200px]!"
        >
          <p className="mt-2 max-w-lg text-caption text-text-3">{t('pdf.home.dropHint')}</p>
        </DropZone>
      </div>
      {TOOL_GROUPS.map((g) => (
        <section key={g} aria-labelledby={`pdf-group-${g}`}>
          <h2 id={`pdf-group-${g}`} className="mb-3 text-h3 font-semibold text-text">
            {t(`pdf.groups.${g}` as TKey)}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {TOOLS.filter((x) => x.group === g).map((tool) => {
              const Icon = tool.icon
              const i = TOOLS.indexOf(tool)
              return (
                <motion.li
                  key={tool.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...spring.smooth, delay: staggerDelay(i) }}
                >
                  <Card interactive padded={false} className="h-full">
                    <button
                      type="button"
                      onClick={() => onPick(tool.id)}
                      className="flex h-full w-full items-start gap-3.5 rounded-[inherit] p-4 text-left"
                    >
                      <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-[color-mix(in_srgb,var(--accent)_13%,transparent)] text-accent-ink">
                        <Icon size={21} aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-body font-semibold text-text">
                          {t(toolName(tool.id))}
                        </span>
                        <span className="mt-0.5 block text-small text-text-2">
                          {t(toolDesc(tool.id))}
                        </span>
                      </span>
                    </button>
                  </Card>
                </motion.li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** 工具內的切換列：可橫向捲動，選取指示以 layoutId 滑動 */
export function ToolNav({
  current,
  onChange,
}: {
  current: ToolId
  onChange: (id: ToolId | null) => void
}) {
  const t = useT()
  const id = useId()
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scroller.current
    const el = box?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!box || !el) return
    box.scrollTo({
      left: el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2,
      behavior: 'smooth',
    })
  }, [current])
  return (
    <nav aria-label={t('pdf.nav.label')} className="mb-5 flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        leading={<LayoutGrid size={15} aria-hidden />}
        onClick={() => onChange(null)}
        className="shrink-0"
      >
        <span className="max-sm:sr-only">{t('pdf.nav.all')}</span>
      </Button>
      <div className="relative min-w-0 flex-1">
        <div
          ref={scroller}
          className="hide-scrollbar relative flex gap-1 overflow-x-auto rounded-md bg-[color-mix(in_srgb,var(--text)_5%,transparent)] p-1 [mask-image:linear-gradient(90deg,transparent,#000_12px,#000_calc(100%-24px),transparent)]"
        >
          <LayoutGroup id={id}>
            {TOOLS.map((tool) => {
              const Icon = tool.icon
              const active = tool.id === current
              return (
                <button
                  key={tool.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onChange(tool.id)}
                  className={cn(
                    'relative z-0 inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 text-small font-medium transition-colors duration-(--dur-fast)',
                    active ? 'text-text' : 'text-text-2 hover:text-text',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="pdf-tool-pill"
                      className="absolute inset-0 -z-10 rounded-[inherit] bg-surface shadow-e1 dark:bg-surface-3"
                      transition={spring.snappy}
                    />
                  )}
                  <Icon size={15} aria-hidden className={active ? 'text-accent-ink' : undefined} />
                  {t(toolName(tool.id))}
                </button>
              )
            })}
          </LayoutGroup>
        </div>
      </div>
    </nav>
  )
}
