import { useEffect, useRef, useState } from 'react';
import type { Pass1 } from './graphModel';
import type { Runtime } from '../../../services/runtime/src/types';
import type { ReadRun } from '../server/readTypes';
import type { HarnessFrame, HarnessJob, HarnessQuestion } from '../server/harnessTypes';
import {
  CLASS_LABEL, CUTOVER_NOTE, CUTOVER_STAGES, DEFAULT_THRESHOLD, caption, causeTriage, chartGeometry, isAnswered, isOpen, normalizeList, normalizeShadow, pipeline, questionsFor, trafficSplit, triage,
  type CutoverStage, type Question, type RewriteListEntry, type RootCause, type ShadowResult, type StageRow,
} from './shadowRunModel';
import './shadowrun.css';

type Person = { id: string; name: string; title: string };
type Harness =
  | { status: 'connecting' }
  | { status: 'live'; jobs: Map<string, HarnessJob>; questions: Map<string, HarnessQuestion>; people: Map<string, Person> }
  | { status: 'error'; message: string };
type Shadow =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; result: ShadowResult }
  | { status: 'error'; message: string };
/** What the rewrite stream says while a rerun is in flight. */
type Progress = { stage: string; pass?: number; runs: { scenario: string; ok: boolean }[] };

/** Frames on /api/rewrite/stream (services/rewrite). Only the fields this chapter reads. */
type RewriteEvent =
  | { type: 'stage'; stage: string; message: string }
  | { type: 'token'; text: string; pass: number }
  | { type: 'compile_error'; text: string; pass: number }
  | { type: 'fix_pass'; pass: number; reason: string }
  | { type: 'compiled'; pass: number }
  | { type: 'run'; scenario: string; rc: number; expectedRc: number }
  | { type: 'diff'; scenario: string; matchRate: number }
  | { type: 'done'; result: unknown }
  | { type: 'error'; message: string };

/** The step number comes from the URL, so reordering the steps never leaves a stale label here. */
const stepLabel = () => `Step ${String(Number(new URLSearchParams(window.location.search).get('chapter')) || 7).padStart(2, '0')}`;

/** The rewrite shadows the COBOL. One thing at a time: how closely it matches, the one question that
 * needs a person, and the cutover. Everything here is real: the map, the sandbox run, the Part 2 read,
 * the harness questions, and the rewrite's line-by-line diff. A program without a rewrite has no number. */
export function ShadowRunChapter({ title, line, source }: { title: string; line: string; source: string }) {
  const [pass1, setPass1] = useState<Pass1 | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [read, setRead] = useState<ReadRun | null>(null);
  const [harness, setHarness] = useState<Harness>({ status: 'connecting' });
  const [shadow, setShadow] = useState<Shadow>({ status: 'loading' });
  const [rewritten, setRewritten] = useState<{ threshold: number | null; programs: RewriteListEntry[] }>({ threshold: null, programs: [] });
  const [picked, setPicked] = useState<string | null>(null);
  const [cutover, setCutover] = useState<Record<string, CutoverStage>>({});
  const [posting, setPosting] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);

  // The three saved results for this codebase. Each is optional; the trail shows what is missing.
  useEffect(() => {
    let live = true;
    setPass1(null);
    setRuntime(null);
    setRead(null);
    const get = <T,>(path: string, set: (v: T | null) => void) =>
      fetch(`${path}?source=${encodeURIComponent(source)}`)
        .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
        .then((v) => { if (live) set(v); })
        .catch(() => { if (live) set(null); });
    void get<Pass1>('/api/graph', setPass1);
    void get<Runtime>('/api/runtime', setRuntime);
    void get<ReadRun>('/api/read', setRead);
    return () => { live = false; };
  }, [source]);

  // The live harness feed: a snapshot, then every job and question change. An external connection to close.
  useEffect(() => {
    const es = new EventSource('/api/harness/stream');
    setHarness({ status: 'connecting' });
    es.onmessage = (msg) => {
      const f = JSON.parse(msg.data) as HarnessFrame;
      if (f.type === 'error') es.close();
      setHarness((h) => {
        if (f.type === 'error') return { status: 'error', message: f.message };
        if (f.type === 'snapshot') {
          return {
            status: 'live',
            jobs: new Map(f.jobs.map((j) => [j.id, j])),
            questions: new Map(f.questions.map((q) => [q.id, q])),
            people: new Map(f.people.map((p) => [p.id, p])),
          };
        }
        if (h.status !== 'live') return h;
        if (f.type === 'job') return { ...h, jobs: new Map(h.jobs).set(f.job.id, f.job) };
        if (f.type === 'question') return { ...h, questions: new Map(h.questions).set(f.question.id, f.question) };
        return h; // events feed the war room, not this chapter
      });
    };
    es.onerror = () => setHarness((h) => (h.status === 'live' ? h : { status: 'error', message: 'The harness feed is not reachable. Is SpacetimeDB running?' }));
    return () => es.close();
  }, []);

  const programs = pass1 ? pass1.nodes.filter((n) => n.kind === 'program').map((n) => n.id.replace(/^prog:/, '')).sort() : [];
  const jobs = harness.status === 'live' ? [...harness.jobs.values()] : [];
  const questionRows = harness.status === 'live' ? [...harness.questions.values()] : [];
  const people = harness.status === 'live' ? harness.people : new Map<string, Person>();
  const waitingJobs = jobs.filter((j) => j.status === 'waiting').sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  // the interest calculator is the planted story (D-017), so it leads whenever it is waiting
  const program = picked
    ?? waitingJobs.find((j) => j.program === 'CBACT04C')?.program
    ?? waitingJobs[0]?.program
    ?? (programs.includes('CBACT04C') ? 'CBACT04C' : programs[0] ?? 'CBACT04C');
  const job = jobs.filter((j) => j.program === program).sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0];
  const jobTick = job?.updatedAtMs ?? 0;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [listTick, setListTick] = useState(0);

  // Which programs have a rewrite, and which are rerunning right now. Checked again whenever a harness job
  // moves (an answer starts a rerun) and when a watched rerun finishes. Only a JSON body counts: the
  // dev server's SPA fallback answers unknown routes with HTML.
  useEffect(() => {
    let live = true;
    fetch(`/api/rewrite/list?source=${encodeURIComponent(source)}`)
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('application/json') ? r.json() : null))
      .then((v: unknown) => { if (live && v) setRewritten(normalizeList(v)); })
      .catch(() => {});
    return () => { live = false; };
  }, [source, jobTick, listTick]);

  // Watch a rerun that is already in flight (after an answer). mode=watch only joins; the browser never
  // starts a run. With nothing running the server answers with an error frame and the stream closes.
  const running = rewritten.programs.some((p) => p.program === program && p.running) || job?.status === 'resuming';
  useEffect(() => {
    if (!running) { setProgress(null); return; }
    const es = new EventSource(`/api/rewrite/stream?source=${encodeURIComponent(source)}&program=${encodeURIComponent(program)}&mode=watch`);
    setProgress({ stage: 'Rewriting with the answer', runs: [] });
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as RewriteEvent;
      if (e.type === 'done') {
        es.close();
        const result = normalizeShadow(e.result);
        if (result) setShadow({ status: 'ready', result });
        setProgress(null);
        setListTick((t) => t + 1);
        return;
      }
      if (e.type === 'error') { es.close(); setProgress(null); return; }
      setProgress((p) => {
        const cur = p ?? { stage: '', runs: [] };
        if (e.type === 'stage') return { ...cur, stage: e.message || e.stage };
        if (e.type === 'fix_pass') return { ...cur, stage: `Fixing: ${e.reason}`, pass: e.pass };
        if (e.type === 'compile_error') return { ...cur, stage: 'Compile error, fixing', pass: e.pass };
        if (e.type === 'compiled') return { ...cur, stage: 'Compiled, running the scenarios', pass: e.pass };
        if (e.type === 'run') return { ...cur, stage: `Ran ${e.scenario}`, runs: [...cur.runs, { scenario: e.scenario, ok: e.rc === e.expectedRc }] };
        if (e.type === 'diff') return { ...cur, stage: `Diffed ${e.scenario}: ${(e.matchRate * 100).toFixed(0)}% match` };
        return cur;
      });
    };
    es.onerror = () => { es.close(); setProgress(null); };
    return () => es.close();
  }, [running, source, program]);

  // The rewrite's shadow diff for this program. Fetched again whenever its harness job moves, since an
  // answer makes the worker rerun the rewrite. The dev server's SPA fallback answers unknown routes with
  // HTML, so only a JSON body counts as a result.
  useEffect(() => {
    let live = true;
    setShadow({ status: 'loading' });
    fetch(`/api/rewrite?source=${encodeURIComponent(source)}&program=${encodeURIComponent(program)}`)
      .then(async (r) => {
        if (!r.headers.get('content-type')?.includes('application/json')) return { status: 'none' } as Shadow;
        const body: unknown = await r.json();
        if (!r.ok) return { status: 'none' } as Shadow;
        const result = normalizeShadow(body);
        return result ? ({ status: 'ready', result } as Shadow) : ({ status: 'none' } as Shadow);
      })
      .catch((err: Error) => ({ status: 'error', message: err.message }) as Shadow)
      .then((s) => { if (live) setShadow(s); });
    return () => { live = false; };
  }, [source, program, jobTick]);

  // what is known about this one program
  const node = pass1?.nodes.find((n) => n.id === `prog:${program}`);
  const links = pass1 ? pass1.edges.filter((e) => e.from === `prog:${program}` || e.to === `prog:${program}`).length : 0;
  const run = runtime?.programs.find((p) => p.program === program);
  const pack = read?.part2.results.find((r) => r.program === program);
  const qs = questionsFor(program, questionRows, people);
  const result = shadow.status === 'ready' ? shadow.result : null;
  const threshold = result?.threshold ?? rewritten.threshold ?? DEFAULT_THRESHOLD;
  const rate = result && result.status === 'done' ? result.matchRate : null;
  // lines where the old run is proven off count as matching; that is the rate the gate reads
  const eff = result && result.status === 'done' ? result.effectiveMatchRate : null;
  const stage = cutover[program] ?? 0;
  const unlocked = eff !== null && eff >= threshold;
  const rows = pipeline({
    mapped: !!node, links,
    ran: run?.status ?? 'none', scenarios: run?.scenarios.length ?? 0, runReason: run?.reason,
    read: !!pack, findings: pack?.findings.length ?? 0, questionsFound: pack?.questions.length ?? 0,
    rewrite: result ? (result.status === 'failed' ? 'failed' : 'done') : 'none', rewriteReason: result?.reason, compilePasses: result?.compilePasses,
    matchRate: rate, effectiveRate: eff, threshold,
    waiting: qs.open.length, answered: qs.answered.length,
    cutover: stage,
  });

  async function answer(q: Question, option: string) {
    setPosting(q.id);
    setPostError(null);
    try {
      const r = await fetch('/api/harness/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // answeredBy is the person id (their email), which is what the harness keys people by
        body: JSON.stringify({ questionId: q.raw.id, answer: option, answeredBy: q.raw.routeTo || q.raw.routeName || 'demo' }),
      });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? r.statusText);
    } catch (err) {
      setPostError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(null);
    }
  }

  // the whole codebase, by the furthest real stage each program reached (for "More")
  const ranSet = new Set(runtime?.programs.filter((p) => p.status === 'ran').map((p) => p.program));
  const readSet = new Set(read?.part2.results.map((r) => r.program));
  const askedSet = new Set(questionRows.filter(isOpen).map((q) => q.program));
  const answeredSet = new Set(questionRows.filter(isAnswered).map((q) => q.program));
  const across = { mapped: 0, ran: 0, read: 0, asked: 0, answered: 0 };
  for (const p of programs) {
    if (answeredSet.has(p)) across.answered++;
    else if (askedSet.has(p)) across.asked++;
    else if (readSet.has(p)) across.read++;
    else if (ranSet.has(p)) across.ran++;
    else across.mapped++;
  }

  const names = [...new Set(qs.open.map((q) => q.routeName))];
  const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.length} people`;
  const askLine = qs.open.length > 0
    ? `${qs.open.length} question${qs.open.length === 1 ? '' : 's'} waiting on ${who}${qs.answered.length ? ` · ${qs.answered.length} answered` : ''}.`
    : qs.answered.length > 0
      ? `Nobody left to ask; ${qs.answered.length} answer${qs.answered.length === 1 ? '' : 's'} locked in as tests.`
      : '';
  const shownRate = eff !== null && rate !== null && eff !== rate ? `${(eff * 100).toFixed(1)}% (${(rate * 100).toFixed(1)}% raw, before setting aside the lines where the old run is off)` : rate !== null ? `${(rate * 100).toFixed(1)}%` : '';
  const gateLine = stage > 0
    ? CUTOVER_NOTE[stage]
    : unlocked
      ? `Gate open: ${shownRate} of output lines match, above the ${Math.round(threshold * 100)}% line.`
      : rate === null
        ? `Opens once the rewrite's output matches at least ${Math.round(threshold * 100)}% of the COBOL's lines. No shadow run yet.`
        : `Locked. Opens at ${Math.round(threshold * 100)}% match; now ${shownRate}${qs.open.length ? `, with ${qs.open.length} waiting on a person` : ''}.`;
  const tri = result ? triage(result.mismatches) : null;

  return (
    <main className="page-scroll">
      <article className="page run-page sr-page">
        <header className="page-head">
          <div>
            <div className="chapter-num">{stepLabel()}</div>
            <h1>{title}</h1>
            <p>{line}</p>
          </div>
          <label className="sr-pick">
            Program
            <select value={program} onChange={(e) => setPicked(e.target.value)} aria-label="Program">
              {waitingJobs.length > 0 && (
                <optgroup label="Waiting on a person">
                  {waitingJobs.map((j) => <option key={j.id} value={j.program}>{j.program}</option>)}
                </optgroup>
              )}
              {rewritten.programs.length > 0 && (
                <optgroup label="Rewritten">
                  {rewritten.programs.map((p) => <option key={p.program} value={p.program}>{p.program} · {Math.round(p.matchRate * 100)}%</option>)}
                </optgroup>
              )}
              <optgroup label="Every program">
                {(programs.length ? programs : [program]).map((p) => <option key={p} value={p}>{p}</option>)}
              </optgroup>
            </select>
          </label>
        </header>

        <Trail rows={rows} />
        {harness.status === 'error' && <p className="map-hint">{harness.message}</p>}
        {postError && <p className="signin-error" role="alert">Couldn’t record the answer: {postError}</p>}

        {/* 1 · the match */}
        <section className="section wide sr-focus">
          <div className="sr-eyebrow">
            <span>Behavioral match with the COBOL original</span>
            <code>{program}{run ? ` · ${run.scenarios.length} scenario${run.scenarios.length === 1 ? '' : 's'}` : ''}{result?.model ? ` · ${result.model}` : ''}</code>
          </div>
          <MatchBody shadow={shadow} program={program} run={run} askLine={askLine} progress={progress} />
        </section>

        {/* 2 · the one question that needs a person */}
        <Questions key={program} open={qs.open} answered={qs.answered} busy={posting} state={harness.status} onAnswer={(q, o) => void answer(q, o)} />

        {/* 3 · cut over */}
        <section className="section">
          <div className="section-head">
            <h2>Cut over</h2>
            <span>1% → 10% → 100%, only once the gate is open. The old path keeps committing until 100%.</span>
          </div>
          <div className="section-body">
            <div className="sr-stages">
              {CUTOVER_STAGES.map((s) => (
                <button key={s} type="button" disabled={!unlocked} aria-pressed={stage >= s} className={stage >= s ? 'sr-stagebtn is-on' : 'sr-stagebtn'}
                  onClick={() => setCutover((c) => ({ ...c, [program]: s }))}>
                  {s}%
                </button>
              ))}
            </div>
            <TrafficSplit stage={stage} />
            <p className="sr-note">{gateLine}</p>
          </div>
        </section>

        {/* everything else, folded away */}
        <details className="sr-details">
          <summary>More: how differences were sorted, what each stage found, the whole codebase</summary>
          <div className="sr-details-body">
            <div className="sr-dblock">
              <h3>Triage</h3>
              {result && result.causes.length > 0 ? (
                <CauseBuckets causes={result.causes} />
              ) : tri ? (
                <>
                  <div className="sr-buckets">
                    <div className="sr-bucket"><b>{tri.asked}</b><span>Needs a person</span><small>unmade decision</small></div>
                    <div className="sr-bucket"><b>{tri.autoFixed}</b><span>Auto-fixed</span><small>defect, nobody asked</small></div>
                    <div className="sr-bucket is-dim"><b>{tri.filtered}</b><span>Filtered</span><small>noise, out of the diff</small></div>
                  </div>
                  <p className="sr-explain">{tri.byCategory.filter((c) => c.count).map((c) => `${c.count} ${c.category}`).join(' · ') || 'No differing lines.'}</p>
                </>
              ) : (
                <p className="sr-explain">No shadow run for {program} yet.</p>
              )}
            </div>
            <div className="sr-dblock">
              <h3>Stages for {program}</h3>
              <dl className="sr-facts">
                {rows.map((r) => <div key={r.id}><dt>{r.label}</dt><dd>{r.detail}</dd></div>)}
              </dl>
            </div>
            <div className="sr-dblock">
              <h3>Across the codebase</h3>
              <dl className="sr-across">
                <div><dt>Mapped</dt><dd>{programs.length}</dd></div>
                <div><dt>Ran</dt><dd>{ranSet.size}</dd></div>
                <div><dt>Read</dt><dd>{readSet.size}</dd></div>
                <div><dt>Rewritten</dt><dd>{rewritten.programs.length}</dd></div>
                <div><dt>Open questions</dt><dd>{questionRows.filter(isOpen).length}</dd></div>
                <div><dt>Answered</dt><dd>{questionRows.filter(isAnswered).length}</dd></div>
              </dl>
              <StageStack counts={across} total={programs.length} />
            </div>
          </div>
        </details>
      </article>
    </main>
  );
}

/* ------------------------------------------------------------------ */

/** Where this program is, in one quiet line. Details live under "More". */
function Trail({ rows }: { rows: StageRow[] }) {
  const firstActive = rows.findIndex((r) => r.state === 'active');
  return (
    <ol className="sr-trail" aria-label="Where this program is">
      {rows.map((r, i) => (
        <li key={r.id} className={`is-${r.state}`} title={r.detail}>
          <i className={i === firstActive ? 'pulse' : ''} />
          {r.label}
        </li>
      ))}
    </ol>
  );
}

function CauseBuckets({ causes }: { causes: RootCause[] }) {
  const t = causeTriage(causes);
  const waved = t.noise.length + t.baseline.length;
  return (
    <>
      <div className="sr-buckets">
        <div className="sr-bucket"><b>{t.waiting.length}</b><span>Needs a person</span><small>unsettled cause</small></div>
        <div className="sr-bucket"><b>{t.settled.length}</b><span>Settled</span><small>decided or accepted</small></div>
        <div className="sr-bucket is-dim"><b>{waved}</b><span>Waved off</span><small>{t.baseline.length ? `${t.baseline.length} old run off · ${t.noise.length} noise` : 'noise, out of the diff'}</small></div>
      </div>
      <p className="sr-explain">
        {causes.length} root cause{causes.length === 1 ? '' : 's'} behind {t.lines} differing line{t.lines === 1 ? '' : 's'}.
        {t.baseline.length ? ' "Old run off" means the legacy output is the one that is wrong, proven by code (sign decoding on ASCII), so those lines count as matching.' : ''}
        {' '}Nothing is fixed without an agreed invariant; a person settles the rest.
      </p>
    </>
  );
}

/** The number, or an honest reason there is none yet. */
function MatchBody({ shadow, program, run, askLine, progress }: { shadow: Shadow; program: string; run: Runtime['programs'][number] | undefined; askLine: string; progress: Progress | null }) {
  const [showDiff, setShowDiff] = useState(false);
  if (shadow.status === 'loading') return <p className="sr-focus-line sr-quiet">Looking for a rewrite of {program}…</p>;
  if (shadow.status === 'error') return <p className="signin-error">Couldn’t load the shadow run: {shadow.message}</p>;
  if (shadow.status === 'none') {
    return (
      <>
        <div className="sr-bigrow"><b className="sr-big is-none">—</b></div>
        <p className="sr-focus-line">
          Not rewritten yet. <a href="?chapter=5">Rewrite {program} in step 5</a>
          {run ? `; the Java then runs on the same ${run.scenarios.length} scenario${run.scenarios.length === 1 ? '' : 's'} the COBOL ran, and every differing output line shows up here.` : `, after it has run in the sandbox (step 3), and every differing output line will show up here.`}
        </p>
        {askLine && <p className="sr-focus-line sr-quiet">{askLine}</p>}
      </>
    );
  }
  const r = shadow.result;
  if (r.status === 'failed') {
    return (
      <>
        <div className="sr-bigrow"><b className="sr-big is-none">—</b></div>
        <p className="sr-focus-line">The rewrite didn’t run{r.reason ? `: ${r.reason}` : ''}. <a href="?chapter=5">Back to step 5</a>.</p>
      </>
    );
  }
  const diffs = r.mismatches;
  const causes = r.causes;
  const ct = causeTriage(causes);
  const clean = r.scenarios.filter((s) => s.outcome === 'match').length;
  const differing = r.scenarios.filter((s) => s.outcome !== 'match').map((s) => s.name);
  const scenarioLine = r.scenarios.length === 0
    ? ''
    : clean === r.scenarios.length
      ? `All ${r.scenarios.length} scenarios match the COBOL line for line.`
      : `${clean} of ${r.scenarios.length} scenarios match line for line; ${differing.length <= 3 ? differing.join(', ') : `${differing.length} scenarios`} differ${differing.length === 1 ? 's' : ''}${diffs.length ? ` in ${diffs.length} output line${diffs.length === 1 ? '' : 's'}` : ''}.`;
  const parts: string[] = [];
  if (ct.waiting.length) parts.push(`${ct.waiting.length} need${ct.waiting.length === 1 ? 's' : ''} the owner`);
  if (ct.baseline.length) parts.push(`${ct.baseline.length} ${ct.baseline.length === 1 ? 'is' : 'are'} the old run’s own error${ct.baseline.length === 1 ? '' : 's'}, set aside`);
  if (ct.noise.length) parts.push(`${ct.noise.length} noise`);
  if (ct.settled.length) parts.push(`${ct.settled.length} settled`);
  const causeLine = causes.length === 0 ? '' : ` ${causes.length} root cause${causes.length === 1 ? '' : 's'}: ${parts.join(', ')}.`;
  const differs = r.effectiveMatchRate !== r.matchRate;
  return (
    <>
      <div className="sr-bigrow">
        <BigNumber value={r.matchRate * 100} />
        <span className="sr-pct">%</span>
        {differs && (
          <span className="sr-eff">
            <b>{(r.effectiveMatchRate * 100).toFixed(1)}%</b> with the old run’s own errors set aside
            <small>the gate reads this one; the big number counts every differing line against the rewrite</small>
          </span>
        )}
      </div>
      {progress && (
        <p className="sr-progress" aria-live="polite">
          <i className="pulse" />
          {progress.stage}{progress.pass ? ` · pass ${progress.pass}` : ''}{progress.runs.length ? ` · ${progress.runs.length} scenario${progress.runs.length === 1 ? '' : 's'} run` : ''}
        </p>
      )}
      <TrendChart history={r.history} threshold={r.threshold} />
      <div className="sr-scen">
        {r.scenarios.map((s) => (
          <span key={s.name} className={`run-chip o-${s.outcome === 'match' ? 'ok' : s.outcome === 'error' ? 'error' : 'warning'}`} title={`${s.linesMatched} of ${s.linesCompared} output lines match`}>
            {s.label}<em>{s.linesCompared ? `${s.linesMatched}/${s.linesCompared}` : s.outcome}</em>
          </span>
        ))}
      </div>
      <p className="sr-focus-line">
        {scenarioLine}{causeLine}
        {askLine ? ` ${askLine}` : ''}
      </p>
      {causes.length > 0 && (
        <>
          <button type="button" className="sr-more" aria-expanded={showDiff} onClick={() => setShowDiff(!showDiff)}>
            {showDiff ? 'Hide the root causes' : `Show the root cause${causes.length === 1 ? '' : 's'}`}
          </button>
          {showDiff && (
            <ul className="sr-causes">
              {causes.map((c) => (
                <li key={c.id}>
                  <div className="sr-cause-head">
                    <b>{c.id}</b>
                    <span className="sr-chip">{c.category}</span>
                    <span>{c.lines} line{c.lines === 1 ? '' : 's'}{c.scenarios.length ? ` · ${c.scenarios.join(', ')}` : ''}</span>
                    <span className="sr-cause-state">{c.decision ? `decided: ${c.decision}` : c.accepted ? 'accepted' : c.category === 'noise' ? 'noise, ignored' : c.category === 'baseline' ? 'the old run is off here, waved off' : 'waiting on the owner'}</span>
                  </div>
                  <p className="sr-cause">{c.cause}</p>
                  {c.sample && (
                    <div className="sr-sample">
                      <code><small>COBOL</small>{c.sample.old || '(nothing)'}</code>
                      <code><small>Java</small>{c.sample.new || '(nothing)'}</code>
                      <small>{c.sample.scenario}{c.sample.line ? ` · line ${c.sample.line}` : ''}</small>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {causes.length === 0 && diffs.length > 0 && (
        <>
          <button type="button" className="sr-more" aria-expanded={showDiff} onClick={() => setShowDiff(!showDiff)}>
            {showDiff ? 'Hide the differences' : 'Show the differences'}
          </button>
          {showDiff && (
            <table className="sr-diff">
              <thead><tr><th>Scenario</th><th className="n">Line</th><th>COBOL</th><th>Java</th><th>Sorted as</th></tr></thead>
              <tbody>
                {diffs.slice(0, 40).map((m) => (
                  <tr key={m.id}>
                    <td>{m.scenario}</td>
                    <td className="n">{m.line}</td>
                    <td><code>{m.old}</code></td>
                    <td><code>{m.new}</code></td>
                    <td>{CLASS_LABEL[m.classification]} · {m.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {showDiff && diffs.length > 40 && <p className="sr-empty">and {diffs.length - 40} more</p>}
        </>
      )}
    </>
  );
}

/** Counts from the previous value to the next, so a jump reads as a jump. */
function BigNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const cur = useRef(value);
  useEffect(() => {
    const a = from.current;
    const b = value;
    if (a === b) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = cur.current = b;
      setShown(b);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const v = a + (b - a) * (1 - Math.pow(1 - k, 3));
      cur.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = cur.current;
    };
  }, [value]);
  return <b className="sr-big">{shown.toFixed(1)}</b>;
}

/** Step chart: SVG for the shapes (stretched to fit, strokes kept crisp), HTML for dots and text. */
function TrendChart({ history, threshold }: { history: { rate: number; label: string }[]; threshold: number }) {
  const g = chartGeometry(history, threshold);
  const last = g.points.length - 1;
  // the newest point sits at the right edge, where the tick labels live; its caption wins
  const underCaption = (y: number) => last > 0 && Math.abs(y - g.points[last].y) < 14;
  return (
    <div className="sr-chart" aria-hidden>
      {g.ticks.map((t) => <div key={t.value} className="sr-tick" style={{ top: `${t.y}%` }} />)}
      {g.ticks.filter((t) => !underCaption(t.y)).map((t) => <span key={t.value} className="sr-ticklabel" style={{ top: `${t.y}%` }}>{Math.round(t.value * 100)}%</span>)}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={g.area} className="sr-area" />
        <path d={g.line} className="sr-line" vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={100} y1={g.thresholdY} y2={g.thresholdY} className="sr-thrline" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="sr-thr" style={{ top: `${g.thresholdY}%` }}>cutover {Math.round(threshold * 100)}%</span>
      {g.points.map((p, i) => (
        <span key={i} className={i === last ? 'sr-dot is-last' : 'sr-dot'} style={{ left: `${p.x}%`, top: `${p.y}%` }} title={`${(p.rate * 100).toFixed(1)}% · ${p.label}`}>
          {i > 0 && <span className={i === last ? 'sr-cap is-end' : 'sr-cap'}>{caption(p.label)}</span>}
        </span>
      ))}
    </div>
  );
}

/** The next question on top; the rest and the answered ones fold away. */
function Questions({ open, answered, busy, state, onAnswer }: { open: Question[]; answered: Question[]; busy: string | null; state: Harness['status']; onAnswer: (q: Question, option: string) => void }) {
  const [showRest, setShowRest] = useState(false);
  const [showAnswered, setShowAnswered] = useState(false);
  const [next, ...rest] = open;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Next question</h2>
        <span>Only an unmade decision interrupts a person. The answer comes back here and becomes a test.</span>
      </div>
      <div className="section-body">
        {state === 'connecting' && <p className="sr-empty">Connecting to the harness…</p>}
        {state === 'error' && <p className="sr-empty">No questions: the harness feed is not reachable.</p>}
        {state === 'live' && !next && <p className="sr-empty">{answered.length ? 'Nobody left to ask.' : 'Nothing to ask for this program.'}</p>}
        {next && <QuestionCard q={next} busy={busy === next.id} onAnswer={(o) => onAnswer(next, o)} />}
        {rest.length > 0 && (
          <>
            <button type="button" className="sr-more" aria-expanded={showRest} onClick={() => setShowRest(!showRest)}>
              {showRest ? 'Hide the rest' : `${rest.length} more waiting`}
            </button>
            {showRest && rest.map((q) => <QuestionCard key={q.id} q={q} busy={busy === q.id} onAnswer={(o) => onAnswer(q, o)} />)}
          </>
        )}
        {answered.length > 0 && (
          <>
            <button type="button" className="sr-more" aria-expanded={showAnswered} onClick={() => setShowAnswered(!showAnswered)}>
              {showAnswered ? 'Hide answered' : `${answered.length} answered`}
            </button>
            {showAnswered && answered.map((q) => <AnsweredRow key={q.id} q={q} />)}
          </>
        )}
      </div>
    </section>
  );
}

function QuestionCard({ q, busy, onAnswer }: { q: Question; busy: boolean; onAnswer: (option: string) => void }) {
  return (
    <div className="sr-q">
      <div className="sr-qhead">
        <b>{q.routeName}</b>
        {q.routeTitle && <span>{q.routeTitle}</span>}
        <span className="sr-chip is-on">{q.statusLabel}</span>
      </div>
      <p className="sr-qtext">{q.text}</p>
      {q.routeWhy && <p className="sr-qwhy" title={q.routeWhy}>{q.routeWhy}</p>}
      <div className="sr-opts">
        {q.options.map((o) => (
          <button key={o} type="button" className="btn" disabled={busy} onClick={() => onAnswer(o)} title={`Record this answer as ${q.routeName}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function AnsweredRow({ q }: { q: Question }) {
  return (
    <div className="sr-a">
      <b>{q.answerText || q.statusLabel}</b>
      <span> · {q.answeredBy || q.routeName}</span>
      <p>{q.text}</p>
    </div>
  );
}

function TrafficSplit({ stage }: { stage: CutoverStage }) {
  const split = trafficSplit(stage);
  // keep a sliver visible at 1% so the canary reads on screen
  const javaW = stage === 0 ? 0 : Math.max(split.java * 100, 1.5);
  return (
    <div className="sr-split">
      <div className="sr-splitlabels">
        <span>Legacy COBOL <code>{Math.round(split.legacy * 100)}%</code></span>
        <span><code>{Math.round(split.java * 100)}%</code> Java rewrite</span>
      </div>
      <div className="sr-bar">
        <span className="legacy" style={{ width: `${100 - javaW}%` }} />
        <span className="java" style={{ width: `${javaW}%` }} />
      </div>
    </div>
  );
}

const STAGE_FILL: Record<string, string> = {
  mapped: 'var(--line-2)',
  ran: 'var(--text-3)',
  read: 'color-mix(in srgb, var(--text) 55%, transparent)',
  asked: 'color-mix(in srgb, var(--text) 78%, transparent)',
  answered: 'var(--text)',
};
const STAGE_LABEL: Record<string, string> = { mapped: 'Mapped only', ran: 'Ran in the sandbox', read: 'Read by Nemotron', asked: 'Waiting on a person', answered: 'Answered' };

function StageStack({ counts, total }: { counts: Record<string, number>; total: number }) {
  const t = Math.max(1, total);
  const order = ['mapped', 'ran', 'read', 'asked', 'answered'];
  return (
    <>
      <div className="sr-stack" aria-hidden>
        {order.map((k) => counts[k] > 0 && <span key={k} style={{ width: `${(counts[k] / t) * 100}%`, background: STAGE_FILL[k] }} />)}
      </div>
      <div className="sr-legend">
        {order.map((k) => <span key={k}><i style={{ background: STAGE_FILL[k] }} />{STAGE_LABEL[k]}<code>{counts[k]}</code></span>)}
      </div>
    </>
  );
}
