import { createContext, useContext } from 'react'
import type { PdfScope } from './tools'

/** 目前所在的 PDF 模組（編輯器或轉換）：任務中心歸屬、工具切換時判斷要不要換頁 */
export const PdfScopeContext = createContext<PdfScope>('pdf')
export const usePdfScope = () => useContext(PdfScopeContext)
