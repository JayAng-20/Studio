import { useEffect } from 'react'
import { useUi } from '@/stores/ui'
import { useSettings } from '@/stores/settings'
import { useTasks, isActive } from '@/stores/tasks'
import { t } from '@/i18n'

const isTyping = (el: Element | null) =>
  !!el &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    (el as HTMLElement).isContentEditable)

/** 全域快捷鍵與離開頁面保護 */
export function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const ui = useUi.getState()
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ui.set({ commandOpen: !ui.commandOpen })
        return
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        const s = useSettings.getState()
        if (matchMedia('(min-width: 1024px)').matches)
          s.set({ sidebarCollapsed: !s.sidebarCollapsed })
        else ui.set({ navOverlayOpen: !ui.navOverlayOpen })
        return
      }
      if (mod || e.altKey || isTyping(document.activeElement)) return
      // 有對話框開啟時不處理
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      if (e.key === '/' && !ui.commandOpen) {
        e.preventDefault()
        ui.set({ commandOpen: true })
      } else if (e.key === '?') {
        e.preventDefault()
        ui.set({ shortcutsOpen: true })
      }
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      const busy =
        useTasks.getState().tasks.some(isActive) || useUi.getState().unsavedReasons.size > 0
      if (busy) {
        e.preventDefault()
        e.returnValue = t('errors.leaveWarning')
        return t('errors.leaveWarning')
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])
}
