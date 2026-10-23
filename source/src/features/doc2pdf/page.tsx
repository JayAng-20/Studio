/**
 * 文字轉 PDF（#/doc2pdf）：從「PDF 工具」獨立出來的模組。
 * 其他模組或首頁傳來的文字檔以 seq 遞增重新掛載工作區，帶入新檔案。
 */
import { useState } from 'react'
import { ModulePage } from '@/components/layout/ModulePage'
import { useIncomingFiles } from '@/stores/fileBus'
import { TextToPdfTool } from './TextToPdfTool'

export default function Doc2PdfPage() {
  const [incoming, setIncoming] = useState<{ files: File[]; seq: number }>({ files: [], seq: 0 })
  useIncomingFiles('doc2pdf', (p) => {
    if (p.files.length) setIncoming((s) => ({ files: p.files, seq: s.seq + 1 }))
  })
  return (
    <ModulePage module="doc2pdf">
      <div data-tour="workspace">
        <TextToPdfTool key={incoming.seq} initialFiles={incoming.files} />
      </div>
    </ModulePage>
  )
}
