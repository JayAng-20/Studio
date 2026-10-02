// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import { fillForm, isLatin, readForm } from '@/features/pdf/lib/form'

const PNG_1x1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)
const renderText = async () => ({
  image: { bytes: PNG_1x1, type: 'png' as const, width: 1, height: 1 },
  size: { w: 40, h: 12 },
})

async function makeForm() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 400])
  const form = doc.getForm()
  form.createTextField('name').addToPage(page, { x: 20, y: 300, width: 200, height: 24 })
  form.createCheckBox('agree').addToPage(page, { x: 20, y: 250, width: 16, height: 16 })
  const dd = form.createDropdown('city')
  dd.addOptions(['Taipei', 'Tainan'])
  dd.addToPage(page, { x: 20, y: 200, width: 120, height: 24 })
  const rg = form.createRadioGroup('size')
  rg.addOptionToPage('S', page, { x: 20, y: 150, width: 14, height: 14 })
  rg.addOptionToPage('L', page, { x: 60, y: 150, width: 14, height: 14 })
  return doc.save()
}

describe('表單', () => {
  it('讀出欄位類型、頁碼與位置', async () => {
    const fields = await readForm(await makeForm())
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
    expect(byName.name.kind).toBe('text')
    expect(byName.agree.kind).toBe('checkbox')
    expect(byName.city.kind).toBe('dropdown')
    expect(byName.city.options).toEqual(['Taipei', 'Tainan'])
    expect(byName.size.kind).toBe('radio')
    expect(byName.name.page).toBe(0)
    // pdf-lib 會把邊框寬度算進矩形
    expect(Math.abs(byName.name.rect!.x - 20)).toBeLessThan(1)
    expect(Math.abs(byName.name.rect!.y - 76)).toBeLessThan(1)
    expect(Math.abs(byName.name.rect!.w - 200)).toBeLessThan(2)
  })
  it('填入英文值後可讀回', async () => {
    const out = await fillForm(
      await makeForm(),
      { name: 'Jay', agree: 'true', city: 'Tainan', size: 'L' },
      { flatten: false, renderText },
    )
    const fields = Object.fromEntries((await readForm(out)).map((f) => [f.name, f.value]))
    expect(fields).toMatchObject({ name: 'Jay', agree: 'true', city: 'Tainan', size: 'L' })
  })
  it('中文值改用 NeedAppearances，不會因字型無法編碼而失敗', async () => {
    const out = await fillForm(await makeForm(), { name: '王小明' }, { flatten: false, renderText })
    const doc = await PDFDocument.load(out)
    expect(doc.getForm().getTextField('name').getText()).toBe('王小明')
    expect(String(doc.getForm().acroForm.dict.lookup(PDFName.of('NeedAppearances')))).toBe('true')
  })
  it('鎖定（扁平化）後沒有欄位，頁數不變', async () => {
    const out = await fillForm(
      await makeForm(),
      { name: '王小明', agree: 'true' },
      { flatten: true, renderText },
    )
    const doc = await PDFDocument.load(out)
    expect(doc.getForm().getFields()).toHaveLength(0)
    expect(doc.getPageCount()).toBe(1)
  })
  it('西歐字元判斷', () => {
    expect(isLatin('Café – 5€')).toBe(true)
    expect(isLatin('台北')).toBe(false)
  })
})
