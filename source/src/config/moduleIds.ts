export const MODULE_IDS = [
  'player',
  'recorder',
  'gif',
  'convert',
  'tools',
  'stitch',
  'qr',
  'pdf',
  'pdfconvert',
  'doc2pdf',
] as const
export type ModuleId = (typeof MODULE_IDS)[number]
export type ModuleGroup = 'media' | 'image' | 'pdf' | 'docs'

export const isModuleId = (v: unknown): v is ModuleId =>
  typeof v === 'string' && (MODULE_IDS as readonly string[]).includes(v)
