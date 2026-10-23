import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionGlobalConfig } from 'motion/react'
import './index.css'
import { App } from './app/App'
import { applyDocumentAttrs } from './app/theme'
import { registerPwa } from './app/pwa'
import { useSettings } from './stores/settings'

applyDocumentAttrs()

// 動畫強度「關閉」：所有 motion 動畫直接跳到終點
const syncSkip = () => {
  MotionGlobalConfig.skipAnimations = useSettings.getState().motion === 'off'
}
syncSkip()
useSettings.subscribe(syncSkip)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 開場 splash：Logo 組裝完成後淡出並輕微放大
requestAnimationFrame(() => {
  const splash = document.getElementById('splash')
  if (!splash) return
  const minShow = useSettings.getState().motion === 'off' ? 0 : 650
  const elapsed = performance.now()
  setTimeout(
    () => {
      splash.classList.add('splash-out')
      setTimeout(() => splash.remove(), 500)
    },
    Math.max(0, minShow - elapsed),
  )
})

registerPwa()
