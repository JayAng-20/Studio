import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installPressTracker, pressOrigin, switchTheme } from '@/app/theme'
import { useSettings } from '@/stores/settings'

/** 主題切換的圓形揭示起點：應該是使用者最近一次按下的位置 */
describe('主題切換的動畫起點', () => {
  beforeAll(() => {
    installPressTracker()
  })

  afterEach(() => {
    delete (document as Partial<Document> & { startViewTransition?: unknown }).startViewTransition
  })

  it('沒有操作紀錄時從畫面中央開始', () => {
    expect(pressOrigin()).toEqual({ x: innerWidth / 2, y: innerHeight / 2 })
  })

  it('滑鼠或觸控按下的座標就是起點', () => {
    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: 120, clientY: 340, bubbles: true }),
    )
    expect(pressOrigin()).toEqual({ x: 120, y: 340 })
  })

  it('鍵盤操作時取焦點元素的中心', () => {
    const btn = document.createElement('button')
    btn.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        width: 40,
        height: 20,
        right: 140,
        bottom: 70,
        x: 100,
        y: 50,
      }) as DOMRect
    document.body.appendChild(btn)
    btn.focus()
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(pressOrigin()).toEqual({ x: 120, y: 60 })
    btn.remove()
  })

  it('切換主題時 View Transition 的圓形從按下的位置開始擴散', async () => {
    const animate = vi.fn()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (cb: () => void) => {
        cb()
        return { ready: Promise.resolve() }
      },
    })
    document.documentElement.animate = animate as unknown as typeof document.documentElement.animate
    useSettings.setState({ theme: 'light', motion: 'full' })

    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: 300, clientY: 500, bubbles: true }),
    )
    switchTheme('dark')

    await vi.waitFor(() => expect(animate).toHaveBeenCalled())
    const [frames] = animate.mock.calls[0] as [{ clipPath: string[] }]
    expect(frames.clipPath[0]).toBe('circle(0px at 300px 500px)')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
