/**
 * PDF 表單：讀出欄位（類型、目前值、選項、所在頁與位置），寫回使用者填的值。
 * - 一般儲存：設定欄位值；值只含西歐字元時由 pdf-lib 產生外觀，含中文等字元時改設
 *   NeedAppearances，交給閱讀軟體依值重繪（pdf-lib 內建字型無法顯示中文）。
 * - 鎖定（扁平化）：把每個欄位的值用 Canvas 繪成圖片蓋在欄位位置，再移除欄位，
 *   所以中文也能正確鎖定，且之後無法再修改。
 */
import type { PDFDocument, PDFField, PDFForm } from 'pdf-lib'
import { loadForEdit, pageGeometry, type EncodedImage } from './ops'
import { placementToDraw, rectToVisual, type Size } from './placement'

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'other'

export interface FormFieldInfo {
  name: string
  kind: FieldKind
  /** 文字值、勾選狀態（'true'／''）、選取的選項（多選以換行分隔） */
  value: string
  options: string[]
  multiline: boolean
  maxLength?: number
  readOnly: boolean
  /** 第一個外觀（widget）所在頁（0 起算）與視覺座標矩形（pt） */
  page: number
  rect: { x: number; y: number; w: number; h: number } | null
}

const lib = () => import('pdf-lib')

/** 欄位類型（不依賴 constructor.name，避免壓縮後失效） */
async function kindOf(f: PDFField): Promise<FieldKind> {
  const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } = await lib()
  if (f instanceof PDFTextField) return 'text'
  if (f instanceof PDFCheckBox) return 'checkbox'
  if (f instanceof PDFRadioGroup) return 'radio'
  if (f instanceof PDFDropdown) return 'dropdown'
  if (f instanceof PDFOptionList) return 'list'
  return 'other'
}

/** 找出欄位第一個 widget 所在的頁與矩形 */
function locate(doc: PDFDocument, f: PDFField): { page: number; rect: FormFieldInfo['rect'] } {
  const widgets = f.acroField.getWidgets()
  const pages = doc.getPages()
  for (const w of widgets) {
    const ref = doc.context.getObjectRef(w.dict)
    const pRef = w.P()
    let idx = pRef ? pages.findIndex((p) => p.ref === pRef) : -1
    if (idx < 0 && ref) {
      idx = pages.findIndex((p) => {
        const annots = p.node.Annots()
        if (!annots) return false
        for (let i = 0; i < annots.size(); i++) if (annots.get(i) === ref) return true
        return false
      })
    }
    if (idx >= 0) {
      const r = w.getRectangle()
      return { page: idx, rect: rectToVisual(pageGeometry(pages[idx]), r) }
    }
  }
  return { page: 0, rect: null }
}

export async function readForm(bytes: Uint8Array): Promise<FormFieldInfo[]> {
  const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } = await lib()
  const doc = await loadForEdit(bytes)
  let form: PDFForm
  try {
    form = doc.getForm()
  } catch {
    return []
  }
  const out: FormFieldInfo[] = []
  for (const f of form.getFields()) {
    const kind = await kindOf(f)
    let value = ''
    let options: string[] = []
    let multiline = false
    let maxLength: number | undefined
    try {
      if (f instanceof PDFTextField) {
        value = f.getText() ?? ''
        multiline = f.isMultiline()
        maxLength = f.getMaxLength()
      } else if (f instanceof PDFCheckBox) value = f.isChecked() ? 'true' : ''
      else if (f instanceof PDFRadioGroup) {
        options = f.getOptions()
        value = f.getSelected() ?? ''
      } else if (f instanceof PDFDropdown) {
        options = f.getOptions()
        value = f.getSelected()[0] ?? ''
      } else if (f instanceof PDFOptionList) {
        options = f.getOptions()
        value = f.getSelected().join('\n')
      }
    } catch (e) {
      console.error(e)
    }
    out.push({
      name: f.getName(),
      kind,
      value,
      options,
      multiline,
      maxLength,
      readOnly: f.isReadOnly(),
      ...locate(doc, f),
    })
  }
  return out
}

/** 是否只含 pdf-lib 標準字型（WinAnsi）能編碼的字元 */
export const isLatin = (s: string) => {
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c > 0xff && !(c >= 0x2013 && c <= 0x2026) && c !== 0x20ac) return false
  }
  return true
}

export interface FillOptions {
  flatten: boolean
  /** 把文字繪成圖片（扁平化用） */
  renderText: (text: string, sizePt: number) => Promise<{ image: EncodedImage; size: Size } | null>
}

/** 寫回欄位值；回傳新的 PDF 位元組 */
export async function fillForm(
  bytes: Uint8Array,
  values: Record<string, string>,
  opts: FillOptions,
): Promise<Uint8Array> {
  const {
    PDFTextField,
    PDFCheckBox,
    PDFRadioGroup,
    PDFDropdown,
    PDFOptionList,
    PDFName,
    PDFBool,
    degrees,
  } = await lib()
  const doc = await loadForEdit(bytes)
  const form = doc.getForm()
  const pages = doc.getPages()
  let needAppearances = false
  const display: Array<{ field: PDFField; text: string }> = []
  for (const f of form.getFields()) {
    const name = f.getName()
    const v = values[name]
    if (f instanceof PDFTextField) {
      const text = v ?? f.getText() ?? ''
      if (v !== undefined) {
        const max = f.getMaxLength()
        f.setText(max !== undefined ? text.slice(0, max) : text)
      }
      if (!isLatin(text)) needAppearances = true
      display.push({ field: f, text })
    } else if (f instanceof PDFCheckBox) {
      const on = v !== undefined ? v === 'true' : f.isChecked()
      if (on) f.check()
      else f.uncheck()
      display.push({ field: f, text: on ? '✓' : '' })
    } else if (f instanceof PDFRadioGroup) {
      const sel = v ?? f.getSelected() ?? ''
      if (sel && f.getOptions().includes(sel)) f.select(sel)
      else if (v === '') f.clear()
      display.push({ field: f, text: '' })
    } else if (f instanceof PDFDropdown) {
      const sel = v ?? f.getSelected()[0] ?? ''
      if (sel) f.select(sel)
      else f.clear()
      if (!isLatin(sel)) needAppearances = true
      display.push({ field: f, text: sel })
    } else if (f instanceof PDFOptionList) {
      const sel = (v ?? f.getSelected().join('\n')).split('\n').filter(Boolean)
      if (sel.length) f.select(sel)
      else f.clear()
      if (!sel.every(isLatin)) needAppearances = true
      display.push({ field: f, text: sel.join(', ') })
    }
  }

  if (!opts.flatten) {
    if (needAppearances) {
      form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True)
      return doc.save({ useObjectStreams: true, updateFieldAppearances: false })
    }
    return doc.save({ useObjectStreams: true })
  }

  // 扁平化：選項類（單選、勾選）用 pdf-lib 的外觀；文字類用 Canvas 圖片，支援中文
  for (const { field, text } of display) {
    const isText =
      field instanceof PDFTextField ||
      field instanceof PDFDropdown ||
      field instanceof PDFOptionList
    const isCheck = field instanceof PDFCheckBox
    for (const w of field.acroField.getWidgets()) {
      if (!(isText || isCheck) || !text) continue
      const pRef = w.P()
      let pageIdx = pRef ? pages.findIndex((p) => p.ref === pRef) : -1
      if (pageIdx < 0) {
        const ref = doc.context.getObjectRef(w.dict)
        pageIdx = pages.findIndex((p) => {
          const annots = p.node.Annots()
          if (!annots) return false
          for (let i = 0; i < annots.size(); i++) if (annots.get(i) === ref) return true
          return false
        })
      }
      if (pageIdx < 0) continue
      const page = pages[pageIdx]
      const geo = pageGeometry(page)
      const box = rectToVisual(geo, w.getRectangle())
      const multiline = field instanceof PDFTextField && field.isMultiline()
      const lines = multiline ? text.split('\n').length : 1
      const sizePt = Math.max(6, Math.min(14, (box.h * 0.72) / Math.max(1, lines)))
      const stamp = await opts.renderText(isCheck ? '✓' : text, isCheck ? box.h * 0.8 : sizePt)
      if (!stamp) continue
      const img =
        stamp.image.type === 'png'
          ? await doc.embedPng(stamp.image.bytes)
          : await doc.embedJpg(stamp.image.bytes)
      // 縮到欄位內：文字靠左、垂直置中（勾選置中）
      const k = Math.min(1, (box.w - 4) / stamp.size.w, (box.h - 2) / stamp.size.h)
      const size = { w: stamp.size.w * k, h: stamp.size.h * k }
      const cx = isCheck ? box.x + box.w / 2 : box.x + 2 + size.w / 2
      const cy = multiline ? box.y + 2 + size.h / 2 : box.y + box.h / 2
      const d = placementToDraw(geo, { cx, cy, angle: 0 }, size)
      page.drawImage(img, {
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        rotate: degrees(d.rotate),
      })
    }
  }
  // 單選鈕等用 pdf-lib 內建外觀扁平化；文字欄位已畫成圖片，先移除避免重複
  for (const { field } of display) {
    if (field instanceof PDFRadioGroup) continue
    form.removeField(field)
  }
  try {
    form.flatten({ updateFieldAppearances: true })
  } catch (e) {
    console.error(e)
    form.flatten({ updateFieldAppearances: false })
  }
  return doc.save({ useObjectStreams: true })
}
