/** 把使用者提供的檔名淨化成安全的下載檔名 */
export function sanitizeFilename(name: string, fallback = 'file'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 180)
  if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned)) return fallback
  return cleaned
}

/** 拆出主檔名與副檔名（副檔名不含點，全小寫） */
export function splitExt(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return { base: name, ext: '' }
  return { base: name.slice(0, i), ext: name.slice(i + 1).toLowerCase() }
}

export function replaceExt(name: string, ext: string): string {
  const { base } = splitExt(name)
  return ext ? `${base}.${ext}` : base
}

/**
 * 檔名去重：同名時加流水號，例如 "a.png" → "a (2).png"。
 * 回傳的函式會記住已用過的名稱（大小寫不敏感）。
 */
export function createDeduper(existing: Iterable<string> = []) {
  const used = new Set<string>()
  for (const n of existing) used.add(n.toLowerCase())
  return (name: string): string => {
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase())
      return name
    }
    const { base, ext } = splitExt(name)
    const stem = base.replace(/ \(\d+\)$/, '')
    for (let i = 2; ; i++) {
      const candidate = `${stem} (${i})${ext ? `.${ext}` : ''}`
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase())
        return candidate
      }
    }
  }
}

export function dedupeNames(names: string[]): string[] {
  const d = createDeduper()
  return names.map(d)
}

export interface TemplateVars {
  name: string
  action?: string
  w?: number
  h?: number
  index?: number
  [k: string]: string | number | undefined
}

/**
 * 命名模板：{name}_{action}、{name}_{w}x{h}、{index}。
 * 未提供的變數會連同其前方的分隔符一起移除，避免出現 "photo_"。
 */
export function applyTemplate(template: string, vars: TemplateVars, ext?: string): string {
  let out = template.replace(/([_\-\s.]?)\{(\w+)\}/g, (_m, sep: string, key: string) => {
    const v = vars[key]
    if (v === undefined || v === '') return ''
    return `${sep}${v}`
  })
  out = sanitizeFilename(out.trim() || vars.name)
  return ext ? `${out}.${ext}` : out
}

/** 預設輸出檔名：原檔名_處理名.ext */
export function outputName(
  original: string,
  action: string,
  ext: string,
  template = '{name}_{action}',
  extra: Partial<TemplateVars> = {},
): string {
  const { base } = splitExt(original)
  return applyTemplate(template, { name: sanitizeFilename(base), action, ...extra }, ext)
}
