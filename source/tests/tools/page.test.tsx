import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import Page from '@/features/tools'
import { useSettings } from '@/stores/settings'

describe('圖片工具頁（煙霧測試）', () => {
  it('能渲染空狀態，沒有 console.error，主要按鈕存在', () => {
    useSettings.setState({ lang: 'zh-TW', motion: 'off' })
    const spy = vi.spyOn(console, 'error')
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    )
    expect(screen.getByText('把照片拖到這裡開始編輯')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '選擇檔案' })).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
