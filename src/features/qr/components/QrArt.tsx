import { createElement, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import { cssEasing, duration } from '@/design/motion'
import type { Geometry } from '../lib/geometry'
import { buildSvgTree, reactAttr, svgParts, type SvgNode } from '../lib/svg'
import type { QrStyle } from '../lib/style'

/** SvgNode → React 元素（不使用 innerHTML） */
function toReact(node: SvgNode, key?: number): ReactNode {
  const props: Record<string, unknown> = { key }
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'xmlns') continue
    props[reactAttr(k)] = v
  }
  return createElement(node.tag, props, node.children?.map((c, i) => toReact(c, i)))
}

/** 漣漪動畫：模組由中心向外依序浮現；總長＝擴散 slow＋單點 fast（≤ 600 ms） */
const SPREAD = duration.slow
const DOT = duration.fast
export const RIPPLE_TOTAL = SPREAD + DOT
/** 超過這個數量改用「圈」為單位，避免上千個元素同時動畫 */
const DOT_LIMIT = 2500
const RINGS = 10

interface QrArtProps {
  geo: Geometry
  style: QrStyle
  idPrefix: string
  ripple?: boolean
  onRippleEnd?: () => void
  label?: string
  className?: string
}

/** QR 預覽：靜態時與匯出的 SVG 完全相同；ripple 時逐點浮現 */
export function QrArt({ geo, style, idPrefix, ripple, onRippleEnd, label, className }: QrArtProps) {
  const tree = useMemo(() => buildSvgTree(geo, style, { idPrefix }), [geo, style, idPrefix])

  useEffect(() => {
    if (!ripple || !onRippleEnd) return
    const id = setTimeout(onRippleEnd, RIPPLE_TOTAL + duration.instant)
    return () => clearTimeout(id)
  }, [ripple, onRippleEnd])

  const rootProps = {
    viewBox: `0 0 ${geo.total} ${geo.total}`,
    width: '100%',
    height: '100%',
    role: label ? 'img' : undefined,
    'aria-label': label,
    'aria-hidden': label ? undefined : true,
    className,
    shapeRendering: style.shape === 'square' && !ripple ? 'crispEdges' : 'geometricPrecision',
  }

  if (!ripple) {
    return createElement('svg', rootProps, tree.children?.map((c, i) => toReact(c, i)))
  }

  const parts = svgParts(geo, style, idPrefix)
  const vars = {
    '--qr-dur': `${DOT}ms`,
    '--qr-ease': cssEasing('emphasized'),
  } as CSSProperties
  const delay = (dist: number) => ({ animationDelay: `${Math.round(dist * SPREAD)}ms` })

  let body: ReactNode
  if (geo.dots.length <= DOT_LIMIT) {
    body = geo.dots.map((d, i) => (
      <path key={i} className="qr-dot" d={d.d} fill={parts.moduleFill} style={delay(d.dist)} />
    ))
  } else {
    const rings: string[] = Array.from({ length: RINGS }, () => '')
    for (const d of geo.dots) rings[Math.min(RINGS - 1, Math.floor(d.dist * RINGS))] += d.d
    body = rings.map((d, i) =>
      d ? (
        <path key={i} className="qr-ring" d={d} fill={parts.moduleFill} style={delay(i / RINGS)} />
      ) : null,
    )
  }

  return (
    <svg {...rootProps} style={vars}>
      {parts.defs.length > 0 && <defs>{parts.defs.map((n, i) => toReact(n, i))}</defs>}
      {parts.background && toReact(parts.background)}
      {body}
      {geo.eyes.map((e, i) => (
        <g key={`eye-${i}`} className="qr-dot" style={delay(e.dist)}>
          <path d={e.frame} fill={parts.eyeFill} fillRule="evenodd" />
          <path d={e.ball} fill={parts.eyeFill} />
        </g>
      ))}
      {parts.logo.length > 0 && (
        <g className="qr-dot" style={delay(0)}>
          {parts.logo.map((n, i) => toReact(n, i))}
        </g>
      )}
    </svg>
  )
}
