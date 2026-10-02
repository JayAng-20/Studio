import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { ModuleGroup, ModuleId } from './moduleIds'
import type { TKey } from '@/i18n'

export type { ModuleId, ModuleGroup } from './moduleIds'
export { MODULE_IDS, isModuleId } from './moduleIds'

export interface ModuleDef {
  id: ModuleId
  group: ModuleGroup
  path: string
  /** 圖示方塊漸層（135°） */
  m1: string
  m2: string
  nameKey: TKey
  descKey: TKey
  tagKeys: TKey[]
  /** 首頁全域拖放：可開啟的檔案類型 */
  opens: Array<'image' | 'pdf' | 'video' | 'audio'>
  load: () => Promise<{ default: ComponentType }>
  Page: LazyExoticComponent<ComponentType>
}

function def(d: Omit<ModuleDef, 'Page' | 'nameKey' | 'descKey' | 'tagKeys'>): ModuleDef {
  return {
    ...d,
    nameKey: `modules.${d.id}.name` as TKey,
    descKey: `modules.${d.id}.desc` as TKey,
    tagKeys: [`modules.${d.id}.tag1` as TKey, `modules.${d.id}.tag2` as TKey],
    Page: lazy(d.load),
  }
}

export const modules: ModuleDef[] = [
  def({
    id: 'player',
    group: 'media',
    path: '/player',
    m1: '#5AA2FF',
    m2: '#2F6BEA',
    opens: ['video', 'audio'],
    load: () => import('@/features/player'),
  }),
  def({
    id: 'recorder',
    group: 'media',
    path: '/recorder',
    m1: '#FF7A7A',
    m2: '#E5484D',
    opens: [],
    load: () => import('@/features/recorder'),
  }),
  def({
    id: 'gif',
    group: 'media',
    path: '/gif',
    m1: '#F07CF5',
    m2: '#C026D3',
    opens: ['video', 'image'],
    load: () => import('@/features/gif'),
  }),
  def({
    id: 'convert',
    group: 'image',
    path: '/convert',
    m1: '#5BE08A',
    m2: '#16A34A',
    opens: ['image'],
    load: () => import('@/features/convert'),
  }),
  def({
    id: 'tools',
    group: 'image',
    path: '/tools',
    m1: '#FF7C95',
    m2: '#E11D48',
    opens: ['image'],
    load: () => import('@/features/tools'),
  }),
  def({
    id: 'qr',
    group: 'image',
    path: '/qr',
    m1: '#5B6B83',
    m2: '#1E293B',
    opens: ['image'],
    load: () => import('@/features/qr'),
  }),
  def({
    id: 'pdf',
    group: 'docs',
    path: '/pdf',
    m1: '#FF8A5B',
    m2: '#D9480F',
    opens: ['pdf', 'image'],
    load: () => import('@/features/pdf'),
  }),
]

export const moduleById = Object.fromEntries(modules.map((m) => [m.id, m])) as Record<
  ModuleId,
  ModuleDef
>

export const groups: Array<{ id: ModuleGroup; labelKey: TKey }> = [
  { id: 'media', labelKey: 'nav.groups.media' },
  { id: 'image', labelKey: 'nav.groups.image' },
  { id: 'docs', labelKey: 'nav.groups.docs' },
]

export function moduleFromPath(pathname: string): ModuleDef | undefined {
  return modules.find((m) => pathname === m.path || pathname.startsWith(`${m.path}/`))
}

const preloaded = new Set<ModuleId>()
/** hover 卡片或閒置時預取模組 chunk */
export function preloadModule(id: ModuleId) {
  if (preloaded.has(id)) return
  preloaded.add(id)
  moduleById[id].load().catch(() => preloaded.delete(id))
}
