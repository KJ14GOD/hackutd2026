import { Component, type ErrorInfo, type ReactNode } from 'react'

/* If anything below throws while rendering, show a calm panel with a way back
 * instead of a blank page. "Reset view" remounts the screen with fresh state;
 * the demo data itself lives in the store and is untouched. */

interface State {
  error: Error | null
  attempt: number
}

export class ErrorBoundary extends Component<{ children: (attempt: number) => ReactNode }, State> {
  state: State = { error: null, attempt: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[shadow-diff] render failed', error, info.componentStack)
  }

  reset = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))

  render() {
    const { error, attempt } = this.state
    if (!error) return this.props.children(attempt)
    return (
      <div className="grid h-screen place-items-center bg-[var(--color-bg)] px-6 text-[var(--color-ink)]">
        <div role="alert" className="w-full max-w-[440px] rounded-[12px] border border-[var(--color-line)] bg-[var(--color-bg-2)] p-5">
          <div className="eyebrow">Something went wrong</div>
          <h1 className="mt-1.5 text-[18px] font-semibold tracking-[-0.01em]">This view hit an error</h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
            Resetting the view goes back to the whole system. Nothing is lost.
          </p>
          <pre className="mt-3 max-h-24 overflow-auto rounded-[8px] bg-[var(--color-panel)] px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap text-[var(--color-faint)]">{error.message}</pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex h-8 items-center rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-medium text-[#06212b] hover:bg-[var(--color-accent-bright)]"
            >
              Reset view
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-8 items-center rounded-[8px] border border-[var(--color-line-2)] px-3 text-[12.5px] font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}
