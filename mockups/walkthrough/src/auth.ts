// Client side of GitHub sign-in. Talks only to our own /auth routes; the token never reaches the browser.
export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  /** True once the user has granted the `repo` scope, so private repositories are readable. */
  canReadPrivate?: boolean;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-in'; user: GithubUser }
  | { status: 'signed-out'; error?: string }
  | { status: 'not-configured' };

export async function fetchMe(): Promise<AuthState> {
  const res = await fetch('/auth/me', { credentials: 'same-origin' });
  if (res.status === 503) return { status: 'not-configured' };
  if (!res.ok) {
    const reason = new URLSearchParams(window.location.search).get('signin');
    return { status: 'signed-out', ...(reason ? { error: reason } : {}) };
  }
  return { status: 'signed-in', user: (await res.json()) as GithubUser };
}

export async function signOut(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
}
