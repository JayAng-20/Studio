import { Check, CircleDashed, SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { ModulePage, StageContainer } from '@/components/layout/ModulePage'
import { Badge, DropTarget, Skeleton, Spinner } from '@/components/ui'
import { useIncomingFiles } from '@/stores/fileBus'
import { useT } from '@/i18n'
import { isToolId, toolById, type ToolId } from './tools'
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

/** 文字轉 PDF 由 doc2pdf 模組實作，使用時才載入 */
const TextToPdfTool = lazy(() =>
  import('@/features/doc2pdf/TextToPdfTool').then((m) => ({ default: m.TextToPdfTool })),
)

const VIEWS: Record<Exclude<ToolId, 'text2pdf'>, () => React.JSX.Element> = {
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
}

export default function Page() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tool')
  const tool: ToolId | null = isToolId(raw) ? raw : null
  const go = useCallback((id: ToolId | null) => setParams(id ? { tool: id } : {}), [setParams])

  /** 交給「文字轉 PDF」的檔案（seq 遞增讓元件以新的 initialFiles 重新掛載） */
  const [textFiles, setTextFiles] = useState<{ files: File[]; seq: number }>({ files: [], seq: 0 })

  /**
   * 依檔案類型分派：文字檔 → 文字轉 PDF；圖片 → 圖片轉 PDF；
   * 一份 PDF → 目前工具或檢視器；多份 → 合併
   */
  const routeFiles = useCallback(
    (files: File[]) => {
      const texts = files.filter(isTextDoc)
      const pdfs = files.filter(isPdfFile)
      const images = files.filter((f) => !isPdfFile(f) && !isTextDoc(f) && isImageFile(f))
      if (images.length) void addImageFiles(images)
      if (texts.length) {
        setTextFiles((s) => ({ files: texts, seq: s.seq + 1 }))
        go('text2pdf')
        if (pdfs.length) void addPdfFiles(pdfs)
        return
      }
      if (pdfs.length) {
        const cur = tool ? toolById[tool] : null
        const keep =
          cur &&
          cur.input !== 'images' &&
          cur.input !== 'text' &&
          (pdfs.length === 1 || cur.input === 'pdfs')
        if (!keep) go(pdfs.length > 1 ? 'merge' : 'viewer')
        void addPdfFiles(pdfs)
      } else if (images.length && tool !== 'images') {
        go('images')
      }
    },
    [tool, go],
  )

  useIncomingFiles('pdf', (p) => {
    if (!p.files.length) return
    routeFiles(p.files)
  })

  useEffect(() => {
    if (!tool) useStageStore.getState().set('empty')
    // 換工具時回到頁面頂端（外殼只在換路由時重設捲動位置）
    document.getElementById('main-scroll')?.scrollTo({ top: 0 })
  }, [tool])

  const View = tool && tool !== 'text2pdf' ? VIEWS[tool] : null
  return (
    <ModulePage module="pdf" status={tool && tool !== 'text2pdf' ? <StageBadge /> : undefined}>
      {tool && <ToolNav current={tool} onChange={go} />}
      <DropTarget
        onFiles={(f) => {
          if (!f.length) return
          routeFiles(f)
        }}
        accept={`${PDF_ACCEPT},${IMAGE_ACCEPT},${TEXT_ACCEPT}`}
      >
        <StageContainer stage={tool ?? 'home'}>
          {tool === 'text2pdf' ? (
            <Suspense fallback={<Skeleton className="h-[320px] rounded-lg" />}>
              <TextToPdfTool key={textFiles.seq} initialFiles={textFiles.files} />
            </Suspense>
          ) : View ? (
            <View />
          ) : (
            <ToolHome onFiles={routeFiles} onPick={go} />
          )}
        </StageContainer>
      </DropTarget>
      <PasswordDialog />
    </ModulePage>
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
