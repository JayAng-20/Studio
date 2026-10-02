import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Suspense } from 'react'
import { TooltipProvider } from '@/components/ui'
import { modules } from '@/config/modules'

/** 煙霧測試：每個模組頁都能渲染出頁首與主要操作，沒有 console.error */
// 模擬一般桌機瀏覽器的錄影能力（jsdom 沒有），讓錄影模組顯示正常的準備畫面
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: {
    getDisplayMedia: async () => new MediaStream(),
    getUserMedia: async () => new MediaStream(),
    enumerateDevices: async () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  },
})
if (typeof globalThis.MediaStream === 'undefined') {
  // @ts-expect-error 測試用最小替身
  globalThis.MediaStream = class {
    getTracks() {
      return []
    }
  }
}
if (typeof globalThis.MediaRecorder === 'undefined') {
  // @ts-expect-error 測試用最小替身
  globalThis.MediaRecorder = class {
    static isTypeSupported(t: string) {
      return t.startsWith('video/webm')
    }
  }
}

describe('模組頁煙霧測試', () => {
  for (const m of modules) {
    it(`${m.id} 可以渲染`, async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { default: Page } = await m.load()
      render(
        <TooltipProvider>
          <MemoryRouter initialEntries={[m.path]}>
            <Suspense fallback={null}>
              <Page />
            </Suspense>
          </MemoryRouter>
        </TooltipProvider>,
      )
      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
      // 每個模組的空狀態都有可操作的按鈕（選擇檔案、開始錄影、產生等）
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
      const errors = err.mock.calls.filter((c) => !String(c[0]).includes('not wrapped in act'))
      expect(errors).toEqual([])
      err.mockRestore()
    })
  }
})
