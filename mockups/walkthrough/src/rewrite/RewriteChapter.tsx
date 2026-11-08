// Step: rewrite the code. One program at a time: the COBOL paragraph Nemotron is translating on the
// left, the Java file growing token by token on the right, then javac, each fix pass as an inline diff,
// the sandbox runs, and the output diff against the COBOL. Replay plays the recorded live run.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { diffLines, hunks, type DiffLine } from './diff';
import { fetchRewriteList, openRewriteStream, stripFence, type Mismatch, type RewriteResult, type RewriteStream, type StreamEvent, type StreamMode } from './events';
import './rewrite.css';

type Step = 'idle' | 'writing' | 'compiling' | 'fixing' | 'compiled' | 'running' | 'diffing' | 'done' | 'error';

interface RunRow { scenario: string; rc: number; expectedRc: number; ms: number }
interface DiffRow { scenario: string; matchRate: number; matched: number; total: number; mismatches: Mismatch[] }

interface State {
  step: Step;
  stage: string;
  java: string;
  /** The file before the current fix pass, for the inline diff. */
  before?: string;
  pass: number;
  fixReason?: 'compile' | 'diff';
  compileError?: string;
  runs: RunRow[];
  diffs: DiffRow[];
  result?: RewriteResult;
  error?: string;
  mode: StreamMode;
  focus?: { ref: string; label?: string };
}

const INITIAL: State = { step: 'idle', stage: '', java: '', pass: 0, runs: [], diffs: [], mode: 'replay' };
const DEMO_PROGRAMS = ['CBACT04C', 'CBTRN02C', 'CBACT01C', 'COTRN02C', 'COBTUPDT'];
const SEQ: { id: Step[]; label: string }[] = [
  { id: ['writing'], label: 'Write Java' },
  { id: ['compiling'], label: 'Compile' },
  { id: ['fixing', 'compiled'], label: 'Fix' },
  { id: ['running'], label: 'Run scenarios' },
  { id: ['diffing', 'done'], label: 'Diff vs COBOL' },
];

export function RewriteChapter({ source }: { source: string }) {
  const [programs, setPrograms] = useState<{ program: string; status?: string; matchRate?: number; running?: boolean }[]>(DEMO_PROGRAMS.map((p) => ({ program: p })));
  const [program, setProgram] = useState(DEMO_PROGRAMS[0]);
  const [s, setS] = useState<State>(INITIAL);
  const [view, setView] = useState<'file' | 'changes'>('file');
  const stream = useRef<RewriteStream | null>(null);
  const pending = useRef('');
  const raf = useRef(0);

  // Which programs have a rewrite on disk, with their match rate.
  useEffect(() => {
    let alive = true;
    fetchRewriteList(source).then((l) => {
      if (!alive || !l) return;
      const known = new Map(l.programs.map((p) => [p.program, p]));
      const ids = [...new Set([...DEMO_PROGRAMS, ...l.programs.map((p) => p.program)])];
      setPrograms(ids.map((id) => ({ program: id, status: known.get(id)?.status, matchRate: known.get(id)?.matchRate, running: known.get(id)?.running })));
    });
    return () => { alive = false; };
  }, [source, s.step === 'done']); // eslint-disable-line react-hooks/exhaustive-deps

  // Tokens are coalesced per frame; everything else applies at once.
  const apply = useCallback((e: StreamEvent) => {
    if (e.type === 'token') {
      pending.current += e.text;
      if (!raf.current) raf.current = window.requestAnimationFrame(() => {
        raf.current = 0;
        const text = pending.current; pending.current = '';
        setS((st) => ({ ...st, java: st.java + text, step: st.step === 'fixing' ? 'fixing' : 'writing' }));
      });
      return;
    }
    // A fix pass resets the editor; flush what is queued before the reset lands.
    if (raf.current) { window.cancelAnimationFrame(raf.current); raf.current = 0; const text = pending.current; pending.current = ''; if (text) setS((st) => ({ ...st, java: st.java + text })); }
    setS((st) => {
      switch (e.type) {
        case 'focus': return { ...st, focus: { ref: e.ref, label: e.label } };
        case 'stage': return { ...st, stage: e.message, step: e.stage === 'done' ? st.step : e.stage, pass: e.pass ?? st.pass };
        case 'compile_error': return { ...st, step: 'compiling', compileError: e.text, pass: e.pass };
        case 'fix_pass': return { ...st, step: 'fixing', pass: e.pass, fixReason: e.reason, before: st.java, java: '' };
        case 'compiled': return { ...st, step: 'compiled', pass: e.pass };
        case 'run': return { ...st, step: 'running', runs: [...st.runs.filter((r) => r.scenario !== e.scenario), { scenario: e.scenario, rc: e.rc, expectedRc: e.expectedRc, ms: e.ms }] };
        case 'diff': return { ...st, step: 'diffing', diffs: [...st.diffs.filter((d) => d.scenario !== e.scenario), { scenario: e.scenario, matchRate: e.matchRate, matched: e.matched, total: e.total, mismatches: e.mismatches }] };
        case 'done': return { ...st, step: 'done', result: e.result, java: e.result.java || st.java, stage: `${e.result.status === 'shadowed' ? 'Shadowed' : e.result.status} · ${Math.round(e.result.matchRate * 100)}% of output lines match · ${e.result.passes.length - 1} fix ${e.result.passes.length === 2 ? 'pass' : 'passes'} · ${(e.result.ms / 1000).toFixed(0)} s` };
        case 'error': return { ...st, step: 'error', error: e.message };
        default: return st;
      }
    });
  }, []);

  const start = useCallback((mode: StreamMode | 'auto') => {
    stream.current?.close();
    pending.current = '';
    setView('file');
    const real: StreamMode = mode === 'auto' ? 'watch' : mode;
    setS({ ...INITIAL, mode: real, step: 'writing', stage: real === 'live' ? 'Calling Nemotron' : real === 'watch' ? 'Joining the run in progress' : 'Replaying the recorded run' });
    // 'auto' joins a run in progress if there is one, else replays the recording.
    stream.current = openRewriteStream(source, program, real, (e) => {
      if (mode === 'auto' && e.type === 'error' && /not running/.test(e.message)) {
        setS({ ...INITIAL, mode: 'replay', step: 'writing', stage: 'Replaying the recorded run' });
        stream.current = openRewriteStream(source, program, 'replay', apply);
        return;
      }
      apply(e);
    });
  }, [source, program, apply]);

  // Opens on a replay of the selected program; the stream is an external connection to close.
  const runningNow = programs.find((p) => p.program === program)?.running === true;
  useEffect(() => { start(runningNow ? 'watch' : 'auto'); return () => { stream.current?.close(); if (raf.current) window.cancelAnimationFrame(raf.current); }; }, [start]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a fix pass compiles, show what changed until the first scenario runs.
  useEffect(() => { if (s.step === 'compiled' && s.pass > 0 && s.before) setView('changes'); if (s.step === 'running') setView('file'); }, [s.step, s.pass, s.before]);

  const seqAt = SEQ.findIndex((x) => x.id.includes(s.step));
  const overall = s.result?.matchRate ?? (s.diffs.length ? s.diffs.reduce((a, d) => a + d.matched, 0) / Math.max(1, s.diffs.reduce((a, d) => a + d.total, 0)) : undefined);

  return (
    <main className="rw">
      <header className="rw-top">
        <h1>Rewrite the code</h1>
        <nav className="rw-programs" aria-label="Program">
          {programs.map((p) => (
            <button key={p.program} type="button" className={p.program === program ? 'on' : ''} onClick={() => setProgram(p.program)} title={p.status ? `${p.status} · ${Math.round((p.matchRate ?? 0) * 100)}%` : 'not rewritten yet'}>
              {p.program}{p.running ? <small> running</small> : p.matchRate !== undefined ? <small> {Math.round(p.matchRate * 100)}%</small> : null}
            </button>
          ))}
        </nav>
        <div className="rw-controls">
          <button type="button" className="wr-link" onClick={() => start('replay')} disabled={s.step === 'writing' && s.java.length < 40}>Replay</button>
          <button type="button" className="wr-link" onClick={() => start('live')} title="Runs the real pipeline: Nemotron, javac, the sandbox, the diff">{s.mode === 'live' && !['done', 'error', 'idle'].includes(s.step) ? 'Rewriting live…' : 'Rewrite live'}</button>
        </div>
      </header>

      <ol className="rw-seq" aria-label="Pipeline">
        {SEQ.map((x, i) => <li key={x.label} className={i < seqAt || s.step === 'done' ? 'done' : i === seqAt ? 'now' : ''}>{x.label}</li>)}
      </ol>
      <p className="rw-stage">{s.error ?? s.stage}{s.mode === 'replay' && s.step !== 'error' && s.step !== 'idle' ? <span className="rw-mode"> · recorded live run</span> : s.mode !== 'replay' ? <span className="rw-mode"> · live</span> : null}</p>

      <div className="rw-body">
        <CobolPane source={source} program={program} java={s.java} focus={s.focus} />
        <JavaPane state={s} view={view} onView={setView} />
      </div>

      <Results state={s} overall={overall} />
    </main>
  );
}

/* ---------------------------------------------------------------- COBOL */

interface CodeLine { no: number; text: string }
interface CodeWindow { path: string; from: number; to: number; lines: CodeLine[] }

/** The whole COBOL program, fetched as 40-line windows (the only size /api/code serves), plus its paragraph index. */
function useCobolFile(source: string, program: string) {
  const [file, setFile] = useState<{ path: string; lines: CodeLine[]; paragraphs: { name: string; line: number }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    setFile(null);
    (async () => {
      const path = `app/cbl/${program}.cbl`;
      const lines: CodeLine[] = [];
      for (let from = 1; from < 4000; from += 41) {
        const r = await fetch(`/api/code?source=${encodeURIComponent(source)}&ref=${encodeURIComponent(`${path}:${from}-${from + 40}`)}`);
        if (!r.ok) break;
        const w = (await r.json()) as CodeWindow;
        for (const l of w.lines) if (l.no >= from && l.no <= from + 40) lines.push(l);
        if (w.lines.length === 0 || w.lines[w.lines.length - 1].no < from + 40) break;
      }
      if (!alive) return;
      // A paragraph starts in area A: 7 spaces, a name, a period, nothing else.
      const paragraphs = lines.flatMap((l) => { const m = /^\s{7}([0-9A-Z][0-9A-Z-]*)\.\s*$/.exec(l.text); return m ? [{ name: m[1], line: l.no }] : []; });
      setFile({ path, lines, paragraphs });
    })().catch(() => { /* the pane stays empty */ });
    return () => { alive = false; };
  }, [source, program]);
  return file;
}

function CobolPane({ source, program, java, focus }: { source: string; program: string; java: string; focus?: { ref: string; label?: string } }) {
  const file = useCobolFile(source, program);
  // Follow the last COBOL paragraph the Java mentions (Nemotron names them in comments and methods).
  const current = useMemo(() => {
    if (!file || !file.paragraphs.length) return null;
    // A focus event from the server wins over the heuristic.
    if (focus) {
      const byLabel = focus.label ? file.paragraphs.find((p) => p.name === focus.label) : undefined;
      const m = /:(\d+)/.exec(focus.ref);
      const byLine = m ? [...file.paragraphs].reverse().find((p) => p.line <= Number(m[1])) : undefined;
      const hit = byLabel ?? byLine;
      if (hit) return hit;
    }
    const tail = java.slice(-1200).toUpperCase().replace(/_/g, '-');
    let best: { name: string; line: number } | null = null, at = -1;
    for (const p of file.paragraphs) { const i = tail.lastIndexOf(p.name); if (i > at) { at = i; best = p; } }
    return best;
  }, [file, java, focus]);
  const box = useRef<HTMLPreElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  // Scroll the pane itself (not the page) so the paragraph sits a little below the top.
  useEffect(() => {
    const pane = box.current, el = ref.current;
    if (!pane || !el) return;
    pane.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 24), behavior: 'smooth' });
  }, [current?.line, file]);
  const next = current && file ? file.paragraphs.find((p) => p.line > current.line)?.line ?? Infinity : -1;
  return (
    <section className="rw-pane rw-cobol">
      <div className="rw-pane-head"><span>COBOL · {program}</span><span>{current ? current.name : file ? `${file.lines.length} lines` : 'loading'}</span></div>
      <pre ref={box} className="rw-code">
        {file ? file.lines.map((l) => {
          const inPara = current && l.no >= current.line && l.no < next;
          return <div key={l.no} ref={current && l.no === current.line ? ref : undefined} className={`rw-line${inPara ? ' focus' : ''}`}><span className="rw-no">{l.no}</span><span className="rw-src">{l.text || ' '}</span></div>;
        }) : <div className="rw-line muted"><span className="rw-no" /><span className="rw-src">Loading the COBOL…</span></div>}
      </pre>
    </section>
  );
}

/* ----------------------------------------------------------------- Java */

function JavaPane({ state, view, onView }: { state: State; view: 'file' | 'changes'; onView: (v: 'file' | 'changes') => void }) {
  const box = useRef<HTMLPreElement>(null);
  const text = useMemo(() => stripFence(state.java), [state.java]);
  const lines = useMemo(() => text.split('\n'), [text]);
  const seen = useRef(0);
  const firstNew = seen.current;
  useEffect(() => { seen.current = lines.length; });
  const typing = state.step === 'writing' || state.step === 'fixing';
  useEffect(() => { if (typing && box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines.length, typing]);
  const canDiff = !!state.before && state.pass > 0 && !typing;
  const fileName = /class\s+(\w+)/.exec(text)?.[1] ?? 'Main';
  return (
    <section className="rw-pane java">
      <div className="rw-pane-head">
        <span>{fileName}.java{state.pass > 0 ? ` · pass ${state.pass}${state.fixReason ? ` (${state.fixReason === 'compile' ? 'javac' : 'diff'} fix)` : ''}` : ''}</span>
        <span className="rw-pane-tools">
          {canDiff && <button type="button" className={`wr-link small${view === 'changes' ? ' on' : ''}`} onClick={() => onView(view === 'changes' ? 'file' : 'changes')}>{view === 'changes' ? 'show file' : 'show changes'}</button>}
          {state.step === 'writing' ? 'Nemotron is writing' : state.step === 'fixing' ? 'Nemotron is rewriting' : state.step === 'compiling' ? 'javac' : `${lines.length} lines`}
        </span>
      </div>
      {canDiff && view === 'changes' ? <FixDiff before={stripFence(state.before!)} after={text} /> : (
        <pre ref={box} className="rw-code">
          {lines.map((t, i) => (
            <div key={i} className={`rw-line${i >= firstNew && typing ? ' fresh' : ''}`}><span className="rw-no">{i + 1}</span><span className="rw-src">{tint(t)}</span></div>
          ))}
          {typing && <span className="rw-cursor" aria-hidden>▍</span>}
        </pre>
      )}
    </section>
  );
}

function FixDiff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => hunks(diffLines(before, after)), [before, after]);
  const changed = parts.reduce((n, h) => n + h.filter((l) => l.kind !== 'same').length, 0);
  return (
    <pre className="rw-code rw-diff">
      {changed === 0 && <div className="rw-line muted"><span className="rw-no" /><span className="rw-src">No line changed.</span></div>}
      {parts.map((h, i) => (
        <div key={i} className="rw-hunk">
          {h.map((l: DiffLine, k) => (
            <div key={k} className={`rw-line ${l.kind}`}><span className="rw-no">{l.kind === 'del' ? '−' : l.kind === 'add' ? '+' : l.no}</span><span className="rw-src">{tint(l.text)}</span></div>
          ))}
        </div>
      ))}
    </pre>
  );
}

const KW = /\b(package|import|public|private|protected|final|static|class|void|return|new|if|else|for|while|throws?|try|catch|finally|this|null|true|false|int|long|double|boolean|char|byte|var|switch|case|default|break|continue)\b/g;
/** Monochrome syntax tint: keywords, strings and comments get a shade, nothing else. */
function tint(line: string): ReactNode {
  if (/^\s*(\/\/|\/\*|\*)/.test(line)) return <span className="c">{line}</span>;
  const out: ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*")|(\/\/.*$)/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  const words = (str: string) => {
    const bits: ReactNode[] = [];
    let l = 0;
    for (const w of str.matchAll(KW)) { if (w.index! > l) bits.push(str.slice(l, w.index)); bits.push(<span key={k++} className="k">{w[0]}</span>); l = w.index! + w[0].length; }
    if (l < str.length) bits.push(str.slice(l));
    return bits;
  };
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(...words(line.slice(last, m.index)));
    out.push(<span key={k++} className={m[1] ? 's' : 'c'}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(...words(line.slice(last)));
  return out.length ? out : ' ';
}

/* -------------------------------------------------------------- results */

const CATEGORY: Record<string, string> = { formatting: 'formatting', rounding: 'rounding', noise: 'noise', logic: 'logic' };

function Results({ state, overall }: { state: State; overall?: number }) {
  const showCompile = state.compileError && (state.step === 'compiling' || state.step === 'fixing' || state.step === 'compiled');
  if (!showCompile && !state.runs.length && !state.diffs.length) return null;
  const mismatches = state.diffs.flatMap((d) => d.mismatches.map((m) => ({ ...m, scenario: d.scenario })));
  return (
    <section className="rw-results">
      {showCompile && (
        <div className="rw-block">
          <div className="rw-pane-head"><span>javac</span><span>{state.step === 'fixing' ? 'Nemotron is fixing it' : state.step === 'compiled' ? 'fixed' : 'rejected'}</span></div>
          <pre className="rw-log">{state.compileError}</pre>
        </div>
      )}
      {state.runs.length > 0 && (
        <div className="rw-block">
          <div className="rw-pane-head"><span>Sandbox scenarios</span><span>{state.runs.length} run</span></div>
          <ul className="rw-runs">
            {state.runs.map((r) => {
              const d = state.diffs.find((x) => x.scenario === r.scenario);
              const rcBad = r.rc !== r.expectedRc;
              return (
                <li key={r.scenario} className={d ? (d.mismatches.length === 0 && !rcBad ? 'match' : 'mismatch') : rcBad ? 'fail' : 'ok'}>
                  <span>{r.scenario}</span>
                  <em>{d ? (d.mismatches.length === 0 && !rcBad ? 'matches COBOL' : `${Math.round(d.matchRate * 100)}% · ${d.mismatches.length} ${d.mismatches.length === 1 ? 'line differs' : 'lines differ'}`) : rcBad ? `rc ${r.rc}, COBOL ${r.expectedRc}` : `ran · ${r.ms} ms`}</em>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {state.diffs.length > 0 && (
        <div className="rw-block">
          <div className="rw-pane-head"><span>Output vs COBOL</span><span className="rw-rate">{overall !== undefined ? `${Math.round(overall * 100)}% of lines match` : ''}</span></div>
          {mismatches.length === 0 ? <p className="rw-note">Every compared line matches.</p> : (
            <table className="rw-mismatch">
              <tbody>
                {mismatches.slice(0, 14).map((m, i) => (
                  <tr key={i}><td>{m.scenario}</td><td>{m.line === 0 ? 'exit code' : `line ${m.line}`}</td><td className="old" title={m.old}>{m.old === '' ? '(no line)' : m.old}</td><td className="new" title={m.new}>{m.new === '' ? '(no line)' : m.new}</td><td className="cat">{CATEGORY[m.category] ?? m.category}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {mismatches.length > 14 && <p className="rw-note">{mismatches.length - 14} more.</p>}
          <p className="rw-note">Old behaviour is the default truth. Differences that nothing in the code or knowledge base settles become a question for the owner; see Watch it work.</p>
        </div>
      )}
    </section>
  );
}
