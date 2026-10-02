/** PDF 內容裡的固定文字（依文件語言，而不是介面語言） */
export type DocLang = 'zh' | 'en'

export const PDF_LABELS = {
  zh: {
    toc: '目錄',
    imageExternal: '外部網址的圖片不會下載（檔案不離開你的電腦），這裡以替代文字顯示。',
    imageNotFound: '找不到這張圖片。把圖片檔和文字檔一起拖進來，就能嵌入 PDF。',
    imageUnsupported: '這張圖片的格式無法嵌入。',
    imageLabel: '圖片',
  },
  en: {
    toc: 'Contents',
    imageExternal: 'Images from web addresses are not downloaded (your files never leave this device); showing the alt text instead.',
    imageNotFound: 'Image not found. Drop the image file together with the text file to embed it.',
    imageUnsupported: 'This image format can’t be embedded.',
    imageLabel: 'Image',
  },
} as const

export function formatDate(d: Date, lang: DocLang): string {
  if (lang === 'zh') return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
