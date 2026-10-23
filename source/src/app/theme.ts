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

/**
 * 切換主題：支援 View Transitions 時，從按鈕位置向外擴散的圓形揭示；
 * 不支援時退回 200 ms 交叉淡化。
 */
export function switchTheme(next: ThemePref, origin?: { x: number; y: number }) {
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
  const x = origin?.x ?? innerWidth - 40
  const y = origin?.y ?? 28
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
