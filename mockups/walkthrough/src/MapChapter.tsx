import { useEffect, useMemo, useState } from 'react';
import { GraphCanvas } from './GraphCanvas';
import { buildModel, prettyData, type Marks, type P1Edge, type Pass1 } from './graphModel';
import type { Runtime } from '../../../services/runtime/src/types';
import type { PackResult } from '../../../services/reader/src/contract';
import type { ReadRun } from '../server/readTypes';

type Load = { status: 'loading' } | { status: 'ready'; pass1: Pass1 } | { status: 'error'; message: string };

const SYSTEM_LABEL: Record<string, string> = {
  programs: 'Programs it calls or hands off to', layouts: 'Copybooks', files: 'Files', db: 'DB2 tables', ims: 'IMS databases',
  mq: 'MQ queues', 'cics-queue': 'CICS queues', screen: 'Screens', network: 'Network', identity: 'Identity', time: 'Clock',
  batch: 'Run by', scheduler: 'Scheduled', external: 'External code',
};

const label = (id: string) => (id.startsWith('data:') ? prettyData(id) : id.replace(/^[a-z0-9-]+:/, ''));

/** Chapter 2: the real static map of the codebase, straight from Part 1. */
export function MapChapter({ title, line, source }: { title: string; line: string; source: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [reads, setReads] = useState<PackResult[]>([]);

  // Fetches the map from the dev server, which runs Part 1 on the chosen codebase.
  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    setSelected(null);
    fetch(`/api/graph?source=${encodeURIComponent(source)}`)
      .then(async (r) => (r.ok ? (r.json() as Promise<Pass1>) : Promise.reject(new Error((await r.json()).error ?? r.statusText))))
      .then((pass1) => { if (live) setLoad({ status: 'ready', pass1 }); })
      .catch((err: Error) => { if (live) setLoad({ status: 'error', message: err.message }); });
    // The last Runtime result, if step 3 has run; the map works without it.
    setRuntime(null);
    fetch(`/api/runtime?source=${encodeURIComponent(source)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Runtime>) : null))
      .then((r) => { if (live) setRuntime(r); })
      .catch(() => {});
    // The last Nemotron read (step 4), for the details panel.
    setReads([]);
    fetch(`/api/read?source=${encodeURIComponent(source)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ReadRun>) : null))
      .then((r) => { if (live && r) setReads(r.part2.results); })
      .catch(() => {});
    return () => { live = false; };
  }, [source]);

  const marks = useMemo<Marks | undefined>(() => runtime ? {
    links: new Map(runtime.edges.filter((e) => e.mark !== 'added').map((e) => [`${e.from}>${e.to}>${e.rel}`, e.mark as 'confirmed' | 'never-fired'])),
    ran: new Set(runtime.programs.filter((p) => p.status === 'ran').map((p) => `prog:${p.program}`)),
  } : undefined, [runtime]);
  const model = useMemo(() => (load.status === 'ready' ? buildModel(load.pass1, marks) : null), [load, marks]);
  const pass1 = load.status === 'ready' ? load.pass1 : null;

  return (
    <main className="map-page" key="map">
      <div className="map-title">
        <div className="chapter-num">Step 02</div>
        <h1>{title}</h1>
        <p>{line}</p>
        {pass1 && (
          <dl className="map-stats">
            <div><dt>Programs</dt><dd>{pass1.inventory.programs.length}</dd></div>
            <div><dt>Links</dt><dd>{pass1.edges.length.toLocaleString()}</dd></div>
            <div><dt>Open questions</dt><dd>{pass1.unresolved.length}</dd></div>
          </dl>
        )}
        {pass1 && selected && <Details id={selected} pass1={pass1} runtime={runtime} read={reads.find((r) => `prog:${r.program}` === selected)} onClose={() => setSelected(null)} />}
        {pass1 && pass1.inventory.programs.length === 0 && <p className="map-hint">No COBOL programs found in {source.replace(/^gh:/, '')}. Theseus maps COBOL, JCL and CICS today.</p>}
        {pass1 && !selected && pass1.inventory.programs.length > 0 && <p className="map-hint">Online programs sit on top, batch programs below, and the data they share sits between them. Click anything to see every link and the line of COBOL it came from.</p>}
        {load.status === 'error' && <p className="signin-error">Couldn’t build the map: {load.message}. Run <code>pnpm legacy:fetch</code> from the repo root.</p>}
      </div>
      <div className="map-canvas">
        {model ? <GraphCanvas model={model} selected={selected} onSelect={setSelected} /> : <div className="graph map-loading">{load.status === 'loading' ? 'Reading the code…' : ''}</div>}
      </div>
    </main>
  );
}

function Details({ id, pass1, runtime, read, onClose }: { id: string; pass1: Pass1; runtime: Runtime | null; read?: PackResult; onClose: () => void }) {
  // Runtime marks by evidence line, so each row can say whether its line ran.
  const markOf = (e: P1Edge) => runtime?.edges.find((m) => m.from === e.from && m.to === e.to && m.rel === e.rel && m.evidence === e.evidence)?.mark;
  const run = runtime?.programs.find((p) => `prog:${p.program}` === id);
  const node = pass1.nodes.find((n) => n.id === id);
  const out = pass1.edges.filter((e) => e.from === id);
  const into = pass1.edges.filter((e) => e.to === id);
  const questions = id.startsWith('prog:') ? pass1.unresolved.filter((u) => u.program === id.slice(5)) : [];
  const groups = new Map<string, P1Edge[]>();
  for (const e of out) {
    if (!groups.has(e.system)) groups.set(e.system, []);
    groups.get(e.system)!.push(e);
  }
  return (
    <section className="details" aria-label={`Details for ${label(id)}`}>
      <div className="details-head">
        <div>
          <b>{label(id)}</b>
          <span>{node?.kind === 'program' ? `${node.mode} program, ${(node.lines ?? 0).toLocaleString()} lines` : id.replace(/^data:/, '')}</span>
        </div>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      {node?.file && <div className="details-file">{node.file}</div>}
      {run && <div className="details-run">{run.status === 'ran'
        ? `Ran in the sandbox: ${run.scenarios.length} scenarios, ${run.paragraphs.total.length - run.paragraphs.neverRan.length} of ${run.paragraphs.total.length} paragraphs reached`
        : `Not run: ${run.reason}`}</div>}
      <div className="details-body">
        {read && <NemotronSummary read={read} />}
        {[...groups].map(([system, edges]) => (
          <div key={system} className="details-group">
            <h4>{SYSTEM_LABEL[system] ?? system} <span>{edges.length}</span></h4>
            {edges.map((e, i) => (
              <div key={i} className="details-row">
                <span className={`rel rel-${e.rel}`}>{e.rel}</span>
                <span className="details-target">{label(e.to)}{markOf(e) && <em className={`mark m-${markOf(e)}`}>{markOf(e) === 'confirmed' ? 'ran' : 'never ran'}</em>}</span>
                <span className="details-ev">{e.evidence.split('/').pop()}</span>
              </div>
            ))}
          </div>
        ))}
        {into.length > 0 && (
          <div className="details-group">
            <h4>Used by <span>{into.length}</span></h4>
            {into.map((e, i) => (
              <div key={i} className="details-row">
                <span className={`rel rel-${e.rel}`}>{e.rel}</span>
                <span className="details-target">{label(e.from)}{markOf(e) && <em className={`mark m-${markOf(e)}`}>{markOf(e) === 'confirmed' ? 'ran' : 'never ran'}</em>}</span>
                <span className="details-ev">{e.evidence.split('/').pop()}</span>
              </div>
            ))}
          </div>
        )}
        {questions.length > 0 && (
          <div className="details-group">
            <h4>Open questions <span>{questions.length}</span></h4>
            {questions.map((q, i) => (
              <div key={i} className="details-q">
                <b>{q.what}</b>: {q.token}
                {q.candidates && <span> could be {q.candidates.join(', ')}</span>}
                <span className="details-ev">{q.at.split('/').pop()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** What Nemotron said about this program in step 4: its questions first, then bugs, then rules. */
function NemotronSummary({ read }: { read: PackResult }) {
  const pick = [
    ...read.questions.map((q) => ({ kind: q.blocks === 'none' ? 'question' : `blocks ${q.blocks}`, text: q.text, at: q.evidence[0] })),
    ...read.findings.filter((f) => f.kind === 'defect' && f.confidence === 'high').map((f) => ({ kind: 'bug', text: f.summary, at: f.evidence[0] })),
    ...read.findings.filter((f) => f.kind === 'rule').map((f) => ({ kind: 'rule', text: f.summary, at: f.evidence[0] })),
  ].slice(0, 6);
  return (
    <div className="details-group">
      <h4>Nemotron read{' '}<span>{read.questions.length} questions · {read.findings.filter((f) => f.kind === 'defect').length} bugs · {read.findings.filter((f) => f.kind === 'rule').length} rules</span></h4>
      {pick.map((x, i) => (
        <div key={i} className="details-q">
          <b>{x.kind}</b>: {x.text}
          <span className="details-ev">{x.at?.split('/').pop()}</span>
        </div>
      ))}
    </div>
  );
}
