import { motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { moduleById, type ModuleId } from '@/config/modules'
import { moduleGlyphs } from '@/design/ModuleGlyphs'
import { cn } from '@/lib/cn'
import { spring } from '@/design/motion'

export type TileSize = 'sm' | 'md' | 'lg' | 'xl'
const px: Record<TileSize, number> = { sm: 28, md: 40, lg: 56, xl: 72 }

interface IconTileProps {
  module: ModuleId
  size?: TileSize
  className?: string
  /** shared element 轉場用 */
  layoutId?: string
  /** 字形微動畫的 class（首頁卡片 hover 時使用） */
  glyphClassName?: string
  label?: string
}

/** 模組圖示方塊：135° 漸層、頂部白色高光、白色字形、同色柔和陰影；圓角＝邊長 × 22.5% */
export function IconTile({
  module,
  size = 'md',
  className,
  layoutId,
  glyphClassName,
  label,
}: IconTileProps) {
  const m = moduleById[module]
  const s = px[size]
  const Glyph = moduleGlyphs[module]
  const style = {
    width: s,
    height: s,
    borderRadius: s * 0.225,
    '--tile-1': m.m1,
    '--tile-2': m.m2,
  } as CSSProperties
  return (
    <motion.span
      layoutId={layoutId}
      transition={spring.smooth}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'icon-tile relative inline-grid shrink-0 place-items-center text-white',
        className,
      )}
      style={style}
    >
      <Glyph
        size={Math.round(s * 0.5)}
        strokeWidth={2}
        className={cn('relative z-[1]', glyphClassName)}
      />
    </motion.span>
  )
}
