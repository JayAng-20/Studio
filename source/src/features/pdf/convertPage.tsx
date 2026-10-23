import { PdfModule } from './index'

/** PDF 轉換（#/pdfconvert）：與 PDF 編輯器共用檔案匣，只顯示轉換類工具 */
export default function PdfConvertPage() {
  return <PdfModule scope="pdfconvert" />
}
