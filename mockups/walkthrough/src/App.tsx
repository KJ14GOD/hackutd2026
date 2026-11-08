import { useEffect, useState, type ReactNode } from 'react';
import type { GithubUser } from './auth';
import { MapChapter } from './MapChapter';
import { RepoPicker } from './RepoPicker';
import { ConnectorsPanel } from './ConnectorsPanel';
import { ConnectorIcon } from './connectorIcons';
import { RunChapter } from './RunChapter';
import { ReadChapter } from './ReadChapter';
import { RewriteChapter } from './rewrite/RewriteChapter';
import { WarRoomChapter } from './warroom/WarRoomChapter';
import { ShadowRunChapter } from './ShadowRunChapter';

/** Pick a codebase, see its static map (Part 1), run it for real (Runtime), then have Nemotron read it (Part 2). */
interface Step { title: string; line: string }
const STEPS: Step[] = [
  { title: 'Connect a repository', line: 'Pick the COBOL codebase Theseus should map.' },
  { title: 'Map the code', line: 'Read straight from the COBOL, job scripts and online config. No LLM. Drag to explore, hover to trace.' },
  { title: 'Run the code', line: 'Each batch program compiles and runs in a GnuCOBOL sandbox, with PostgreSQL standing in for DB2, under scenarios built from its own code. A link on the map is confirmed when the line that makes it actually runs.' },
  { title: 'Read the code', line: 'Nemotron reads each program with its map links and run results, and reports rules, suspected bugs and questions. Anything it can’t cite to a real line is thrown out.' },
  { title: 'Rewrite the code', line: 'Nemotron writes the Java for one program at a time. It compiles, fixes what javac rejects, runs the same sandbox scenarios as the COBOL, and the outputs are diffed line by line.' },
  { title: 'Watch it work', line: 'Nemotron reads several programs at once; the lines it cites light up in the COBOL as it writes. Jev decides which program takes the stage.' },
  { title: 'Shadow the rewrite', line: 'Old and new run on the same inputs. What nobody can decide goes to a person, and traffic moves only when the gate opens.' },
];

function stepFromUrl(): number {
  const n = Number(new URLSearchParams(window.location.search).get('chapter'));
  return Number.isInteger(n) && n >= 1 && n <= STEPS.length ? n - 1 : 0;
}

export function App({ user, onSignOut }: { user: GithubUser | null; onSignOut: () => void }) {
  const [step, setStep] = useState(stepFromUrl);
  const [source, setSourceState] = useState(() => {
    try { return localStorage.getItem('theseus-source') ?? 'carddemo'; } catch { return 'carddemo'; }
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('theme');
    if (fromUrl === 'dark' || fromUrl === 'light') return fromUrl;
    try { return localStorage.getItem('theseus-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });

  // The theme lives on <html> so every rule, including the page background, can follow it.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theseus-theme', theme); } catch { /* storage can be blocked; the toggle still works */ }
  }, [theme]);

  function go(target: number) {
    const s = Math.max(0, Math.min(STEPS.length - 1, target));
    setStep(s);
    window.history.replaceState(null, '', `?chapter=${s + 1}`);
  }
  const setSource = (s: string) => {
    setSourceState(s);
    try { localStorage.setItem('theseus-source', s); } catch { /* the choice still applies this session */ }
  };

  const current = STEPS[step];
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><Logo />Theseus</div>
        <nav className="chapters" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button key={s.title} type="button" onClick={() => go(i)} aria-current={i === step ? 'page' : undefined}
              className={i === step ? 'chapter now' : i < step ? 'chapter done' : 'chapter'}>
              {s.title}
            </button>
          ))}
        </nav>
        <div className="controls">
          {user ? (
            <div className="who-am-i">
              <span className="who-name"><ConnectorIcon id="github" size={14} />{user.login}</span>
              <button type="button" className="btn" onClick={onSignOut}>Sign out</button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={onSignOut}>Sign in</button>
          )}
          <button type="button" className="btn theme" onClick={() => setTheme((m) => (m === 'light' ? 'dark' : 'light'))}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
          <button type="button" className="btn" onClick={() => go(step - 1)} disabled={step === 0}>Back</button>
          <button type="button" className="btn" onClick={() => go(step + 1)} disabled={step === STEPS.length - 1}>Next <span aria-hidden>→</span></button>
        </div>
      </header>

      {step === 1 ? (
        <MapChapter title={current.title} line={current.line} source={source} />
      ) : step === 2 ? (
        <RunChapter title={current.title} line={current.line} source={source} />
      ) : step === 3 ? (
        <ReadChapter title={current.title} line={current.line} source={source} />
      ) : step === 4 ? (
        <RewriteChapter source={source} />
      ) : step === 5 ? (
        <WarRoomChapter source={source} />
      ) : step === 6 ? (
        <ShadowRunChapter title={current.title} line={current.line} source={source} />
      ) : (
        <main className="page-scroll">
          <article className="page">
            <header className="page-head">
              <div>
                <div className="chapter-num">Step 01</div>
                <h1><Scramble text={current.title} /></h1>
                <p>{current.line}</p>
              </div>
            </header>
            <Section title="Codebase" note="The repository Theseus maps">
              <RepoPicker user={user} source={source} onSource={(s) => { setSource(s); go(1); }} />
            </Section>
            <Section title="Connected tools" note="Where Theseus looks for people and knowledge">
              <ConnectorsPanel />
            </Section>
          </article>
        </main>
      )}
    </div>
  );
}

/** A label column on the left, the content on the right. */
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head"><h2>{title}</h2>{note && <span>{note}</span>}</div>
      <div className="section-body">{children}</div>
    </section>
  );
}

const GLYPHS = '[]~?@$#%&*+=<>/\\0123456789';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Headline that decodes out of random glyphs, left to right, then settles. */
function Scramble({ text }: { text: string }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? text.length : 0));
  useEffect(() => {
    if (shown >= text.length) return;
    const t = window.setTimeout(() => setShown((n) => n + 1), 28);
    return () => window.clearTimeout(t);
  }, [shown, text.length]);
  const noise = (i: number) => GLYPHS[(i * 7 + shown * 13) % GLYPHS.length];
  return <>{text.split('').map((c, i) => (
    <span key={i} className={i < shown || c === ' ' ? 'ch' : 'ch noise'}>{i < shown || c === ' ' ? c : noise(i)}</span>
  ))}</>;
}

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="logo" aria-hidden>
      <defs><clipPath id="logo-hull"><path d="M2.5 13.5h19l-2.6 5.3a1.4 1.4 0 0 1-1.25.7H6.35a1.4 1.4 0 0 1-1.25-.7z" /></clipPath></defs>
      <line x1="12" y1="3" x2="12" y2="13" stroke="#a1a1a1" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13 4.6 18.2 11H13z" fill="#a1a1a1" />
      <g clipPath="url(#logo-hull)">
        <rect x="2.5" y="13.5" width="4.4" height="6.5" fill="#3a3a3a" />
        <rect x="7.4" y="13.5" width="4.4" height="6.5" fill="#3a3a3a" />
        <rect x="12.3" y="13.5" width="4.4" height="6.5" fill="#d15010" />
        <rect x="17.2" y="13.5" width="4.4" height="6.5" fill="#3a3a3a" />
      </g>
    </svg>
  );
}
