import { Check, CircleDashed, SlidersHorizontal } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import { Suspense, lazy, useCallback, useEffect, type ComponentType } from 'react'
import { ModulePage, StageContainer } from '@/components/layout/ModulePage'
import { Badge, DropTarget, Skeleton, Spinner, toast } from '@/components/ui'
import { moduleById } from '@/config/modules'
import { useFileBus, useIncomingFiles } from '@/stores/fileBus'
import { useT } from '@/i18n'
import { isToolId, toolById, type PdfScope, type ToolId } from './tools'
import { addPdfFiles, isPdfFile } from './store'
import { addImageFiles, isImageFile } from './imageStore'
import { ToolHome, ToolNav } from './components/ToolChrome'
import { PasswordDialog } from './components/PasswordDialog'
import {
  IMAGE_ACCEPT,
  PDF_ACCEPT,
  TEXT_ACCEPT,
  isTextDoc,
  useStageStore,
  type Stage,
} from './components/Shared'
import { PdfScopeContext } from './scope'
import { ViewerTool } from './tools/ViewerTool'
import { MergeTool } from './tools/MergeTool'
import { SplitTool } from './tools/SplitTool'
import { OrganizeTool } from './tools/OrganizeTool'
import { ImagesTool } from './tools/ImagesTool'
import { ToImagesTool } from './tools/ToImagesTool'
import { StampTool } from './tools/StampTool'
import { TextTool } from './tools/TextTool'
import { MetaTool } from './tools/MetaTool'
import { CompressTool } from './tools/CompressTool'
import { FormTool } from './tools/FormTool'
import { AnnotateTool } from './tools/AnnotateTool'
import { UnlockTool } from './tools/UnlockTool'
import './pdf.css'

/** 新增的工具在使用時才載入，不加重 PDF 模組首次開啟的大小 */
const later = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))

const VIEWS: Record<ToolId, ComponentType> = {
  viewer: ViewerTool,
  merge: MergeTool,
  split: SplitTool,
  organize: OrganizeTool,
  images: ImagesTool,
  toImages: ToImagesTool,
  stamp: StampTool,
  text: TextTool,
  meta: MetaTool,
  compress: CompressTool,
  form: FormTool,
  annotate: AnnotateTool,
  unlock: UnlockTool,
  compare: later(() => import('./tools/CompareTool'), 'CompareTool'),
  crop: later(() => import('./tools/CropTool'), 'CropTool'),
  resize: later(() => import('./tools/ResizeTool'), 'ResizeTool'),
  layout: later(() => import('./tools/LayoutTool'), 'LayoutTool'),
  headerFooter: later(() => import('./tools/HeaderFooterTool'), 'HeaderFooterTool'),
  redact: later(() => import('./tools/RedactTool'), 'RedactTool'),
  bookmarks: later(() => import('./tools/BookmarksTool'), 'BookmarksTool'),
  attachments: later(() => import('./tools/AttachmentsTool'), 'AttachmentsTool'),
  protect: later(() => import('./tools/ProtectTool'), 'ProtectTool'),
  sanitize: later(() => import('./tools/SanitizeTool'), 'SanitizeTool'),
  optimize: later(() => import('./tools/OptimizeTool'), 'OptimizeTool'),
  toWord: later(() => import('./tools/ToWordTool'), 'ToWordTool'),
  extractImages: later(() => import('./tools/ExtractImagesTool'), 'ExtractImagesTool'),
  ocr: later(() => import('./tools/OcrTool'), 'OcrTool'),
}

/** PDF 編輯器（#/pdf） */
export default function Page() {
  return <PdfModule scope="pdf" />
}

export function PdfModule({ scope }: { scope: PdfScope }) {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const send = useFileBus((s) => s.send)
  const t = useT()
  const raw = params.get('tool')
  const parsed: ToolId | null = isToolId(raw) ? raw : null
  // 另一個模組的工具：換到正確的網址
  const tool = parsed && toolById[parsed].scope === scope ? parsed : null
  useEffect(() => {
    if (parsed && toolById[parsed].scope !== scope)
      nav(`/${toolById[parsed].scope}?tool=${parsed}`, { replace: true })
  }, [parsed, scope, nav])
  const go = useCallback(
    (id: ToolId | null) => {
      if (id && toolById[id].scope !== scope) nav(`/${toolById[id].scope}?tool=${id}`)
      else setParams(id ? { tool: id } : {})
    },
    [setParams, scope, nav],
  )

  /**
   * 依檔案類型分派：文字檔 → 文字轉 PDF 模組；圖片 → 圖片轉 PDF；
   * 一份 PDF → 目前工具（或預設工具）；多份 → 合併
   */
  const routeFiles = useCallback(
    (files: File[]) => {
      const texts = files.filter(isTextDoc)
      const pdfs = files.filter(isPdfFile)
      const images = files.filter((f) => !isPdfFile(f) && !isTextDoc(f) && isImageFile(f))
      if (texts.length) {
        send('doc2pdf', scope, texts)
        toast.success(t('common.sentTo', { target: t(moduleById.doc2pdf.nameKey) }))
        if (pdfs.length) void addPdfFiles(pdfs)
        nav(moduleById.doc2pdf.path)
        return
      }
      if (pdfs.length) {
        const cur = tool ? toolById[tool] : null
        const keep = cur && cur.input !== 'images' && (pdfs.length === 1 || cur.input === 'pdfs')
        if (!keep) {
          if (scope === 'pdf') go(pdfs.length > 1 ? 'merge' : 'viewer')
          else go('toImages')
        }
        void addPdfFiles(pdfs)
      }
      if (images.length) {
        void addImageFiles(images)
        if (!pdfs.length && tool !== 'images') go('images')
      }
    },
    [tool, go, scope, send, nav, t],
  )

  useIncomingFiles(scope, (p) => {
    if (!p.files.length) return
    routeFiles(p.files)
  })

  useEffect(() => {
    if (!tool) useStageStore.getState().set('empty')
    // 換工具時回到頁面頂端（外殼只在換路由時重設捲動位置）
    document.getElementById('main-scroll')?.scrollTo({ top: 0 })
  }, [tool])

  const View = tool ? VIEWS[tool] : null
  return (
    <PdfScopeContext.Provider value={scope}>
      <ModulePage module={scope} status={tool ? <StageBadge /> : undefined}>
        {tool && <ToolNav scope={scope} current={tool} onChange={go} />}
        <DropTarget
          onFiles={(f) => {
            if (!f.length) return
            routeFiles(f)
          }}
          accept={`${PDF_ACCEPT},${IMAGE_ACCEPT},${TEXT_ACCEPT}`}
        >
          <StageContainer stage={tool ?? 'home'}>
            {View ? (
              <Suspense fallback={<Skeleton className="h-[320px] rounded-lg" />}>
                <div data-tour="tool-workspace">
                  <View />
                </div>
              </Suspense>
            ) : (
              <ToolHome scope={scope} onFiles={routeFiles} onPick={go} />
            )}
          </StageContainer>
        </DropTarget>
        <PasswordDialog />
      </ModulePage>
    </PdfScopeContext.Provider>
  )
}

/** 頁首的狀態標籤：讓使用者知道自己在哪一步 */
function StageBadge() {
  const t = useT()
  const stage = useStageStore((s) => s.stage)
  const map: Record<Stage, { tone: 'neutral' | 'accent' | 'success'; icon: React.ReactNode }> = {
    empty: { tone: 'neutral', icon: <CircleDashed size={12} aria-hidden /> },
    ready: { tone: 'accent', icon: <SlidersHorizontal size={12} aria-hidden /> },
    working: { tone: 'accent', icon: <Spinner size={12} /> },
    done: { tone: 'success', icon: <Check size={12} aria-hidden /> },
  }
  return (
    <Badge tone={map[stage].tone} icon={map[stage].icon}>
      {t(`pdf.stage.${stage}`)}
    </Badge>
  )
}
