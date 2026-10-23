import { HashRouter } from 'react-router'
import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { useSettings } from '@/stores/settings'
import { Toaster, TooltipProvider } from '@/components/ui'
import { Shell } from './Shell'
import { applyDocumentAttrs } from './theme'

/** 動畫強度：完整＝正常、精簡＝保留淡入淡出（motion 的 reducedMotion 會移除位移與 layout）、關閉＝全部瞬間 */
export function App() {
  const motionPref = useSettings((s) => s.motion)
  const theme = useSettings((s) => s.theme)
  const lang = useSettings((s) => s.lang)

  useEffect(() => {
    applyDocumentAttrs()
  }, [motionPref, theme, lang])

  // 主題「自動」時跟隨系統
  useEffect(() => {
    if (theme !== 'auto') return
    const m = matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyDocumentAttrs()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [theme])

  return (
    <MotionConfig
      reducedMotion={motionPref === 'full' ? 'never' : 'always'}
      transition={motionPref === 'off' ? { duration: 0 } : undefined}
    >
      <TooltipProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  )
}
