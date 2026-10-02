export const MODULE_IDS = ['player', 'recorder', 'gif', 'convert', 'tools', 'qr', 'pdf'] as const
export type ModuleId = (typeof MODULE_IDS)[number]
export type ModuleGroup = 'media' | 'image' | 'docs'

export const isModuleId = (v: unknown): v is ModuleId =>
  typeof v === 'string' && (MODULE_IDS as readonly string[]).includes(v)
