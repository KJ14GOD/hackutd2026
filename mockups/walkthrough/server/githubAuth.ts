// GitHub sign-in (OAuth web flow) as dev-server middleware. The client secret and the user's
// token stay on the server; the browser only gets an httpOnly session cookie.
//
//   GET  /auth/github/login     -> redirects to GitHub with a one-time `state`
//   GET  /auth/github/callback  -> checks `state`, trades the code for a token, starts a session
//   GET  /auth/me               -> the signed-in user, 401 if none, 503 if GitHub isn't configured
//   POST /auth/logout           -> ends the session
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface Session {
  user: GithubUser;
  token: string;
  scopes?: string;
}

const SESSION_COOKIE = 'theseus_session';
const STATE_COOKIE = 'theseus_oauth_state';
// read:user for the profile. Reading private repos later needs `repo`, which GitHub will ask the user to approve.
const SCOPE = 'read:user user:email';

function cookies(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out.set(part.slice(0, eq).trim(), decodeURIComponent(part.slice(eq + 1).trim()));
  }
  return out;
}

function setCookie(res: ServerResponse, name: string, value: string, maxAge: number) {
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  res.setHeader('Set-Cookie', [...list, `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`]);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

// Kept in a gitignored file (owner-only) so a dev-server restart doesn't sign everyone out.
const store = resolve(__dirname, '../.cache/sessions.json');
const sessions = new Map<string, Session>(existsSync(store) ? (JSON.parse(readFileSync(store, 'utf8')) as [string, Session][]) : []);
const persist = () => {
  mkdirSync(dirname(store), { recursive: true });
  writeFileSync(store, JSON.stringify([...sessions]));
  chmodSync(store, 0o600);
};

/** The signed-in session for a request, if any. Server-side only: the token never goes to the browser. */
export function sessionFor(req: IncomingMessage): Session | undefined {
  return sessions.get(cookies(req).get(SESSION_COOKIE) ?? '');
}

export function githubAuth(env: Record<string, string>): Plugin {
  const clientId = env.GITHUB_CLIENT_ID ?? '';
  const clientSecret = env.GITHUB_CLIENT_SECRET ?? '';
  const callbackUrl = env.GITHUB_CALLBACK_URL || 'http://localhost:5173/auth/github/callback';
  const configured = clientId !== '' && clientSecret !== '';
  return {
    name: 'theseus-github-auth',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/auth/')) return next();
        try {
          if (url.pathname === '/auth/me') {
            if (!configured) return send(res, 503, { error: 'not_configured' });
            const session = sessions.get(cookies(req).get(SESSION_COOKIE) ?? '');
            return session ? send(res, 200, { ...session.user, canReadPrivate: /\brepo\b/.test(session.scopes ?? '') }) : send(res, 401, { error: 'signed_out' });
          }

          if (url.pathname === '/auth/github/login') {
            if (!configured) return send(res, 503, { error: 'not_configured' });
            const state = randomBytes(16).toString('hex');
            setCookie(res, STATE_COOKIE, state, 600);
            const auth = new URL('https://github.com/login/oauth/authorize');
            auth.searchParams.set('client_id', clientId);
            auth.searchParams.set('redirect_uri', callbackUrl);
            auth.searchParams.set('scope', url.searchParams.get('scope') === 'repo' ? `${SCOPE} repo` : SCOPE);
            auth.searchParams.set('state', state);
            auth.searchParams.set('allow_signup', 'true');
            return redirect(res, auth.toString());
          }

          if (url.pathname === '/auth/github/callback') {
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const expected = cookies(req).get(STATE_COOKIE);
            setCookie(res, STATE_COOKIE, '', 0);
            if (url.searchParams.get('error')) return redirect(res, '/?signin=denied');
            if (!code || !state || !expected || state !== expected) return redirect(res, '/?signin=failed');

            const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
              method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl }),
            });
            const tokenBody = (await tokenRes.json()) as { access_token?: string };
            if (!tokenBody.access_token) return redirect(res, '/?signin=failed');

            const userRes = await fetch('https://api.github.com/user', {
              headers: { Authorization: `Bearer ${tokenBody.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'theseus' },
            });
            if (!userRes.ok) return redirect(res, '/?signin=failed');
            const u = (await userRes.json()) as { login: string; name: string | null; avatar_url: string };

            const id = randomBytes(24).toString('hex');
            sessions.set(id, { user: { login: u.login, name: u.name, avatarUrl: u.avatar_url }, token: tokenBody.access_token, scopes: tokenRes.headers.get('x-oauth-scopes') ?? (tokenBody as { scope?: string }).scope ?? '' });
            persist();
            setCookie(res, SESSION_COOKIE, id, 60 * 60 * 8);
            return redirect(res, '/');
          }

          if (url.pathname === '/auth/logout' && req.method === 'POST') {
            sessions.delete(cookies(req).get(SESSION_COOKIE) ?? '');
            persist();
            setCookie(res, SESSION_COOKIE, '', 0);
            return send(res, 200, { ok: true });
          }
          return next();
        } catch {
          return redirect(res, '/?signin=failed');
        }
      });
    },
  };
}
