import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from '@/components/ui'
import { t } from '@/i18n'

interface Props {
  children: ReactNode
  /** 換頁時重置 */
  resetKey?: string
  title?: string
  description?: string
}

/** 每個模組外包一層：出錯時顯示友善訊息與「重試」，不讓整站白屏 */
export class ErrorBoundary extends Component<Props, { error: Error | null; attempt: number }> {
  state = { error: null as Error | null, attempt: 0 }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }
  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (this.state.error) {
      const chunk = /dynamically imported module|Loading chunk|Failed to fetch/i.test(
        this.state.error.message,
      )
      return (
        <ErrorState
          className="min-h-[50vh]"
          title={chunk ? t('errors.loadFailed') : (this.props.title ?? t('errors.moduleCrash'))}
          description={
            chunk
              ? t('errors.loadFailedDesc')
              : (this.props.description ?? t('errors.moduleCrashDesc'))
          }
          retryLabel={chunk ? t('errors.reload') : undefined}
          onRetry={() =>
            chunk
              ? location.reload()
              : this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))
          }
        />
      )
    }
    return (
      <div key={this.state.attempt} className="contents">
        {this.props.children}
      </div>
    )
  }
}
