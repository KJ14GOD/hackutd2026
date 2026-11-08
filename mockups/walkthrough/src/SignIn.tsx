import type { AuthState } from './auth';

const ERRORS: Record<string, string> = {
  denied: 'GitHub sign-in was cancelled. Try again when you’re ready.',
  failed: 'GitHub didn’t finish signing you in. Try again.',
};

/** The first screen: sign in with GitHub, or a setup note when the OAuth app isn't configured yet. */
export function SignIn({ state, onDemo }: { state: AuthState; onDemo: () => void }) {
  const error = state.status === 'signed-out' && state.error ? ERRORS[state.error] ?? ERRORS.failed : undefined;
  return (
    <main className="signin">
      <div className="signin-card">
        <div className="signin-brand">
          <svg viewBox="0 0 24 24" className="signin-logo" aria-hidden>
            <path d="M12 3v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M13 4.6 18.2 11H13z" fill="currentColor" />
            <path d="M2.5 13.5h19l-2.6 5.3a1.4 1.4 0 0 1-1.25.7H6.35a1.4 1.4 0 0 1-1.25-.7z" fill="currentColor" />
          </svg>
          Theseus
        </div>
        <h1>Sign in to modernize your legacy code</h1>
        <p>Theseus reads your repository, maps every program, and asks the right people about what the code never explains.</p>

        {state.status === 'not-configured' ? (
          <div className="signin-setup">
            <b>GitHub sign-in isn’t set up yet.</b>
            <ol className="signin-steps">
              <li>Create an OAuth App at github.com/settings/developers with this callback URL:
                <code>http://localhost:5173/auth/github/callback</code></li>
              <li>Copy <code>mockups/walkthrough/.env.example</code> to <code>.env</code> and paste in its client ID and secret.</li>
              <li>Restart the dev server.</li>
            </ol>
            <button type="button" className="btn" onClick={onDemo}>Continue with sample data</button>
          </div>
        ) : (
          <>
            <a className="btn primary signin-github" href="/auth/github/login">
              <img src="/logos/github.svg" alt="" />Continue with GitHub
            </a>
            {error && <p className="signin-error" role="alert">{error}</p>}
            <p className="signin-fine">Theseus asks GitHub for your public profile only. It will ask again before reading any repository.</p>
          </>
        )}
      </div>
    </main>
  );
}
