import { describe, expect, it } from 'vitest'
import { arrange, bounds, exportScale, matchSize, normalize, snapMove, snapResize } from '@/features/stitch/lib'

const a = { id: 'a', x: 0, y: 0, w: 100, h: 50 }
const b = { id: 'b', x: 0, y: 60, w: 80, h: 40 }

describe('長圖拼接幾何', () => {
  it('外接框與正規化', () => {
    expect(bounds([a, b])).toEqual({ x: 0, y: 0, w: 100, h: 100 })
    const n = normalize([{ ...a, x: 20, y: 30 }, { ...b, x: 40, y: 100 }])
    expect(n[0]).toMatchObject({ x: 0, y: 0 })
    expect(n[1]).toMatchObject({ x: 20, y: 70 })
  })
  it('直向／橫向排列與對齊', () => {
    const v = arrange([a, b], 'vertical', 10, 'center')
    expect(v[1]).toMatchObject({ x: 10, y: 60 })
    const h = arrange([a, b], 'horizontal', 0, 'end')
    expect(h[1]).toMatchObject({ x: 100, y: 10 })
  })
  it('統一寬度等比縮放', () => {
    const m = matchSize([a, b], 'vertical', 200)
    expect(m[1]).toMatchObject({ w: 200, h: 100 })
  })
  it('吸附到其他圖片的邊與間距', () => {
    const r = snapMove({ x: 3, y: 54, w: 80, h: 40 }, [a], 6, 0)
    expect(r.x).toBe(0)
    expect(r.y).toBe(50)
    expect(r.guides).toHaveLength(2)
    const far = snapMove({ x: 300, y: 300, w: 10, h: 10 }, [a], 6, 0)
    expect(far.guides).toHaveLength(0)
  })
  it('縮放時吸附同寬', () => {
    expect(snapResize(b, 97, [a], 5)).toMatchObject({ w: 100, h: 50, matched: true })
  })
  it('超過畫布上限時降低倍率', () => {
    expect(exportScale(1000, 100000, 1)).toBeCloseTo(0.32767, 4)
    expect(exportScale(1000, 1000, 1)).toBe(1)
  })
})

describe('長圖拼接狀態', () => {
  it('調整間距會重排但不寫進復原紀錄', async () => {
    const { useStitch } = await import('@/features/stitch/store')
    const item = (id: string, h: number) => ({
      id,
      file: new File([], `${id}.png`),
      name: id,
      url: '',
      natW: 100,
      natH: h,
      x: 0,
      y: 0,
      w: 100,
      h,
    })
    const s = useStitch.getState()
    s.commit([item('a', 50), item('b', 80)])
    s.layout('vertical')
    const before = useStitch.getState().past.length
    for (let g = 1; g <= 20; g++) useStitch.getState().setOptions({ gap: g })
    const st = useStitch.getState()
    expect(st.past.length).toBe(before)
    expect(st.items[1].y).toBe(70)
  })
})
