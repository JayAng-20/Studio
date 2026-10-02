import { FileText, Lock, ShieldAlert, X, TriangleAlert, LockOpen } from 'lucide-react'
import { create } from 'zustand'
import { useEffect, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import {
  AddFilesButton,
  Badge,
  Button,
  Callout,
  DropZone,
  FileName,
  Select,
  Spinner,
  Tooltip,
} from '@/components/ui'
import { EmptyIllustration } from '@/design/illustrations'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useT, type TKey } from '@/i18n'
import { addPdfFiles, usePdf, type PdfSource } from '../store'
import type { ToolDef, ToolId } from '../tools'

/* ---------- 工作階段（顯示在頁首的狀態標籤） ---------- */

export type Stage = 'empty' | 'ready' | 'working' | 'done'

export const useStageStore = create<{ stage: Stage; set: (s: Stage) => void }>((set) => ({
  stage: 'empty',
  set: (stage) => set({ stage }),
}))

/** 工具回報目前的階段 */
export function useStage(stage: Stage) {
  useEffect(() => {
    useStageStore.getState().set(stage)
  }, [stage])
}

/* ---------- 文件匣 ---------- */

export const PDF_ACCEPT = 'application/pdf,.pdf'
/** 文字轉 PDF（由 doc2pdf 模組提供）接受的格式 */
export const TEXT_ACCEPT =
  '.md,.markdown,.txt,.rtf,text/plain,text/markdown,text/rtf,application/rtf'
export const isTextDoc = (f: File) => /\.(md|markdown|txt|rtf)$/i.test(f.name)

export const IMAGE_ACCEPT = 'image/*,.heic,.heif,.avif,.webp,.jpg,.jpeg,.png,.gif,.bmp,.svg'

/** 目前選取的 PDF（沒有選取時取第一個） */
export function useActiveSource(): PdfSource | undefined {
  return usePdf((s) => s.sources.find((x) => x.id === s.activeId) ?? s.sources[0])
}

/** 切換工具（保留在同一頁，用網址參數記錄，返回鍵可用） */
export function useGoTool() {
  const [, setParams] = useSearchParams()
  return (tool: ToolId | null) => setParams(tool ? { tool } : {})
}

/** 單一 PDF 工具還沒有檔案時的拖放區 */
export function PdfDrop({ title, multiple = false }: { title?: string; multiple?: boolean }) {
  const t = useT()
  return (
    <div className="card overflow-hidden p-2">
      <DropZone
        onFiles={(files) => void addPdfFiles(files)}
        accept={PDF_ACCEPT}
        multiple={multiple}
        formats="PDF"
        title={title ?? t('pdf.drop.pdfTitle')}
        illustration={<EmptyIllustration module="pdf" />}
        className="border-0 shadow-none"
      />
    </div>
  )
}

/** 目前檔案列：檔名、頁數、大小、加密標示；多個檔案時可切換 */
export function SourceBar({ source, actions }: { source: PdfSource; actions?: ReactNode }) {
  const t = useT()
  const sources = usePdf((s) => s.sources)
  const setActive = usePdf((s) => s.setActive)
  const remove = usePdf((s) => s.remove)
  return (
    <div className="card flex flex-wrap items-center gap-3 p-2.5 pr-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
        {source.status === 'loading' ? <Spinner size={18} /> : <FileText size={20} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1 basis-40">
        {sources.length > 1 ? (
          <Select
            label={t('pdf.source.switch')}
            hideLabel
            size="sm"
            value={source.id}
            onChange={setActive}
            options={sources.map((s) => ({ value: s.id, label: s.name }))}
            className="max-w-[420px]"
          />
        ) : (
          <FileName name={source.name} className="text-body font-medium text-text" />
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-text-3">
          {source.status === 'loading' ? (
            <span>{t('pdf.source.opening')}</span>
          ) : (
            <span className="tabular-nums">
              {t('pdf.source.meta', { pages: source.pageCount, size: formatBytes(source.size) })}
            </span>
          )}
          {source.encrypted && (
            <Badge tone="warning" className="h-5 px-2" icon={<Lock size={11} aria-hidden />}>
              {t('pdf.source.encrypted')}
            </Badge>
          )}
          {source.hasForm && (
            <Badge tone="neutral" className="h-5 px-2">
              {t('pdf.source.form')}
            </Badge>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {actions}
        <AddFilesButton
          onFiles={(f) => void addPdfFiles(f)}
          accept={PDF_ACCEPT}
          size="sm"
          variant="ghost"
          label={t('pdf.source.add')}
        />
        <Tooltip content={t('pdf.source.remove')}>
          <Button
            icon
            size="sm"
            variant="ghost"
            aria-label={t('pdf.source.remove')}
            onClick={() => remove(source.id)}
          >
            <X size={16} aria-hidden />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

/** 這個工具能不能處理這份檔案（加密檔不能用 pdf-lib 改寫） */
export const editBlocked = (src: PdfSource | undefined, tool: ToolDef) =>
  !!src && tool.needsEdit && src.encrypted

/**
 * 依檔案狀態顯示明確提示：加密（無法修改）、表單欄位可能失效、數位簽章會失效、XFA 表單。
 */
export function SourceNotices({ source, tool }: { source: PdfSource; tool: ToolDef }) {
  const t = useT()
  const go = useGoTool()
  const notes: Array<{
    key: string
    tone: 'danger' | 'warning'
    title: TKey
    desc: TKey
    action?: ReactNode
  }> = []
  if (source.status !== 'ready') return null
  if (tool.needsEdit && source.encrypted) {
    notes.push({
      key: 'enc',
      tone: 'danger',
      title: 'pdf.notice.encryptedTitle',
      desc: 'pdf.notice.encryptedDesc',
      action: (
        <Button
          size="sm"
          variant="secondary"
          leading={<LockOpen size={14} aria-hidden />}
          onClick={() => go('unlock')}
        >
          {t('pdf.notice.unlockAction')}
        </Button>
      ),
    })
  }
  if (tool.structural && source.hasForm && !source.encrypted)
    notes.push({
      key: 'form',
      tone: 'warning',
      title: 'pdf.notice.formTitle',
      desc: 'pdf.notice.formDesc',
    })
  if (tool.needsEdit && source.hasSignatures && !source.encrypted)
    notes.push({
      key: 'sig',
      tone: 'warning',
      title: 'pdf.notice.sigTitle',
      desc: 'pdf.notice.sigDesc',
    })
  if (source.hasXfa)
    notes.push({
      key: 'xfa',
      tone: 'warning',
      title: 'pdf.notice.xfaTitle',
      desc: 'pdf.notice.xfaDesc',
    })
  if (!notes.length) return null
  return (
    <div className="flex flex-col gap-2">
      {notes.map((n) => (
        <Callout
          key={n.key}
          tone={n.tone}
          icon={n.tone === 'danger' ? <ShieldAlert size={16} /> : <TriangleAlert size={16} />}
          title={t(n.title)}
          action={n.action}
          className="items-center"
        >
          {t(n.desc)}
        </Callout>
      ))}
    </div>
  )
}

/** 右側面板中的區塊 */
export function PanelSection({
  title,
  children,
  className,
}: {
  title?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {title && <h4 className="text-small font-semibold text-text">{title}</h4>}
      {children}
    </div>
  )
}

/** 進度文字（aria-live 回報） */
export function LiveStatus({ text }: { text: string }) {
  return (
    <p className="sr-only" aria-live="polite">
      {text}
    </p>
  )
}

/**
 * 右側面板：內容過長時在面板內捲動（桌機版面板是 sticky，太長會看不到底部按鈕），
 * 主要動作放在 PanelFooter 並固定在面板底部。
 */
export function ToolPanel({
  title,
  children,
  className,
}: {
  title?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'card flex flex-col overflow-hidden lg:max-h-[calc(100dvh-var(--topbar-h)-32px)]',
        className,
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {title && <h3 className="text-h3 font-semibold">{title}</h3>}
        {children}
      </div>
    </section>
  )
}

/** 面板底部的主要動作：在面板內捲動時固定於底部 */
export function PanelFooter({ children }: { children: ReactNode }) {
  return (
    <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-auto flex flex-col gap-2 border-t border-border bg-surface p-4">
      {children}
    </div>
  )
}
