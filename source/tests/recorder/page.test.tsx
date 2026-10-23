import { describe, expect, it, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

// jsdom 沒有 MediaRecorder 與螢幕擷取：補上最小的假物件
beforeAll(async () => {
  const { useSettings } = await import('@/stores/settings')
  useSettings.setState({ lang: 'zh-TW' })
  class FakeRecorder {
    static isTypeSupported = (m: string) => m.startsWith('video/webm')
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getDisplayMedia: vi.fn(),
      getUserMedia: vi.fn(),
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
})

describe('螢幕錄影頁面煙霧測試', () => {
  it('可以渲染準備畫面、主要按鈕存在、沒有 console.error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { default: Page } = await import('@/features/recorder')
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('button', { name: '開始錄影' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: '錄影來源' })).toBeInTheDocument()
    expect(screen.getByText('錄影庫')).toBeInTheDocument()
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })
})
