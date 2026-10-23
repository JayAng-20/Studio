// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  aspectRatioOf,
  clampRect,
  coverScale,
  cropRect,
  fitAspect,
  flipGeometry,
  flipState,
  moveRect,
  outputSize,
  resizeRect,
  resizeTarget,
  rotateGeometry,
  rotateRect,
  rotateState,
  snapMove,
  snapResize,
  MAX_SIDE,
} from '@/features/tools/lib/geometry'
import { applyResizeTo, isPassthrough, pixelsChanged } from '@/features/tools/lib/state'
import { defaultEditState, type Geometry, type Rect } from '@/features/tools/lib/types'

const g0: Geometry = { rot: 0, flipH: false, flipV: false, angle: 0, crop: null }

/** 以矩陣驗證：把框架中的一點依可見變換對回原圖座標 */
function visiblePointToSource(g: Geometry, srcW: number, srcH: number, px: number, py: number) {
  // 可見 = F·R(rot) 作用在以中心為原點的原圖上
  const fw = g.rot % 180 ? srcH : srcW
  const fh = g.rot % 180 ? srcW : srcH
  let x = px - fw / 2
  let y = py - fh / 2
  if (g.flipH) x = -x
  if (g.flipV) y = -y
  const a = (-g.rot * Math.PI) / 180
  const sx = x * Math.cos(a) - y * Math.sin(a)
  const sy = x * Math.sin(a) + y * Math.cos(a)
  return [Math.round(sx + srcW / 2), Math.round(sy + srcH / 2)]
}

describe('旋轉與翻轉', () => {
  it('rotateRect 順時針四次回到原位，逆時針是反函數', () => {
    const r: Rect = { x: 10, y: 20, w: 30, h: 40 }
    let cur = r
    let fw = 200
    let fh = 100
    for (let i = 0; i < 4; i++) {
      cur = rotateRect(cur, fw, fh, 1)
      ;[fw, fh] = [fh, fw]
    }
    expect(cur).toEqual(r)
    const cw = rotateRect(r, 200, 100, 1)
    expect(rotateRect(cw, 100, 200, -1)).toEqual(r)
  })

  it('裁切框跟著內容走：旋轉、翻轉後仍框住同一塊原圖', () => {
    const srcW = 400
    const srcH = 300
    // 原圖中 (50,60) 這一點在裁切框左上角
    let g: Geometry = { ...g0, crop: { x: 50, y: 60, w: 100, h: 80 } }
    const corner = (gg: Geometry) => {
      const c = gg.crop!
      // 框的四個角對回原圖，取集合
      const pts = [
        [c.x, c.y],
        [c.x + c.w, c.y],
        [c.x, c.y + c.h],
        [c.x + c.w, c.y + c.h],
      ].map(([x, y]) => visiblePointToSource(gg, srcW, srcH, x, y).join(','))
      return pts.sort()
    }
    const original = corner(g)
    const ops: Array<(x: Geometry) => Geometry> = [
      (x) => rotateGeometry(x, srcW, srcH, 1),
      (x) => flipGeometry(x, srcW, srcH, 'h'),
      (x) => rotateGeometry(x, srcW, srcH, 1),
      (x) => flipGeometry(x, srcW, srcH, 'v'),
      (x) => rotateGeometry(x, srcW, srcH, -1),
      (x) => flipGeometry(x, srcW, srcH, 'h'),
    ]
    for (const op of ops) {
      g = op(g)
      expect(corner(g)).toEqual(original)
    }
  })

  it('兩軸都翻轉時正規化成轉 180°', () => {
    const g = flipGeometry(flipGeometry(g0, 10, 10, 'h'), 10, 10, 'v')
    expect(g).toMatchObject({ rot: 180, flipH: false, flipV: false })
  })

  it('翻轉時拉直角度反向', () => {
    expect(flipGeometry({ ...g0, angle: 5 }, 10, 10, 'h').angle).toBe(-5)
  })

  it('rotateState 交換像素尺寸與 16:9 ⇄ 9:16，其他比例切換直式', () => {
    const s = {
      ...defaultEditState(),
      aspect: '16:9' as const,
      resize: { mode: 'px' as const, width: 1920, height: 1080, lock: true },
    }
    const r = rotateState(s, 400, 300, 1)
    expect(r.aspect).toBe('9:16')
    expect(r.resize).toEqual({ mode: 'px', width: 1080, height: 1920, lock: true })
    const r2 = rotateState({ ...s, aspect: '4:3' }, 400, 300, 1)
    expect(r2.aspectFlip).toBe(true)
    expect(aspectRatioOf('4:3', [1, 1], true, 1, 1)).toBeCloseTo(3 / 4)
  })

  it('flipState 一併翻轉遮蔽區域', () => {
    const s = {
      ...defaultEditState(),
      redactions: [{ id: 'a', mode: 'black' as const, rect: { x: 0, y: 0, w: 10, h: 10 } }],
    }
    expect(flipState(s, 100, 50, 'h').redactions[0].rect.x).toBe(90)
  })
})

describe('拉直', () => {
  it('角度 0 時倍率為 1', () => expect(coverScale(400, 300, 0)).toBe(1))
  it('旋轉後放大能完全蓋住框架（四個角都在圖內）', () => {
    for (const angle of [-45, -12.5, 3, 30, 45]) {
      const [fw, fh] = [400, 300]
      const s = coverScale(fw, fh, angle)
      const a = (angle * Math.PI) / 180
      for (const [cx, cy] of [
        [fw / 2, fh / 2],
        [fw / 2, -fh / 2],
      ]) {
        // 框架角落轉回圖片座標，必須在 (s·fw/2, s·fh/2) 之內
        const x = Math.abs(cx * Math.cos(a) + cy * Math.sin(a))
        const y = Math.abs(-cx * Math.sin(a) + cy * Math.cos(a))
        expect(x).toBeLessThanOrEqual((s * fw) / 2 + 1e-6)
        expect(y).toBeLessThanOrEqual((s * fh) / 2 + 1e-6)
      }
    }
  })
})

describe('裁切框', () => {
  it('fitAspect 取最大的置中矩形', () => {
    expect(fitAspect(1, 400, 300)).toEqual({ x: 50, y: 0, w: 300, h: 300 })
    expect(fitAspect(16 / 9, 400, 300)).toEqual({ x: 0, y: 37.5, w: 400, h: 225 })
  })

  it('moveRect 不會超出框架', () => {
    expect(moveRect({ x: 10, y: 10, w: 50, h: 50 }, 1000, -1000, 100, 100)).toEqual({
      x: 50,
      y: 0,
      w: 50,
      h: 50,
    })
  })

  it('clampRect 限制大小與位置', () => {
    expect(clampRect({ x: -5, y: 90, w: 500, h: 20 }, 100, 100)).toEqual({
      x: 0,
      y: 80,
      w: 100,
      h: 20,
    })
  })

  it('自由比例：拖右下角放大，左上角固定；不超出框架', () => {
    const r = resizeRect({ x: 10, y: 10, w: 50, h: 50 }, 'se', 20, 500, {
      ratio: null,
      fw: 200,
      fh: 100,
    })
    expect(r).toEqual({ x: 10, y: 10, w: 70, h: 90 })
  })

  it('自由比例：不小於最小尺寸', () => {
    const r = resizeRect({ x: 10, y: 10, w: 50, h: 50 }, 'nw', 100, 100, {
      ratio: null,
      fw: 200,
      fh: 200,
      min: 8,
    })
    expect(r.w).toBe(8)
    expect(r.h).toBe(8)
    expect(r.x + r.w).toBe(60)
  })

  it('固定比例：角落把手維持比例並固定對角', () => {
    const r = resizeRect({ x: 100, y: 100, w: 160, h: 90 }, 'nw', -40, -5, {
      ratio: 16 / 9,
      fw: 1000,
      fh: 1000,
    })
    expect(r.w / r.h).toBeCloseTo(16 / 9)
    expect(r.x + r.w).toBeCloseTo(260)
    expect(r.y + r.h).toBeCloseTo(190)
  })

  it('固定比例：碰到框架時等比例縮小', () => {
    const r = resizeRect({ x: 0, y: 0, w: 100, h: 100 }, 'se', 500, 0, {
      ratio: 1,
      fw: 300,
      fh: 200,
    })
    expect(r).toEqual({ x: 0, y: 0, w: 200, h: 200 })
  })

  it('固定比例：邊把手以另一軸中心等比例延伸', () => {
    const r = resizeRect({ x: 100, y: 100, w: 100, h: 100 }, 'e', 50, 0, {
      ratio: 1,
      fw: 1000,
      fh: 1000,
    })
    expect(r).toEqual({ x: 100, y: 75, w: 150, h: 150 })
  })
})

describe('磁吸', () => {
  it('平移時邊緣吸附框架邊界', () => {
    const s = snapMove({ x: 5, y: 40, w: 50, h: 20 }, 200, 100, 8)
    expect(s.rect.x).toBe(0)
    expect(s.guideX).toBeNull() // 邊界不畫輔助線
  })

  it('平移時中心吸附框架中線並回報輔助線', () => {
    const s = snapMove({ x: 72, y: 10, w: 50, h: 20 }, 200, 100, 8)
    expect(s.rect.x).toBe(75)
    expect(s.guideX).toBe(100)
  })

  it('超過門檻不吸附', () => {
    const s = snapMove({ x: 30, y: 30, w: 20, h: 20 }, 200, 200, 8)
    expect(s.rect).toEqual({ x: 30, y: 30, w: 20, h: 20 })
  })

  it('自由裁切接近 4:3 時吸附過去並回報比例', () => {
    const s = snapResize({ x: 0, y: 0, w: 401, h: 300 }, 'e', 1000, 1000, 2, null)
    expect(s.rect.w).toBe(400)
    expect(s.ratioLabel).toBe('4:3')
  })

  it('有固定比例時不做比例磁吸', () => {
    const s = snapResize({ x: 0, y: 0, w: 401, h: 300 }, 'e', 1000, 1000, 2, 1.5)
    expect(s.ratioLabel).toBeNull()
  })
})

describe('輸出尺寸', () => {
  it('百分比', () =>
    expect(resizeTarget({ mode: 'percent', percent: 50 }, 4000, 3000)).toEqual({
      w: 2000,
      h: 1500,
    }))
  it('像素鎖定比例：等比例縮進框內', () =>
    expect(resizeTarget({ mode: 'px', width: 1080, height: 1080, lock: true }, 4000, 3000)).toEqual(
      { w: 1080, h: 810 },
    ))
  it('像素不鎖定：精確寬高', () =>
    expect(resizeTarget({ mode: 'px', width: 300, height: 100, lock: false }, 4000, 3000)).toEqual({
      w: 300,
      h: 100,
    }))
  it('超過單邊上限時等比例縮回', () => {
    const r = resizeTarget({ mode: 'percent', percent: 1000 }, 4000, 3000)
    expect(r.w).toBe(MAX_SIDE)
    expect(r.h).toBe(Math.round((MAX_SIDE * 3) / 4))
  })
  it('outputSize 結合裁切與縮放', () => {
    const s = {
      ...defaultEditState(),
      geometry: { ...g0, crop: { x: 0, y: 0, w: 1000, h: 500 } },
      resize: { mode: 'percent' as const, percent: 10 },
    }
    expect(outputSize(s, 4000, 3000)).toEqual({ w: 100, h: 50 })
    expect(cropRect(s.geometry, 4000, 3000)).toEqual({ x: 0, y: 0, w: 1000, h: 500 })
  })
})

describe('批次套用與沿用原檔', () => {
  it('固定比例＋像素尺寸套到其他圖片：置中裁切並等比例縮放', () => {
    const src = {
      ...defaultEditState(),
      aspect: '1:1' as const,
      resize: { mode: 'px' as const, width: 1080, height: 1080, lock: true },
    }
    const out = applyResizeTo(src, defaultEditState(), 1000, 1000, 4000, 3000)
    expect(out.geometry.crop).toEqual({ x: 500, y: 0, w: 3000, h: 3000 })
    expect(outputSize(out, 4000, 3000)).toEqual({ w: 1080, h: 1080 })
  })

  it('沒有編輯、沒選壓縮：沿用原檔；有任何畫面修改就要重新編碼', () => {
    const s = defaultEditState()
    expect(pixelsChanged(s, 100, 100)).toBe(false)
    expect(isPassthrough(s, 100, 100, 'jpeg')).toBe(true)
    expect(isPassthrough({ ...s, meta: 'strip-gps' }, 100, 100, 'jpeg')).toBe(true)
    expect(isPassthrough({ ...s, meta: 'strip-gps' }, 100, 100, 'heic')).toBe(false)
    expect(
      isPassthrough({ ...s, output: { ...s.output, mode: 'quality' } }, 100, 100, 'jpeg'),
    ).toBe(false)
    expect(pixelsChanged({ ...s, adjust: { ...s.adjust, brightness: 10 } }, 100, 100)).toBe(true)
    expect(pixelsChanged({ ...s, geometry: { ...g0, rot: 90 } }, 100, 100)).toBe(true)
    expect(
      pixelsChanged({ ...s, geometry: { ...g0, crop: { x: 0, y: 0, w: 100, h: 100 } } }, 100, 100),
    ).toBe(false)
  })
})
