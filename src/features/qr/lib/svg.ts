/**
 * SVG 節點樹：同一份樹可序列化成字串（匯出）或轉成 React 元素（預覽）。
 * 不使用 innerHTML，使用者內容（Logo data URL）只出現在屬性值，並經過跳脫。
 */
import { gradientCoords, type Geometry } from './geometry'
import type { FillStyle, QrStyle } from './style'

export interface SvgNode {
  tag: string
  attrs: Record<string, string | number>
  children?: SvgNode[]
}

const el = (tag: string, attrs: SvgNode['attrs'], children?: SvgNode[]): SvgNode => ({
  tag,
  attrs,
  children,
})

/** 漸層定義；solid 時回傳 null */
export function fillDef(fill: FillStyle, geo: Geometry, id: string): SvgNode | null {
  if (fill.type === 'solid') return null
  const g = gradientCoords(geo, fill.angle)
  const stops = [
    el('stop', { offset: 0, 'stop-color': fill.color }),
    el('stop', { offset: 1, 'stop-color': fill.color2 }),
  ]
  if (fill.type === 'linear') {
    return el(
      'linearGradient',
      { id, gradientUnits: 'userSpaceOnUse', x1: r3(g.x1), y1: r3(g.y1), x2: r3(g.x2), y2: r3(g.y2) },
      stops,
    )
  }
  return el('radialGradient', { id, gradientUnits: 'userSpaceOnUse', cx: g.cx, cy: g.cy, r: r3(g.r) }, stops)
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface SvgParts {
  defs: SvgNode[]
  background: SvgNode | null
  /** 模組填色（顏色或 url(#id)） */
  moduleFill: string
  eyeFill: string
  logo: SvgNode[]
}

/** 把樣式拆成各部件，讓靜態與動畫預覽共用 */
export function svgParts(geo: Geometry, style: QrStyle, idPrefix: string): SvgParts {
  const gradId = `${idPrefix}-fg`
  const defs: SvgNode[] = []
  const grad = fillDef(style.fg, geo, gradId)
  if (grad) defs.push(grad)
  const moduleFill = grad ? `url(#${gradId})` : style.fg.color
  const eyeFill = style.eyeCustom ? style.eyeColor : moduleFill
  const background = style.bgTransparent
    ? null
    : el('rect', { width: geo.total, height: geo.total, fill: style.bg })
  const logo: SvgNode[] = []
  if (geo.logo && style.logo) {
    const p = geo.logo.plate
    if (p) {
      logo.push(
        el('rect', {
          x: r3(p.x),
          y: r3(p.y),
          width: r3(p.w),
          height: r3(p.h),
          rx: r3(p.r),
          fill: style.bgTransparent ? '#FFFFFF' : style.bg,
        }),
      )
    }
    logo.push(
      el('image', {
        x: r3(geo.logo.x),
        y: r3(geo.logo.y),
        width: r3(geo.logo.w),
        height: r3(geo.logo.h),
        href: style.logo.src,
        preserveAspectRatio: 'xMidYMid meet',
      }),
    )
  }
  return { defs, background, moduleFill, eyeFill, logo }
}

/** 完整的靜態 SVG 樹 */
export function buildSvgTree(
  geo: Geometry,
  style: QrStyle,
  opts: { idPrefix?: string; size?: number } = {},
): SvgNode {
  const p = svgParts(geo, style, opts.idPrefix ?? 'qr')
  const children: SvgNode[] = []
  if (p.defs.length) children.push(el('defs', {}, p.defs))
  if (p.background) children.push(p.background)
  if (geo.modules) children.push(el('path', { d: geo.modules, fill: p.moduleFill }))
  children.push(el('path', { d: geo.eyeFrames, fill: p.eyeFill, 'fill-rule': 'evenodd' }))
  children.push(el('path', { d: geo.eyeBalls, fill: p.eyeFill }))
  children.push(...p.logo)
  const size = opts.size ?? style.size
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${geo.total} ${geo.total}`,
      width: size,
      height: size,
      'shape-rendering': style.shape === 'square' ? 'crispEdges' : 'geometricPrecision',
    },
    children,
  )
}

const escapeAttr = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 序列化成獨立的 SVG 檔案字串；image 同時寫 href 與 xlink:href 相容舊軟體 */
export function serializeSvg(node: SvgNode, root = true): string {
  const attrs = { ...node.attrs }
  if (root && node.tag === 'svg') attrs['xmlns:xlink'] = 'http://www.w3.org/1999/xlink'
  if (node.tag === 'image' && typeof attrs.href === 'string') attrs['xlink:href'] = attrs.href
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('')
  const inner = (node.children ?? []).map((c) => serializeSvg(c, false)).join('')
  const head = root ? '<?xml version="1.0" encoding="UTF-8"?>\n' : ''
  return inner ? `${head}<${node.tag}${a}>${inner}</${node.tag}>` : `${head}<${node.tag}${a}/>`
}

/** 屬性名稱轉成 React 的 camelCase（fill-rule → fillRule） */
export const reactAttr = (k: string) => k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
