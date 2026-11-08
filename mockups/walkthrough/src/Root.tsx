import { useEffect, useState } from 'react';
import { App } from './App';
import { fetchMe, signOut, type AuthState } from './auth';
import { SignIn } from './SignIn';

/** Gates the app on GitHub sign-in. Sample-data mode is only offered when sign-in isn't configured. */
export function Root() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [demo, setDemo] = useState(false);

  // Asks the server once whether a session already exists.
  useEffect(() => {
    let live = true;
    fetchMe().then((s) => { if (live) setAuth(s); }).catch(() => { if (live) setAuth({ status: 'signed-out', error: 'failed' }); });
    return () => { live = false; };
  }, []);

  if (auth.status === 'loading') return <main className="signin" aria-busy="true" />;
  if (auth.status === 'signed-in' || demo) {
    return (
      <App
        user={auth.status === 'signed-in' ? auth.user : null}
        onSignOut={async () => {
          await signOut();
          setDemo(false);
          setAuth({ status: 'signed-out' });
          window.history.replaceState(null, '', '/');
        }}
      />
    );
  }
  return <SignIn state={auth} onDemo={() => setDemo(true)} />;
}
