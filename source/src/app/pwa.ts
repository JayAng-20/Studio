import { useEffect, useState } from 'react'
import { toast } from '@/components/ui'
import { t } from '@/i18n'
import { cleanupLocalLeftovers, localMode } from '@/lib/localMode'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((l) => l())
  })
}

/** 可安裝成 App 時提供 prompt() */
export function useInstallPrompt() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((x) => x + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return {
    available: !!deferred,
    prompt: async () => {
      if (!deferred) return
      await deferred.prompt()
      deferred = null
      listeners.forEach((l) => l())
    },
  }
}

/** 註冊 Service Worker；有新版本時用 Toast 提示重新整理 */
export async function registerPwa() {
  // 本機伺服器：不安裝 Service Worker，並移除舊版本留下的 Service Worker 與快取
  if (localMode) return void cleanupLocalLeftovers()
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
  try {
    const { registerSW } = await import('virtual:pwa-register')
    const update = registerSW({
      onNeedRefresh() {
        toast(t('pwa.updateTitle'), {
          description: t('pwa.updateDesc'),
          duration: Infinity,
          action: { label: t('pwa.updateAction'), onClick: () => update(true) },
        })
      },
    })
  } catch (e) {
    console.error(e)
  }
}
