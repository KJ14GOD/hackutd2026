import { useEffect, useRef, useState } from 'react';
import type { ProgramRun, Runtime, RuntimeEvent, ScenarioResult } from '../../../services/runtime/src/types';

type Live = Map<string, { status: string; reason?: string; scenarios: ScenarioResult[] }>;
type State =
  | { status: 'loading' }
  | { status: 'running'; stage: string; programs: Live; lines: string[] }
  | { status: 'ready'; runtime: Runtime; lines: string[] }
  | { status: 'error'; message: string; lines: string[] };

/** Keeps the log panel light: the newest lines only. */
const MAX_LINES = 600;

const OUTCOME: Record<ScenarioResult['outcome'], string> = { ok: 'Finished', warning: 'Warnings', abend: 'Abended', error: 'Failed', timeout: 'Timed out' };
const short = (id: string) => id.replace(/^data:/, '').split('.').slice(3, 4)[0] ?? id.replace(/^[a-z0-9-]+:/, '');
const target = (id: string) => (id.startsWith('data:') ? short(id) || id.slice(5) : id.replace(/^[a-z0-9-]+:/, ''));

/** Step 3: runs each batch program for real in the GnuCOBOL sandbox and shows what happened. */
export function RunChapter({ title, line, source }: { title: string; line: string; source: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [open, setOpen] = useState<string | null>(null);
  const stream = useRef<EventSource | null>(null);

  function start() {
    stream.current?.close();
    const programs: Live = new Map();
    let lines: string[] = [];
    let stage = 'Starting the sandbox';
    setState({ status: 'running', stage, programs, lines });
    const es = new EventSource(`/api/runtime/stream?source=${encodeURIComponent(source)}`);
    stream.current = es;
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as RuntimeEvent;
      if (e.type === 'done') { es.close(); setState({ status: 'ready', runtime: e.runtime, lines }); return; }
      if (e.type === 'error') { es.close(); setState({ status: 'error', message: e.message, lines }); return; }
      if (e.type === 'stage') { stage = e.message; lines = [...lines, `— ${e.message}`]; }
      if (e.type === 'log') lines = [...lines, e.program ? `${e.program.padEnd(9)} ${e.line}` : e.line].slice(-MAX_LINES);
      if (e.type === 'program') {
        programs.set(e.program, { ...(programs.get(e.program) ?? { scenarios: [] }), status: e.status, reason: e.reason });
        if (e.status === 'running') stage = `Running ${e.program}`;
        if (e.status === 'skipped') lines = [...lines, `${e.program.padEnd(9)} skipped: ${e.reason}`];
      }
      if (e.type === 'scenario') programs.get(e.program)?.scenarios.push(e.scenario);
      setState({ status: 'running', stage, programs: new Map(programs), lines });
    };
    es.onerror = () => { es.close(); setState((s) => (s.status === 'running' ? { status: 'error', message: 'Lost the connection to the dev server', lines: s.lines } : s)); };
  }

  // Shows the last result for this codebase, or starts the first run; the stream is an external connection.
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    fetch(`/api/runtime?source=${encodeURIComponent(source)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Runtime>) : null))
      .then((runtime) => { if (!live) return; if (runtime) setState({ status: 'ready', runtime, lines: [] }); else start(); })
      .catch(() => { if (live) start(); });
    return () => { live = false; stream.current?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const runtime = state.status === 'ready' ? state.runtime : null;
  return (
    <main className="page-scroll">
      <article className="page run-page">
        <header className="page-head">
          <div>
            <div className="chapter-num">Step 03</div>
            <h1>{title}</h1>
            <p>{line}</p>
          </div>
          <button type="button" className="btn" disabled={state.status === 'running' || state.status === 'loading'} onClick={start}>
            {state.status === 'running' ? 'Running…' : 'Run again'}
          </button>
        </header>

        {runtime && (
          <dl className="map-stats run-stats">
            <div><dt>Programs run</dt><dd>{runtime.summary.ran}</dd></div>
            <div><dt>Links confirmed</dt><dd>{runtime.summary.confirmed}</dd></div>
            <div><dt>Never fired</dt><dd>{runtime.summary.neverFired}</dd></div>
            <div><dt>Found at run time</dt><dd>{runtime.summary.added}</dd></div>
          </dl>
        )}

        {state.status === 'error' && <p className="signin-error" role="alert">{state.message}</p>}
        {state.status === 'loading' && <Skeleton />}
        {state.status === 'running' && (
          <>
            <LiveRuns stage={state.stage} programs={state.programs} />
            <LogPanel lines={state.lines} live />
          </>
        )}
        {(state.status === 'ready' || state.status === 'error') && state.lines.length > 0 && <LogPanel lines={state.lines} />}

        {runtime && (
          <>
            <section className="section">
              <div className="section-head"><h2>Ran in the sandbox</h2><span>Scenarios come from each program’s own code. +N marks code a scenario reached that the normal run didn’t. Click a program for details.</span></div>
              <div className="section-body run-list">
                {runtime.programs.filter((p) => p.status === 'ran').map((p) => (
                  <ProgramRow key={p.program} run={p} runtime={runtime} open={open === p.program} onToggle={() => setOpen(open === p.program ? null : p.program)} />
                ))}
              </div>
            </section>
            <section className="section">
              <div className="section-head"><h2>Couldn’t run yet</h2><span>And why</span></div>
              <div className="section-body run-list">
                {runtime.programs.filter((p) => p.status !== 'ran').map((p) => (
                  <div key={p.program} className="run-skip">
                    <b>{p.program}</b><span>{p.reason}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </article>
    </main>
  );
}

/** Placeholder rows while the last result loads. */
function Skeleton() {
  return (
    <section className="section" aria-busy="true" aria-label="Loading">
      <div className="section-head"><span className="sk sk-title" /><span className="sk sk-line" /></div>
      <div className="section-body run-list">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="run-row sk-row">
            <span className="sk sk-name" />
            <div className="run-scenarios">{Array.from({ length: 5 }, (_, j) => <span key={j} className="sk sk-chip" />)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The sandbox's own output, newest at the bottom. Live mode follows new lines; afterwards it folds away. */
function LogPanel({ lines, live = false }: { lines: string[]; live?: boolean }) {
  const box = useRef<HTMLPreElement>(null);
  const [open, setOpen] = useState(live);
  // Keep the newest line in view while the run streams; scrolling is DOM state only the element has.
  useEffect(() => { if (live && box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines, live]);
  return (
    <section className="section">
      <div className="section-head">
        <h2>Sandbox log</h2>
        {live ? <span>Streaming from Docker</span> : <button type="button" className="btn" onClick={() => setOpen(!open)}>{open ? 'Hide' : `Show ${lines.length} lines`}</button>}
      </div>
      {(live || open) && (
        <div className="section-body">
          <pre ref={box} className="run-log">{lines.length ? lines.join('\n') : 'Waiting for the sandbox…'}{live && <span className="run-cursor" aria-hidden>▍</span>}</pre>
        </div>
      )}
    </section>
  );
}

function LiveRuns({ stage, programs }: { stage: string; programs: Live }) {
  return (
    <section className="section">
      <div className="section-head"><h2>Running</h2><span>{stage}</span></div>
      <div className="section-body run-list">
        {programs.size === 0 && Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="run-row sk-row"><span className="sk sk-name" /><div className="run-scenarios">{Array.from({ length: 5 }, (_, j) => <span key={j} className="sk sk-chip" />)}</div></div>
        ))}
        {[...programs].map(([name, p]) => (
          <div key={name} className="run-row live">
            <b>{name}</b>
            <span className="run-status">{p.status === 'running' ? 'Running…' : p.status === 'ran' ? 'Done' : p.status === 'skipped' ? 'Skipped' : 'Failed'}</span>
            <div className="run-scenarios">
              {p.scenarios.map((s) => <Chip key={s.name} s={s} />)}
              {p.status === 'running' && <span className="sk sk-chip" />}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Chip({ s }: { s: ScenarioResult }) {
  return (
    <span className={`run-chip o-${s.outcome}`} title={`${s.setup}. ${s.statementsRun.toLocaleString()} statements in ${s.ms} ms`}>
      {s.label}<em>{OUTCOME[s.outcome]}</em>
    </span>
  );
}

function ProgramRow({ run, runtime, open, onToggle }: { run: ProgramRun; runtime: Runtime; open: boolean; onToggle: () => void }) {
  const [pick, setPick] = useState(run.scenarios[0]?.name ?? '');
  const marks = runtime.edges.filter((e) => e.from === `prog:${run.program}` || e.to === `prog:${run.program}`);
  const ran = run.paragraphs.total.length - run.paragraphs.neverRan.length;
  const scenario = run.scenarios.find((s) => s.name === pick) ?? run.scenarios[0];
  return (
    <div className={open ? 'run-row open' : 'run-row'}>
      <button type="button" className="run-head" onClick={onToggle} aria-expanded={open}>
        <b>{run.program}</b>
        <span className="run-job">{run.job}{run.parm ? ` · PARM ${run.parm}` : ''}</span>
        <span className="run-cov">{run.paragraphs.total.length ? `${ran}/${run.paragraphs.total.length} paragraphs ran` : 'No paragraphs'}</span>
      </button>
      <div className="run-scenarios">
        {run.scenarios.map((s) => (
          <button key={s.name} type="button" className={`run-chip o-${s.outcome}${open && s.name === pick ? ' on' : ''}`}
            onClick={() => { setPick(s.name); if (!open) onToggle(); }} title={s.setup}>
            {s.label}<em>{OUTCOME[s.outcome]}</em>{s.newParagraphs.length > 0 && <em className="run-new">+{s.newParagraphs.length}</em>}
          </button>
        ))}
      </div>
      {open && scenario && (
        <div className="run-detail">
          <div className="run-col">
            <h4>{scenario.label} <span>{scenario.setup}</span></h4>
            <p className="run-facts">Return code {scenario.returnCode} · {scenario.statementsRun.toLocaleString()} statements · {scenario.ms} ms</p>
            {scenario.newParagraphs.length > 0 && <p className="run-note">Reached code the normal run didn’t: {scenario.newParagraphs.join(', ')}</p>}
            <pre className="run-out">{scenario.messages.join('\n') || '(printed nothing)'}</pre>
            {scenario.dbChanges && (
              <>
                <h4 className="run-gap">Table rows changed <span>{run.tables?.join(', ')}</span></h4>
                <pre className="run-out">{scenario.dbChanges.join('\n') || '(no rows left changed after the run)'}</pre>
              </>
            )}
            {run.synthesized.length > 0 && <p className="run-note">No sample data for {run.synthesized.join(', ')}, so Theseus built records from its layout and the values the code tests.</p>}
            {run.missingData.length > 0 && <p className="run-note">No sample data for {run.missingData.join(', ')}, so it started without them.</p>}
          </div>
          <div className="run-col">
            <h4>Links from the map <span>{marks.length}</span></h4>
            {marks.map((m, i) => (
              <div key={i} className="details-row">
                <span className={`mark m-${m.mark}`}>{m.mark === 'never-fired' ? 'never fired' : m.mark}</span>
                <span className="details-target">{m.rel} {target(m.from === `prog:${run.program}` ? m.to : m.from)}</span>
                <span className="details-ev">{m.evidence.split('/').pop()}</span>
              </div>
            ))}
            {run.paragraphs.neverRan.length > 0 && (
              <>
                <h4 className="run-gap">Never ran <span>{run.paragraphs.neverRan.length}</span></h4>
                <p className="run-never">{run.paragraphs.neverRan.join(', ')}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
