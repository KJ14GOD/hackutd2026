import { useEffect, useMemo, useRef, useState } from 'react';
import type { Finding, PackResult, Part2, Question } from '../../../services/reader/src/contract';
import type { ReadEvent, ReadRun } from '../server/readTypes';
import { LogPanel, Skeleton } from './RunChapter';

type State =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'reading'; mode: 'live' | 'replay'; stage: string; results: PackResult[]; total: number; lines: string[] }
  | { status: 'ready'; run: ReadRun; lines: string[] }
  | { status: 'error'; message: string; lines: string[] };

const MAX_LINES = 600;
const KIND_LABEL: Record<string, string> = {
  rule: 'Rule', defect: 'Suspected bug', 'edge-value': 'Edge value', 'coverage-gap': 'Unreached code', 'missed-connection': 'Missed link', mismatch: 'Mismatch', connection: 'Link',
};

/** How urgent a program's read is: blocking questions and high-confidence bugs first. */
const weight = (r: PackResult) => r.questions.filter((q) => q.blocks !== 'none').length * 3
  + r.findings.filter((f) => f.kind === 'defect' && f.confidence === 'high').length * 2 + r.questions.length;

/** Step 4: Nemotron reads each program (Part 2). Every claim cites lines you can open. */
export function ReadChapter({ title, line, source }: { title: string; line: string; source: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [open, setOpen] = useState<string | null>(null);
  const stream = useRef<EventSource | null>(null);

  function start(mode: 'live' | 'replay') {
    stream.current?.close();
    let results: PackResult[] = [];
    let lines: string[] = [];
    let stage = 'Starting';
    let total = 0;
    setState({ status: 'reading', mode, stage, results, total, lines });
    const es = new EventSource(`/api/read/stream?source=${encodeURIComponent(source)}&mode=${mode}`);
    stream.current = es;
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as ReadEvent;
      if (e.type === 'token') return; // this page shows finished results; the war room shows the text as it's written
      if (e.type === 'done') { es.close(); setState({ status: 'ready', run: e.run, lines }); return; }
      if (e.type === 'error') { es.close(); setState({ status: 'error', message: e.message, lines }); return; }
      if (e.type === 'stage') { stage = e.message; lines = [...lines, `— ${e.message}`]; }
      if (e.type === 'log') lines = [...lines, e.line].slice(-MAX_LINES);
      if (e.type === 'result') { results = [...results, e.result]; total = e.total; stage = `${e.done} of ${e.total} programs read`; }
      setState({ status: 'reading', mode, stage, results, total, lines });
    };
    es.onerror = () => { es.close(); setState((s) => (s.status === 'reading' ? { status: 'error', message: 'Lost the connection to the dev server', lines: s.lines } : s)); };
  }

  // Loads the latest saved read for this codebase; the stream is an external connection to close.
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    fetch(`/api/read?source=${encodeURIComponent(source)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ReadRun>) : null))
      .then((run) => { if (alive) setState(run ? { status: 'ready', run, lines: [] } : { status: 'empty' }); })
      .catch(() => { if (alive) setState({ status: 'empty' }); });
    return () => { alive = false; stream.current?.close(); };
  }, [source]);

  const busy = state.status === 'reading' || state.status === 'loading';
  const part2 = state.status === 'ready' ? state.run.part2 : null;
  const results = state.status === 'reading' ? state.results : part2?.results ?? [];
  const sorted = useMemo(() => [...results].sort((a, b) => weight(b) - weight(a) || a.program.localeCompare(b.program)), [results]);

  return (
    <main className="page-scroll">
      <article className="page run-page">
        <header className="page-head">
          <div>
            <div className="chapter-num">Step 04</div>
            <h1>{title}</h1>
            <p>{line}</p>
          </div>
          <div className="read-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => start('replay')} title="Reads the saved Nemotron answers again, with no network">Replay saved</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => start('live')} title="Calls Nemotron for every program whose pack changed">
              {state.status === 'reading' && state.mode === 'live' ? 'Reading…' : 'Read with Nemotron'}
            </button>
          </div>
        </header>

        {state.status === 'ready' && <Stats run={state.run} />}
        {state.status === 'reading' && <p className="read-stage">{state.stage}</p>}
        {state.status === 'error' && <p className="signin-error" role="alert">{state.message}</p>}
        {state.status === 'loading' && <Skeleton />}
        {state.status === 'empty' && <p className="map-hint">Nothing read yet for this codebase. “Read with Nemotron” calls the model for every program (about 10 minutes the first time); after that, “Replay saved” brings it back in a second.</p>}
        {state.status === 'reading' && <LogPanel lines={state.lines} live />}

        {sorted.length > 0 && (
          <section className="section">
            <div className="section-head"><h2>Programs</h2><span>Most urgent first: blocking questions, then high-confidence bugs. Click a program; click any line number to see the COBOL.</span></div>
            <div className="section-body run-list">
              {sorted.map((r) => <ProgramRead key={r.program} r={r} source={source} open={open === r.program} onToggle={() => setOpen(open === r.program ? null : r.program)} />)}
              {state.status === 'reading' && state.total > results.length && <div className="run-row sk-row"><span className="sk sk-name" /><div className="run-scenarios"><span className="sk sk-chip" /><span className="sk sk-chip" /></div></div>}
            </div>
          </section>
        )}

        {part2 && <Across part2={part2} source={source} />}
        {part2 && <Honest part2={part2} />}
        {state.status !== 'reading' && 'lines' in state && state.lines.length > 0 && <LogPanel lines={state.lines} />}
      </article>
    </main>
  );
}

function Stats({ run }: { run: ReadRun }) {
  const r = run.part2.results;
  const count = (k: string) => r.reduce((n, x) => n + x.findings.filter((f) => f.kind === k).length, 0);
  const links = r.reduce((n, x) => n + x.coverage.connections, 0);
  const explained = r.reduce((n, x) => n + x.coverage.explained, 0);
  return (
    <>
      <dl className="map-stats run-stats">
        <div><dt>Programs read</dt><dd>{r.length}</dd></div>
        <div><dt>Links explained</dt><dd>{explained}/{links}</dd></div>
        <div><dt>Rules</dt><dd>{count('rule')}</dd></div>
        <div><dt>Suspected bugs</dt><dd>{count('defect')}</dd></div>
        <div><dt>Questions</dt><dd>{r.reduce((n, x) => n + x.questions.length, 0)}</dd></div>
        <div><dt>Thrown out</dt><dd>{run.part2.dropped.length}</dd></div>
      </dl>
      <p className="read-meta">
        {run.mode === 'live' ? 'Read live' : 'Replayed'} {new Date(run.startedAt).toLocaleString()} · {(run.ms / 1000).toFixed(run.ms < 10000 ? 1 : 0)} s · {run.networkCalls} Nemotron calls · {run.part2.model}
      </p>
    </>
  );
}

type Tab = 'questions' | 'findings' | 'links' | 'edges';

function ProgramRead({ r, source, open, onToggle }: { r: PackResult; source: string; open: boolean; onToggle: () => void }) {
  const [tab, setTab] = useState<Tab>('questions');
  const bugs = r.findings.filter((f) => f.kind === 'defect');
  const rules = r.findings.filter((f) => f.kind === 'rule');
  const blocking = r.questions.filter((q) => q.blocks !== 'none').length;
  const tabs: [Tab, string, number][] = [
    ['questions', 'Questions', r.questions.length],
    ['findings', 'Rules & bugs', rules.length + bugs.length + r.findings.filter((f) => ['missed-connection', 'mismatch'].includes(f.kind)).length],
    ['links', 'Links', r.coverage.connections],
    ['edges', 'Edge values & gaps', r.findings.filter((f) => f.kind === 'edge-value' || f.kind === 'coverage-gap').length],
  ];
  return (
    <div className={open ? 'run-row open' : 'run-row'}>
      <button type="button" className="run-head" onClick={onToggle} aria-expanded={open}>
        <b>{r.program}</b>
        <span className="run-job">{r.questions.length} questions{blocking ? ` · ${blocking} blocking` : ''} · {bugs.length} bugs · {rules.length} rules</span>
        <span className="run-cov">{r.coverage.explained}/{r.coverage.connections} links explained</span>
      </button>
      {open && (
        <div className="read-body">
          <div className="read-tabs" role="tablist">
            {tabs.map(([id, label, n]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'read-tab on' : 'read-tab'} onClick={() => setTab(id)}>
                {label}<span>{n}</span>
              </button>
            ))}
          </div>
          {tab === 'questions' && (r.questions.length ? r.questions.map((q) => <QuestionItem key={q.id} q={q} source={source} />) : <p className="read-none">No questions: the code settled everything Nemotron looked at.</p>)}
          {tab === 'findings' && <Findings list={r.findings.filter((f) => ['defect', 'rule', 'missed-connection', 'mismatch'].includes(f.kind))} source={source} />}
          {tab === 'links' && <Findings list={r.findings.filter((f) => f.kind === 'connection').sort((a, b) => Number(a.ref?.slice(1)) - Number(b.ref?.slice(1)))} source={source} />}
          {tab === 'edges' && <Findings list={r.findings.filter((f) => f.kind === 'edge-value' || f.kind === 'coverage-gap')} source={source} />}
        </div>
      )}
    </div>
  );
}

function QuestionItem({ q, source }: { q: Question; source: string }) {
  return (
    <div className="read-item">
      <div className="read-line">
        <span className={`read-kind ${q.blocks !== 'none' ? 'hot' : ''}`}>{q.blocks === 'none' ? 'Question' : `Blocks ${q.blocks}`}</span>
        <span className="read-text">{q.text}</span>
      </div>
      <div className="read-options">{q.options.map((o) => <span key={o}>{o}</span>)}</div>
      <Cites refs={q.evidence} source={source} />
    </div>
  );
}

function Findings({ list, source }: { list: Finding[]; source: string }) {
  if (!list.length) return <p className="read-none">Nothing here.</p>;
  return <>{list.map((f, i) => (
    <div key={i} className="read-item">
      <div className="read-line">
        <span className={`read-kind ${f.kind === 'defect' || f.kind === 'mismatch' ? 'hot' : ''}`}>{f.kind === 'connection' ? f.ref : KIND_LABEL[f.kind] ?? f.kind}</span>
        <span className="read-text">{f.summary}</span>
        <span className={`read-conf c-${f.confidence}`}>{f.confidence}</span>
      </div>
      <Cites refs={f.evidence} source={source} />
    </div>
  ))}</>;
}

interface CodeLines { path: string; from: number; to: number; lines: { no: number; text: string }[] }

/** Line-number chips; clicking one shows those lines of COBOL, so any claim can be checked by eye. */
function Cites({ refs, source }: { refs: string[]; source: string }) {
  const [shown, setShown] = useState<string | null>(null);
  const [code, setCode] = useState<CodeLines | 'error' | null>(null);
  function toggle(ref: string) {
    if (shown === ref) { setShown(null); return; }
    setShown(ref);
    setCode(null);
    fetch(`/api/code?source=${encodeURIComponent(source)}&ref=${encodeURIComponent(ref)}`)
      .then((r) => (r.ok ? (r.json() as Promise<CodeLines>) : Promise.reject()))
      .then(setCode)
      .catch(() => setCode('error'));
  }
  return (
    <div className="read-cites">
      <div>{refs.map((ref) => (
        <button key={ref} type="button" className={shown === ref ? 'cite on' : 'cite'} onClick={() => toggle(ref)}>{ref.split('/').pop()}</button>
      ))}</div>
      {shown && (
        <pre className="read-code">{code === null ? 'Loading…' : code === 'error' ? 'Couldn’t load those lines.' : code.lines.map((l) => (
          <span key={l.no} className={l.no >= code.from && l.no <= code.to ? 'hit' : ''}>{String(l.no).padStart(5)}  {l.text || ' '}</span>
        ))}</pre>
      )}
    </div>
  );
}

/** Shared files: what Nemotron found comparing the programs that use them, plus what code checks found. */
function Across({ part2, source }: { part2: Part2; source: string }) {
  const [all, setAll] = useState(false);
  const nemotron = part2.crossProgram.filter((f) => /^[A-Z0-9_]+: /.test(f.summary));
  const code = part2.crossProgram.filter((f) => !/^[A-Z0-9_]+: /.test(f.summary));
  return (
    <section className="section">
      <div className="section-head"><h2>Across programs</h2><span>{nemotron.length} from Nemotron comparing programs that share a file, {code.length} from code checks (data read but never written here, or written but never read).</span></div>
      <div className="section-body">
        <Findings list={nemotron} source={source} />
        {all ? <Findings list={code} source={source} /> : <button type="button" className="btn" onClick={() => setAll(true)}>Show the {code.length} code checks</button>}
      </div>
    </section>
  );
}

/** What nobody could confirm, and what was thrown out: shown, not hidden. */
function Honest({ part2 }: { part2: Part2 }) {
  const [show, setShow] = useState(false);
  const kinds = part2.notVerified.reduce<Record<string, number>>((m, n) => ({ ...m, [n.kind]: (m[n.kind] ?? 0) + 1 }), {});
  const reasons = part2.dropped.reduce<Record<string, number>>((m, d) => ({ ...m, [d.reason]: (m[d.reason] ?? 0) + 1 }), {});
  return (
    <section className="section">
      <div className="section-head">
        <h2>Not verified &amp; thrown out</h2>
        <span>{kinds.unresolved ?? 0} open map questions, {kinds['never-fired'] ?? 0} links that never fired, {kinds['never-ran'] ?? 0} programs or paragraphs that never ran. {part2.dropped.length} findings thrown out ({Object.entries(reasons).map(([k, n]) => `${n} ${k.replace('-', ' ')}`).join(', ')}).</span>
      </div>
      <div className="section-body">
        <button type="button" className="btn" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show the list'}</button>
        {show && (
          <pre className="run-log read-honest">{[
            ...part2.notVerified.map((n) => `${n.kind.padEnd(12)} ${n.ref}`),
            '',
            ...part2.dropped.map((d) => `dropped      ${d.program}: ${d.reason}: ${d.detail}`),
          ].join('\n')}</pre>
        )}
      </div>
    </section>
  );
}
