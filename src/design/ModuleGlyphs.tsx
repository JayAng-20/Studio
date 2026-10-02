import { Play, CircleDot, Crop, QrCode, FileText, type LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import type { ModuleId } from '@/config/moduleIds'

type GlyphProps = { size?: number; strokeWidth?: number; className?: string }

/** GIF：影格框裡放「GIF」字樣 */
function GifGlyph({ size = 24, strokeWidth = 2, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="4.5"
        width="19"
        height="15"
        rx="3"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      <path
        d="M2.5 8h19M2.5 16h19"
        stroke="currentColor"
        strokeWidth={strokeWidth * 0.6}
        opacity=".55"
      />
      <text
        x="12"
        y="13.9"
        textAnchor="middle"
        fontSize="6.4"
        fontWeight="800"
        fontFamily="Inter Variable, system-ui, sans-serif"
        fill="currentColor"
        letterSpacing=".2"
      >
        GIF
      </text>
    </svg>
  )
}

/** 圖片互轉：圖片框上疊雙向箭頭 */
function ConvertGlyph({ size = 24, strokeWidth = 2, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="13" height="11" rx="2.5" />
      <circle cx="7.5" cy="7" r="1.3" />
      <path d="m3.5 13 3.5-3.5 3 3" />
      <path d="M13 17.5h8m0 0-2.5-2.5M21 17.5 18.5 20" />
      <path d="M21 13.5" />
    </svg>
  )
}

const lucide = (Icon: ComponentType<LucideProps>) =>
  function Glyph({ size = 24, strokeWidth = 2, className }: GlyphProps) {
    return <Icon size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />
  }

export const moduleGlyphs: Record<ModuleId, ComponentType<GlyphProps>> = {
  player: lucide(Play),
  recorder: lucide(CircleDot),
  gif: GifGlyph,
  convert: ConvertGlyph,
  tools: lucide(Crop),
  qr: lucide(QrCode),
  pdf: lucide(FileText),
}
