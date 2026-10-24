import { flushSync } from 'react-dom'
import { resolveTheme, useSettings, type ThemePref } from '@/stores/settings'
import { caps } from '@/lib/capabilities'
import { duration } from '@/design/motion'

/** 把主題、動畫強度、語言寫到 <html> */
export function applyDocumentAttrs() {
  const s = useSettings.getState()
  const root = document.documentElement
  root.dataset.theme = resolveTheme(s.theme)
  root.dataset.motion = s.motion
  root.lang = s.lang
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', root.dataset.theme === 'dark' ? '#0A0C10' : '#F4F5F8')
}

type Point = { x: number; y: number }

let lastPress: Point | null = null
let trackerInstalled = false

const centerOf = (el: Element): Point => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/**
 * 記錄使用者最近一次操作的位置：滑鼠或觸控按下的座標；鍵盤操作則取焦點元素的中心。
 * 這樣任何切換主題的按鈕（頂欄、設定頁、指令面板）都會從實際按下的地方開始擴散，不必各自傳入位置。
 */
export function installPressTracker() {
  if (trackerInstalled || typeof window === 'undefined') return
  trackerInstalled = true
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.clientX || e.clientY) lastPress = { x: e.clientX, y: e.clientY }
      else if (e.target instanceof Element) lastPress = centerOf(e.target)
    },
    { capture: true, passive: true },
  )
  window.addEventListener(
    'keydown',
    () => {
      if (document.activeElement instanceof Element) lastPress = centerOf(document.activeElement)
    },
    { capture: true },
  )
}

/** 圓形揭示的起點：最近一次操作的位置，沒有紀錄時用畫面中央 */
export function pressOrigin(): Point {
  return lastPress ?? { x: innerWidth / 2, y: innerHeight / 2 }
}

/**
 * 切換主題：支援 View Transitions 時，從按下的位置向外擴散的圓形揭示；
 * 不支援時退回 200 ms 交叉淡化。
 */
export function switchTheme(next: ThemePref, origin?: Point) {
  const apply = () => {
    useSettings.getState().set({ theme: next })
    applyDocumentAttrs()
  }
  const motionPref = useSettings.getState().motion
  const before = resolveTheme(useSettings.getState().theme)
  if (before === resolveTheme(next) || motionPref === 'off') {
    apply()
    return
  }
  if (!caps.viewTransitions() || motionPref === 'lite') {
    const root = document.documentElement
    root.classList.add('theme-fade')
    apply()
    setTimeout(() => root.classList.remove('theme-fade'), 220)
    return
  }
  const { x, y } = origin ?? pressOrigin()
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const vt = (
    document as Document & { startViewTransition: (cb: () => void) => { ready: Promise<void> } }
  ).startViewTransition(() => {
    flushSync(apply)
  })
  vt.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        {
          duration: duration.slower,
          easing: 'cubic-bezier(.16,1,.3,1)',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
    .catch(() => {})
}

export function toggleTheme(origin?: { x: number; y: number }) {
  const cur = resolveTheme(useSettings.getState().theme)
  switchTheme(cur === 'dark' ? 'light' : 'dark', origin)
}
