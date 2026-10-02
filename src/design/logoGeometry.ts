/** 風車 Logo 幾何：中央方塊＋四片順時針咬合的葉片（viewBox 0 0 64 64） */
export const LOGO_CENTER = { x: 22, y: 22, w: 20, h: 20, r: 5 }

export const LOGO_BLADES = [
  // 上：綠，向左延伸
  { key: 'top', x: 8, y: 8, w: 34, h: 12, r: 4, from: '#4ADE80', to: '#22C55E', dx: 0, dy: -28 },
  // 右：橘，向上延伸
  { key: 'right', x: 44, y: 8, w: 12, h: 34, r: 4, from: '#FB923C', to: '#F97316', dx: 28, dy: 0 },
  // 下：洋紅，向右延伸
  {
    key: 'bottom',
    x: 22,
    y: 44,
    w: 34,
    h: 12,
    r: 4,
    from: '#E879F9',
    to: '#D946EF',
    dx: 0,
    dy: 28,
  },
  // 左：深石板，向下延伸
  { key: 'left', x: 8, y: 22, w: 12, h: 34, r: 4, from: '#64748B', to: '#475569', dx: -28, dy: 0 },
] as const

/** 中央播放三角 */
export const LOGO_PLAY =
  'M29 26.6v10.8a1 1 0 0 0 1.5.86l8.9-5.4a1 1 0 0 0 0-1.72l-8.9-5.4a1 1 0 0 0-1.5.86Z'
