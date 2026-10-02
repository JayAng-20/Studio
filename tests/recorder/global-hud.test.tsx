import { describe, expect, it, beforeAll, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { TooltipProvider } from '@/components/ui'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import GlobalHud from '@/features/recorder/GlobalHud'
import { UNSAVED_KEY, useRecorder } from '@/features/recorder/engine'

function Where() {
  return <p data-testid="path">{useLocation().pathname}</p>
}

function renderAt(path: string) {
  return render(
    // 外殼的 App 已提供 TooltipProvider
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>
        <GlobalHud />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  )
}

beforeAll(() => {
  useSettings.setState({ lang: 'zh-TW' })
})

beforeEach(() => {
  act(() => {
    useRecorder.setState({ stage: 'setup', paused: false, elapsed: 0, result: null })
  })
})

describe('全域 HUD', () => {
  it('錄製中且不在錄影頁時顯示計時與控制', () => {
    act(() => useRecorder.setState({ stage: 'recording', elapsed: 12_400 }))
    renderAt('/qr')
    expect(screen.getByRole('toolbar', { name: '錄影中（在其他工具）' })).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('00:12.4')
    expect(screen.getByRole('button', { name: '暫停' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停止並完成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回到螢幕錄影' })).toBeInTheDocument()
  })

  it('暫停時顯示「繼續」', () => {
    act(() => useRecorder.setState({ stage: 'recording', paused: true, elapsed: 3_000 }))
    renderAt('/qr')
    expect(screen.getByRole('button', { name: '繼續' })).toBeInTheDocument()
  })

  it('在錄影頁或沒有錄影時不顯示', () => {
    act(() => useRecorder.setState({ stage: 'recording' }))
    const a = renderAt('/recorder')
    expect(screen.queryByRole('toolbar')).toBeNull()
    a.unmount()
    act(() => useRecorder.setState({ stage: 'setup' }))
    renderAt('/qr')
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('按「回到螢幕錄影」或「停止」會導回 /recorder', () => {
    act(() => useRecorder.setState({ stage: 'recording' }))
    renderAt('/qr')
    fireEvent.click(screen.getByRole('button', { name: '回到螢幕錄影' }))
    expect(screen.getByTestId('path')).toHaveTextContent('/recorder')
  })

  it('停止後導回 /recorder', () => {
    act(() => useRecorder.setState({ stage: 'recording' }))
    renderAt('/gif')
    fireEvent.click(screen.getByRole('button', { name: '停止並完成' }))
    expect(screen.getByTestId('path')).toHaveTextContent('/recorder')
  })

  it('錄製中由引擎登記離開警告（不依賴錄影頁）', () => {
    act(() => useRecorder.setState({ stage: 'recording' }))
    expect(useUi.getState().unsavedReasons.has(UNSAVED_KEY)).toBe(true)
    act(() => useRecorder.setState({ stage: 'setup', result: null }))
    expect(useUi.getState().unsavedReasons.has(UNSAVED_KEY)).toBe(false)
    expect(UNSAVED_KEY).toBe('recorder')
  })
})
