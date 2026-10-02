/** 播放器快捷鍵：登記到 ? 說明，並在模組頁面內處理 */
import { useEffect } from 'react'
import { useModuleShortcuts } from '@/stores/ui'
import { useT } from '@/i18n'
import { usePlayer } from './store'
import {
  clearSnapshot,
  frameStep,
  jumpPercent,
  poke,
  seekBy,
  setAPoint,
  setBPoint,
  stepRate,
  stepVolume,
  takeSnapshot,
  toggleFullscreen,
  toggleMute,
  togglePip,
  togglePlay,
} from './actions'

const isTyping = (el: Element | null) =>
  !!el &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    (el as HTMLElement).isContentEditable)

/** 焦點在會自己處理方向鍵的元件上（滑桿、分頁、單選、選單） */
const ownsArrows = (el: Element | null) => {
  const role = el?.getAttribute('role') ?? ''
  return /^(slider|tab|radio|menuitem|menuitemradio|menuitemcheckbox|option|listbox|spinbutton)$/.test(role)
}
/** 焦點在按鈕類元件：Space 交給按鈕本身 */
const ownsSpace = (el: Element | null) => {
  if (!el) return false
  const role = el.getAttribute('role') ?? ''
  return el.tagName === 'BUTTON' || el.tagName === 'A' || /^(button|switch|checkbox|radio|tab|menuitem\w*|option)$/.test(role)
}

export function usePlayerShortcuts(enabled: boolean) {
  const t = useT()
  useModuleShortcuts([
    { keys: ['Space'], label: t('player.shortcuts.playPause') },
    { keys: ['K'], label: t('player.shortcuts.playPause') },
    { keys: ['←', '→'], label: t('player.shortcuts.seek5') },
    { keys: ['Shift', '←', '→'], label: t('player.shortcuts.seek10') },
    { keys: ['J', 'L'], label: t('player.shortcuts.seek10') },
    { keys: ['↑', '↓'], label: t('player.shortcuts.volume') },
    { keys: ['M'], label: t('player.shortcuts.mute') },
    { keys: ['F'], label: t('player.shortcuts.fullscreen') },
    { keys: [',', '.'], label: t('player.shortcuts.frame') },
    { keys: ['[', ']'], label: t('player.shortcuts.speed') },
    { keys: ['A', 'B'], label: t('player.shortcuts.ab') },
    { keys: ['0', '–', '9'], label: t('player.shortcuts.jump') },
    { keys: ['P'], label: t('player.shortcuts.pip') },
    { keys: ['S'], label: t('player.shortcuts.snapshot') },
    { keys: ['I'], label: t('player.shortcuts.info') },
    { keys: ['?'], label: t('player.shortcuts.help') },
  ])

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const a = document.activeElement
      if (isTyping(a)) return
      // 對話框或抽屜開啟時不處理（全螢幕抽屜在播放畫面內，不算）
      if (document.querySelector('[role="dialog"][data-state="open"], [data-vaul-drawer][data-state="open"]')) return
      if (!usePlayer.getState().currentId) return
      const k = e.key
      const lower = k.length === 1 ? k.toLowerCase() : k
      let handled = true
      switch (lower) {
        case ' ':
        case 'Spacebar':
          if (ownsSpace(a)) return
          togglePlay(true)
          break
        case 'k':
          togglePlay(true)
          break
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (ownsArrows(a)) return
          const d = (e.shiftKey ? 10 : 5) * (k === 'ArrowLeft' ? -1 : 1)
          seekBy(d, { ripple: true })
          break
        }
        case 'j':
          seekBy(-10, { ripple: true })
          break
        case 'l':
          seekBy(10, { ripple: true })
          break
        case 'ArrowUp':
        case 'ArrowDown':
          if (ownsArrows(a)) return
          stepVolume(k === 'ArrowUp' ? 0.05 : -0.05)
          break
        case 'm':
          toggleMute()
          break
        case 'f':
          void toggleFullscreen()
          break
        case ',':
        case '<':
          frameStep(-1)
          break
        case '.':
        case '>':
          frameStep(1)
          break
        case '[':
          stepRate(-1)
          break
        case ']':
          stepRate(1)
          break
        case 'a':
          setAPoint()
          break
        case 'b':
          setBPoint()
          break
        case 'p':
          void togglePip()
          break
        case 's':
          void takeSnapshot()
          break
        case 'i':
          usePlayer.getState().set({ infoOverlay: !usePlayer.getState().infoOverlay })
          break
        case 'Escape': {
          const s = usePlayer.getState()
          if (s.drawerOpen && s.fullscreen) s.set({ drawerOpen: false })
          else if (s.snapshot) clearSnapshot()
          else if (s.infoOverlay) s.set({ infoOverlay: false })
          else handled = false
          break
        }
        default:
          if (/^[0-9]$/.test(k)) jumpPercent(Number(k) * 10)
          else handled = false
      }
      if (handled) {
        e.preventDefault()
        poke()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
