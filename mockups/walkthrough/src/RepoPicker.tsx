import { useEffect, useMemo, useState } from 'react';
import type { GithubUser } from './auth';

interface Repo { name: string; private: boolean; description: string | null; language: string | null; updatedAt: string }

type Load = { status: 'loading' } | { status: 'ready'; repos: Repo[] } | { status: 'error' };

const COBOLISH = /cobol|mainframe|cics|jcl|legacy|carddemo/i;

/** Picks the codebase Theseus maps: the CardDemo sample, or one of the signed-in user's GitHub repos. */
export function RepoPicker({ user, source, onSource }: { user: GithubUser | null; source: string; onSource: (s: string) => void }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lists the user's repositories once, through our server (which holds the GitHub token).
  useEffect(() => {
    if (!user) return;
    let live = true;
    fetch('/api/repos').then((r) => (r.ok ? (r.json() as Promise<Repo[]>) : Promise.reject(r)))
      .then((repos) => { if (live) setLoad({ status: 'ready', repos }); })
      .catch(() => { if (live) setLoad({ status: 'error' }); });
    return () => { live = false; };
  }, [user]);

  const shown = useMemo(() => {
    if (load.status !== 'ready') return [];
    const q = query.trim().toLowerCase();
    return load.repos
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q))
      .sort((a, b) => Number(COBOLISH.test(b.name + (b.language ?? ''))) - Number(COBOLISH.test(a.name + (a.language ?? ''))))
      .slice(0, 8);
  }, [load, query]);

  async function connect(name: string) {
    setConnecting(name);
    setError(null);
    const r = await fetch('/api/repos/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: name }) });
    setConnecting(null);
    if (!r.ok) {
      setError(r.status === 404 ? `Theseus can’t see ${name}. Grant private repo access and try again.` : `Couldn’t clone ${name}. Try again.`);
      return;
    }
    onSource(((await r.json()) as { source: string }).source);
  }

  const current = source === 'carddemo' ? 'AWS CardDemo (sample)' : source.replace(/^gh:/, '');
  return (
    <div className="repo-picker">
      <div className="repo-current">
        <div>
          <span>Mapping</span>
          <b>{current}</b>
        </div>
        {source !== 'carddemo' && <button type="button" className="btn" onClick={() => onSource('carddemo')}>Use the sample</button>}
      </div>
      {!user ? (
        <p className="repo-note">Sign in with GitHub to map one of your own repositories.</p>
      ) : (
        <>
          <div className="repo-search">
            <input aria-label="Search your repositories" placeholder="Search your repositories, or type owner/name" value={query} onChange={(e) => setQuery(e.target.value)} />
            {!user.canReadPrivate && <a className="btn" href="/auth/github/login?scope=repo">Include private repos</a>}
          </div>
          {load.status === 'loading' && <p className="repo-note">Loading your repositories…</p>}
          {load.status === 'error' && <p className="repo-note">Couldn’t load your repositories from GitHub.</p>}
          {/^[\w.-]+\/[\w.-]+$/.test(query.trim()) && !shown.some((x) => x.name.toLowerCase() === query.trim().toLowerCase()) && (
            <ul className="repo-list">
              <li>
                <div className="repo-meta"><b>{query.trim()}</b><span>Any repository you can read on GitHub</span></div>
                <button type="button" className="btn" disabled={connecting !== null} onClick={() => connect(query.trim())}>
                  {connecting === query.trim() ? 'Cloning…' : 'Map it'}
                </button>
              </li>
            </ul>
          )}
          {load.status === 'ready' && shown.length === 0 && !query.includes('/') && <p className="repo-note">No repositories match. Type owner/name to map any repository.</p>}
          <ul className="repo-list">
            {shown.map((r) => (
              <li key={r.name}>
                <div className="repo-meta">
                  <b>{r.name}</b>
                  <span>{[r.private ? 'Private' : 'Public', r.language, r.description].filter(Boolean).join(', ')}</span>
                </div>
                <button type="button" className={`gh:${r.name}` === source ? 'btn primary' : 'btn'} disabled={connecting !== null} onClick={() => connect(r.name)}>
                  {connecting === r.name ? 'Cloning…' : `gh:${r.name}` === source ? 'Mapped' : 'Map it'}
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="signin-error" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}
