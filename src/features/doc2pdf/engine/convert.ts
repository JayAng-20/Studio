/**
 * 轉檔主流程（純函式，Worker 與測試共用）：文件模型 → 排版 → PDF。
 */
import fontkit from '@pdf-lib/fontkit'
import { composeDocuments, type Composed } from './compose'
import { createMeasurer, type GlyphSource } from './fonts'
import { formatDate, PDF_LABELS } from './labels'
import type { DocModel } from './model'
import { renderPdf } from './render'
import { THEMES } from './themes'
import { padGlyphs } from './fontfix'

export * from './options'
import { docLang, docTitle, pageSetup, type ConvertOptions } from './options'

export interface Fonts {
  regular: Uint8Array
  bold: Uint8Array
}

export interface ConvertResult {
  bytes: Uint8Array
  pages: number
  /** 以 □ 代替的字數 */
  missing: number
  title: string
  tocPages: number
  composed: Composed
}

type FontkitFont = GlyphSource

let fontCache: {
  key: Fonts
  fixed: Fonts
  regular: FontkitFont
  bold: FontkitFont
} | null = null

/** 解析字型（並修正子集化問題）；同一組字型只做一次 */
function parseFonts(f: Fonts) {
  if (fontCache && fontCache.key.regular === f.regular && fontCache.key.bold === f.bold)
    return fontCache
  const fixed = { regular: padGlyphs(f.regular), bold: padGlyphs(f.bold) }
  fontCache = {
    key: f,
    fixed,
    regular: fontkit.create(fixed.regular) as unknown as FontkitFont,
    bold: fontkit.create(fixed.bold) as unknown as FontkitFont,
  }
  return fontCache
}

export async function convertDocs(
  docs: DocModel[],
  fonts: Fonts,
  opts: ConvertOptions,
  progress?: (p: number, stage: 'layout' | 'render') => void,
  signal?: AbortSignal,
): Promise<ConvertResult> {
  const parsed = parseFonts(fonts)
  const measurer = createMeasurer(parsed.regular, parsed.bold)
  const lang = docLang(docs)
  const L = PDF_LABELS[lang]
  const page = pageSetup(opts)
  const title = docTitle(docs, opts.title)
  const composed = composeDocuments(
    docs,
    measurer,
    {
      page,
      baseSize: opts.baseSize,
      lineHeight: opts.lineHeight,
      theme: THEMES[opts.theme],
      labels: L,
      title,
      header: opts.header,
      footer: opts.footer,
      cover: {
        enabled: opts.cover,
        date:
          opts.cover && opts.coverDate ? formatDate(new Date(opts.date || Date.now()), lang) : null,
        files: docs.length > 1 ? docs.map((d) => d.name) : [],
      },
      toc: {
        enabled: opts.toc,
        position: opts.tocPosition,
        maxLevel: opts.tocLevel,
        exclude: opts.exclude,
        title: L.toc,
      },
      bookmarks: opts.bookmarks,
    },
    (p) => progress?.(p, 'layout'),
  )
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const bytes = await renderPdf(composed, {
    width: page.width,
    height: page.height,
    fonts: parsed.fixed,
    meta: { title, lang: lang === 'zh' ? 'zh-TW' : 'en' },
    signal,
    onProgress: (p) => progress?.(p, 'render'),
  })
  return {
    bytes,
    pages: composed.pages.length,
    missing: composed.missing,
    title,
    tocPages: composed.tocPages,
    composed,
  }
}
