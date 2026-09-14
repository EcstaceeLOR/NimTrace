import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('NimTrace failed safely', { error, componentStack: info.componentStack })
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="error-state" role="alert">
          <p className="eyebrow">NIMTRACE</p>
          <h1>We could not open your passports.</h1>
          <p>Your wallet and product records are safe. Reload the mini app to try again.</p>
          <button className="button button--primary" type="button" onClick={() => window.location.reload()}>
            Reload NimTrace
          </button>
        </main>
      )
    }

    return this.props.children
  }
}
