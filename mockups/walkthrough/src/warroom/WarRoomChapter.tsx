// Step 5: watch Nemotron read the codebase. Several programs are typed out at once; the COBOL lines
// the model cites light up as it writes them; Jev decides which program is on stage. Everything
// comes from the same /api/read/stream the Read chapter uses, paced client-side by the Engine.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Pass1 } from '../../../../services/segmenter/src/types';
import type { ReadEvent } from '../../server/readTypes';
import { Engine, ownFile, type Item, type Job } from './engine';
import { decideHero, decideHeroLive, decideNeedsHuman, decideNeedsHumanLive, type JevDecision } from './jev';
import { makeQueue } from './jevClient';
import { harnessLabel, isOpen, parseJson, programOf, questionsFor, statusLabel, useHarness, type HarnessState } from './harness';
import type { HarnessEvent, HarnessQuestion } from '../../server/harnessTypes';
import type { Connector } from '../../server/connectorTypes';
import { ConnectorIcon } from '../connectorIcons';
import './warroom.css';

type Mode = 'replay' | 'live';
type Phase = 'idle' | 'connecting' | 'reading' | 'done' | 'error';

interface CodeWindow { path: string; from: number; to: number; lines: { no: number; text: string }[] }

const LANES = 4;
const CHARS_PER_SECOND = 420;
/** Milliseconds per streamed chunk the server replays at, per speed button. */
const PACE: Record<number, number> = { 1: 40, 3: 12, 10: 3 };
const MAX_FEED = 160;
/** Live Jev calls in flight at once; the rest queue, the stand-in shows meanwhile. */
const jevQueue = makeQueue(3);

const KIND_LABEL: Record<string, string> = {
  rule: 'Rule', defect: 'Suspected bug', 'edge-value': 'Edge value', 'coverage-gap': 'Unreached code',
  'missed-connection': 'Missed link', mismatch: 'Mismatch', connection: 'Link',
};

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

const MODEL_LABEL = (model?: string) => {
  if (!model) return 'Nemotron';
  const m = /nemotron-([\w.-]+?)(?:-\d+b.*)?$/i.exec(model);
  return m ? `Nemotron ${m[1].replace(/-/g, ' ')}` : model;
};

export function WarRoomChapter({ source }: { source: string }) {
  const engine = useMemo(() => new Engine({ lanes: LANES, charsPerSecond: CHARS_PER_SECOND }), []);
  const [, bump] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<Mode>('replay');
  const [stage, setStage] = useState('');
  const [model, setModel] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeedState] = useState(1);
  const [paused, setPaused] = useState(false);
  const [hero, setHero] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<JevDecision[]>([]);
  const [feed, setFeed] = useState<(Item & { decision?: JevDecision })[]>([]);
  const [lineCounts, setLineCounts] = useState<Record<string, number>>({});
  const [files, setFiles] = useState<Record<string, string>>({});
  const [drawer, setDrawer] = useState<'programs' | 'feed' | 'jev' | 'agent'>('feed');
  const [side, setSide] = useState(false);
  const harness = useHarness();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  // Which sources the harness may consult; the pipeline skips any that are not connected.
  useEffect(() => {
    let alive = true;
    fetch('/api/connectors').then((r) => (r.ok ? (r.json() as Promise<Connector[]>) : [])).then((c) => { if (alive) setConnectors(c); }).catch(() => { /* the line is simply not shown */ });
    return () => { alive = false; };
  }, []);
  const harnessRef = useRef<HarnessState>(harness);
  harnessRef.current = harness;
  const stream = useRef<EventSource | null>(null);
  const heroTimer = useRef<number | undefined>(undefined);
  const heroRef = useRef<string | null>(null);
  const pinnedRef = useRef<string | null>(null);
  heroRef.current = hero;
  pinnedRef.current = pinned;

  // Program list and line counts come from the static map, so every program shows as queued at once.
  useEffect(() => {
    let alive = true;
    fetch(`/api/graph?source=${encodeURIComponent(source)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Pass1>) : null))
      .then((p) => {
        if (!alive || !p) return;
        const counts: Record<string, number> = {};
        const paths: Record<string, string> = {};
        const programs: string[] = [];
        for (const n of p.nodes) {
          if (n.kind !== 'program') continue;
          const id = n.id.replace(/^prog:/, '');
          programs.push(id);
          if (n.lines) counts[id] = n.lines;
          if (n.file) paths[id] = n.file;
        }
        setLineCounts(counts);
        setFiles(paths);
        engine.expect(programs.sort());
        bump((v) => v + 1);
      })
      .catch(() => { /* the list fills in from results instead */ });
    return () => { alive = false; };
  }, [source, engine]);

  /** A decision record is replaced in place when the real answer arrives for a stand-in. */
  const settle = useCallback((d: JevDecision) => {
    setDecisions((ds) => (ds.some((x) => x.id === d.id) ? ds.map((x) => (x.id === d.id ? d : x)) : [d, ...ds].slice(0, 200)));
    setFeed((f) => f.map((it) => (it.decision?.id === d.id ? { ...it, decision: d } : it)));
  }, []);

  // Jev picks the hero from whatever is being written right now. The stand-in answers at once and the
  // real model's answer replaces it a moment later; debounced so the stage does not thrash.
  const heroCall = useRef(0);
  const askHero = useCallback(() => {
    if (heroTimer.current !== undefined) return;
    heroTimer.current = window.setTimeout(() => {
      heroTimer.current = undefined;
      const reading = engine.all().filter((j) => j.status === 'reading');
      const current = heroRef.current ? engine.get(heroRef.current) : undefined;
      const candidates = current && !reading.includes(current) && current.status !== 'done' ? [...reading, current] : reading;
      const d = decideHero(candidates, heroRef.current, performance.now(), (p) => harnessLabel(harnessRef.current, p, Date.now()));
      if (!d) return;
      settle(d);
      if (!pinnedRef.current && !heroRef.current) setHero(d.choice);
      const call = ++heroCall.current;
      decideHeroLive(d).then((live) => {
        settle(live);
        // Only the newest call may move the stage; an older answer landing late is just recorded.
        if (call === heroCall.current && !pinnedRef.current) setHero(live.choice);
      });
    }, 600);
  }, [engine, settle]);

  // The engine is an external clock; subscribe once and coalesce its ticks into renders.
  useEffect(() => {
    let raf = 0;
    const unsub = engine.subscribe((e) => {
      if (e.type === 'item') {
        const needsHuman = e.item.kind === 'question' || (e.item.kind === 'finding' && e.item.finding.kind === 'defect')
          ? decideNeedsHuman(e.item, performance.now()) : undefined;
        if (e.item.kind === 'question' || (e.item.kind === 'finding' && e.item.finding.kind !== 'connection')) {
          setFeed((f) => [{ ...e.item, decision: needsHuman }, ...f].slice(0, MAX_FEED));
        }
        if (needsHuman) {
          settle(needsHuman);
          jevQueue(() => decideNeedsHumanLive(needsHuman)).then(settle);
        }
        askHero();
      }
      if (e.type === 'job' && e.job.status === 'reading' && !heroRef.current && !pinnedRef.current) setHero(e.job.program);
      if (e.type === 'job' && e.job.status === 'done' && e.job.program === heroRef.current) askHero();
      if (e.type === 'idle') setPhase((p) => (p === 'reading' ? 'done' : p));
      if (!raf) raf = window.requestAnimationFrame(() => { raf = 0; bump((v) => v + 1); });
    });
    return () => { unsub(); if (raf) window.cancelAnimationFrame(raf); };
  }, [engine, askHero, settle]);

  useEffect(() => () => { stream.current?.close(); engine.destroy(); }, [engine]);

  // A harness job changing state (paused for a person, answer landed) is a reason to re-pick the hero.
  const harnessSig = Object.values(harness.jobs).map((j) => `${j.program}:${j.status}:${j.updatedAtMs}`).join('|');
  useEffect(() => { if (harnessSig) askHero(); }, [harnessSig, askHero]);

  const start = useCallback((m: Mode) => {
    stream.current?.close();
    engine.reset();
    setHero(null); setPinned(null); setDecisions([]); setFeed([]); setError(null); setModel(undefined);
    setMode(m); setPhase('connecting'); setStage(m === 'live' ? 'Calling Nemotron' : 'Reading with Nemotron');
    engine.expect(Object.keys(lineCounts).sort());
    const es = new EventSource(`/api/read/stream?source=${encodeURIComponent(source)}&mode=${m}&tokens=1&pace=${PACE[1]}`);
    stream.current = es;
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as ReadEvent | { type: 'token'; program: string; text: string };
      if (e.type === 'stage') { setStage(e.message); setPhase('reading'); }
      else if (e.type === 'result') { setPhase('reading'); setStage(`${e.done} of ${e.total} answers in`); engine.feedResult(e.result); }
      else if (e.type === 'token') { setPhase('reading'); engine.feedToken(e.program, e.text); }
      else if (e.type === 'done') { es.close(); setModel(e.run.part2.model); setStage(`${e.run.networkCalls} Nemotron calls · ${(e.run.ms / 1000).toFixed(1)} s`); if (!engine.busy) setPhase('done'); }
      else if (e.type === 'error') { es.close(); setError(e.message); setPhase('error'); }
    };
    es.onerror = () => { es.close(); setPhase((p) => (p === 'connecting' ? 'error' : p)); setError((x) => x ?? 'Lost the connection to the dev server'); };
  }, [engine, source, lineCounts]);

  // The chapter starts itself: open it and the room is already working.
  const autostarted = useRef(false);
  useEffect(() => {
    if (autostarted.current || !Object.keys(lineCounts).length) return;
    autostarted.current = true;
    start('replay');
  }, [lineCounts, start]);

  const setSpeed = (s: number) => { engine.speed = s; setSpeedState(s); };
  engine.paceMs = PACE[1];
  const togglePause = () => { engine.paused = !engine.paused; setPaused(engine.paused); };

  const jobs = engine.all();
  const shown = pinned ?? hero;
  const heroJob = shown ? engine.get(shown) : undefined;
  const heroDecision = decisions.find((d) => d.type === 'choice');

  const totals = useMemo(() => {
    let items = 0, rules = 0, bugs = 0, questions = 0, cited = 0, done = 0;
    for (const j of jobs) {
      if (j.status === 'done') done++;
      cited += j.citedLines.size;
      for (const it of j.items) {
        items++;
        if (it.kind === 'question') questions++;
        else if (it.finding.kind === 'rule') rules++;
        else if (it.finding.kind === 'defect') bugs++;
      }
    }
    return { items, rules, bugs, questions, cited, done, total: jobs.length };
  }, [jobs]);
  // When the harness has looked questions up for real, its verdicts replace the stand-in.
  const jevAsked = decisions.filter((d) => d.type === 'noul' && d.choice === 'yes').length;
  const asked = harness.questions.length ? harness.questions.filter((q) => verdictOf(q) === 'not-found').length : jevAsked;
  const waitingJobs = Object.values(harness.jobs).filter((j) => j.status === 'waiting' || j.status === 'asking').length;
  const jevLive = decisions.filter((d) => d.source === 'jev').length;
  const jevModel = decisions.find((d) => d.modelId)?.modelId;
  const reading = jobs.filter((j) => j.status === 'reading' && j.program !== shown);
  const heroHarness = shown ? harness.jobs[shown] : undefined;

  return (
    <main className="wr" data-phase={phase}>
      <header className="wr-top">
        <h1>Watch it work</h1>
        <div className="wr-nums" aria-live="polite">
          <span><Num n={totals.done} /><em>/{totals.total} programs read</em></span>
          <span className={waitingJobs ? 'ask' : ''}><Num n={harness.connected ? waitingJobs : asked} /><em>{harness.connected ? ' paused on a person' : ' need a person'}</em></span>
        </div>
        <div className="wr-controls">
          <button type="button" className="wr-link" onClick={() => start('replay')} disabled={phase === 'connecting'} title="Reads every program again">Run again</button>
          <button type="button" className="wr-link" onClick={() => start('live')} disabled={phase === 'connecting'} title="Calls Nemotron for every program whose pack changed">{phase === 'reading' && mode === 'live' ? 'Reading live…' : 'Read live'}</button>
          <button type="button" className={`wr-link${side ? ' on' : ''}`} onClick={() => setSide((v) => !v)} aria-expanded={side}>{side ? 'Hide details' : 'Details'}</button>
        </div>
      </header>

      <div className={`wr-body${side ? ' with-side' : ''}`}>
        <section className="wr-stage">
          {heroJob ? (
            <>
              <Sequence job={heroJob} status={heroHarness?.status} />
              <HeroPane key={heroJob.program} job={heroJob} source={source} file={files[heroJob.program]} lines={lineCounts[heroJob.program]} decision={heroDecision} pinned={pinned === heroJob.program} onUnpin={() => setPinned(null)} harness={harness} />
              <p className="wr-also">
                {reading.length > 0 ? <>Also reading {reading.slice(0, 4).map((j, i) => <span key={j.program}><button type="button" className="wr-link small" onClick={() => setPinned(j.program)}>{j.program}</button>{i < Math.min(reading.length, 4) - 1 ? ', ' : ''}</span>)}{reading.length > 4 ? ` and ${reading.length - 4} more` : ''}</> : phase === 'done' ? `All ${totals.total} programs read` : stage}
                {jevLive > 0 && <span className="wr-also-jev" title={jevModel ?? 'typesafe/jev-1.13'}> · {MODEL_LABEL(model)} writes, Jev decides ({jevLive} decisions)</span>}
              </p>
            </>
          ) : (
            <div className="wr-empty">{phase === 'error' ? error : 'Waiting for the first program…'}</div>
          )}
        </section>

        {side && (
          <aside className="wr-side">
            <div className="wr-tabs" role="tablist">
              {([['programs', 'Programs', jobs.length], ['feed', 'Findings', feed.length], ['jev', 'Jev', decisions.length], ['agent', 'Agent', harness.events.length]] as const).map(([id, label, n]) => (
                <button key={id} type="button" role="tab" aria-selected={drawer === id} className={drawer === id ? 'on' : ''} onClick={() => setDrawer(id)}>{label} <span>{n}</span></button>
              ))}
            </div>
            {drawer === 'programs' ? (
              <ol className="wr-programs">
                {jobs.map((j) => (
                  <li key={j.program} className={`wr-prog ${j.status}${j.program === shown ? ' hero' : ''}`}>
                    <button type="button" onClick={() => setPinned(pinned === j.program ? null : j.program)} title={pinned === j.program ? 'Let Jev choose again' : 'Pin to the stage'}>
                      <span className="wr-prog-name">{j.program}</span>
                      <span className="wr-prog-meta">
                        {j.status === 'queued' && (lineCounts[j.program] ? `${lineCounts[j.program]} lines` : 'queued')}
                        {j.status === 'reading' && <Progress job={j} />}
                        {j.status === 'done' && <Counts job={j} />}
                      </span>
                      <HarnessBadge h={harness} program={j.program} />
                    </button>
                  </li>
                ))}
              </ol>
            ) : drawer === 'feed' ? <Feed items={feed} onPick={setPinned} /> : drawer === 'jev' ? <Decisions items={decisions} /> : <AgentLog h={harness} onPick={setPinned} />}
            <div className="wr-side-foot">
              <span className="wr-seg" role="group" aria-label="Speed">{[1, 3, 10].map((s) => <button key={s} type="button" className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}</span>
              <button type="button" className="wr-link" onClick={togglePause} disabled={phase !== 'reading'}>{paused ? 'Resume' : 'Pause'}</button>
              {connectors.length > 0 && <span className="wr-sources">{connectors.filter((c) => c.id !== 'nemotron').map((c) => <span key={c.id} className={c.connected ? 'on' : 'off'} title={`${c.name}: ${c.detail}`}><ConnectorIcon id={c.id} size={13} /></span>)}</span>}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}

/** One visible sequence for the program on stage: where it is in the loop right now. */
const STEPS: { id: string; label: string }[] = [
  { id: 'read', label: 'Read' },
  { id: 'found', label: 'Rules and bugs' },
  { id: 'lookup', label: 'Looked it up' },
  { id: 'ask', label: 'Asked a person' },
  { id: 'resume', label: 'Resumed' },
];
function Sequence({ job, status }: { job: Job; status?: string }) {
  const at = status === 'done' || status === 'resuming' ? 4
    : status === 'waiting' || status === 'asking' ? 3
    : status === 'looking-up' ? 2
    : job.items.some((it) => it.kind === 'question' || (it.kind === 'finding' && it.finding.kind !== 'connection')) ? 1
    : 0;
  return (
    <ol className="wr-seq" aria-label="Where this program is">
      {STEPS.map((st, i) => <li key={st.id} className={i < at ? 'done' : i === at ? 'now' : ''}>{st.label}</li>)}
    </ol>
  );
}

/* ----------------------------------------------------------------- hero */

function HeroPane({ job, source, file, lines, decision, pinned, onUnpin, harness }: {
  job: Job; source: string; file?: string; lines?: number; decision?: JevDecision; pinned: boolean; onUnpin: () => void; harness: HarnessState & { answer: (id: string, a: string, by: string) => Promise<void> };
}) {
  const hjob = harness.jobs[job.program];
  const hq = questionsFor(harness, job.program);
  const path = file ?? ownFile(job);
  const latest = useMemo(() => {
    for (let i = job.items.length - 1; i >= 0; i--) {
      const c = job.items[i].cites.find((x) => x.path === path);
      if (c) return c;
    }
    return undefined;
  }, [job.items.length, path]); // eslint-disable-line react-hooks/exhaustive-deps
  const win = useCodeWindow(source, path, latest?.from, latest?.to);
  const p = decision && decision.choice === job.program ? decision.probabilities[job.program] : undefined;
  return (
    <div className={`wr-hero${hjob && (hjob.status === 'waiting' || hjob.status === 'asking') ? ' waiting' : ''}`}>
      <div className="wr-hero-head">
        <div>
          <div className="wr-hero-name">{job.program}<span className="wr-hero-file">{path ?? ''}{lines ? ` · ${lines} lines` : ''}</span></div>
        </div>
        <div className="wr-chips">
          {pinned ? (
            <button type="button" className="wr-chip jev pinned" onClick={onUnpin} title="Let Jev choose again">Pinned by you · unpin</button>
          ) : decision ? (
            <span className={`wr-chip jev${decision.source === 'jev' ? '' : ' off'}`} title={decision.source === 'jev' ? `${decision.modelId}` : decision.fallback === 'pending' ? 'Stand-in while Jev answers' : `Stand-in: ${decision.fallback}`}>
              {decision.source === 'jev' ? 'Jev' : 'Jev stand-in'}{p !== undefined ? ` · ${Math.round(p * 100)}%` : ''} · {fmtMs(decision.latencyMs)}
            </span>
          ) : null}
        </div>
      </div>
      {hjob && hq.length > 0 && <WaitingCard job={hjob.status} questions={hq} people={harness.people} onAnswer={harness.answer} />}
      <div className="wr-hero-body">
        <Stream text={job.text} live={job.status === 'reading'} />
        <Code win={win} cited={job.citedLines} total={lines} latest={latest} />
      </div>
    </div>
  );
}

function Stream({ text, live }: { text: string; live: boolean }) {
  const box = useRef<HTMLPreElement>(null);
  // Keep the newest token in view while the model writes; scroll position is DOM state.
  useEffect(() => { if (live && box.current) box.current.scrollTop = box.current.scrollHeight; }, [text, live]);
  return (
    <div className="wr-stream">
      <div className="wr-pane-head"><span>{live ? 'Nemotron is writing' : 'Nemotron'}</span></div>
      <pre ref={box} className="wr-stream-text">{highlightCites(text)}{live && <span className="wr-cursor" aria-hidden>▍</span>}</pre>
    </div>
  );
}

/** Citations in the reply get the same colour as the lines they light up. */
function highlightCites(text: string) {
  const parts: ReactNode[] = [];
  const re = /([\w./-]+\.(?:cbl|CBL|cpy|CPY|jcl|JCL|bms|BMS|dcl|DCL|sql|SQL)):(\d+(?:-\d+)?)/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={k++} className="wr-cite">{m[0]}</mark>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function useCodeWindow(source: string, path?: string, from?: number, to?: number) {
  const [win, setWin] = useState<CodeWindow | null>(null);
  const cache = useRef(new Map<string, CodeWindow>());
  useEffect(() => {
    if (!path || !from) return;
    // A 40-line window with the citation a third of the way down, so there is code to read around it.
    const start = Math.max(1, from - 13);
    const end = Math.max(to ?? from, start + 36);
    const ref = `${path}:${start}-${end}`;
    const hit = cache.current.get(ref);
    if (hit) { setWin(hit); return; }
    let alive = true;
    fetch(`/api/code?source=${encodeURIComponent(source)}&ref=${encodeURIComponent(ref)}`)
      .then((r) => (r.ok ? (r.json() as Promise<CodeWindow>) : null))
      .then((w) => { if (alive && w) { cache.current.set(ref, w); setWin(w); } })
      .catch(() => { /* the previous window stays up */ });
    return () => { alive = false; };
  }, [source, path, from, to]);
  return win;
}

function Code({ win, cited, total, latest }: { win: CodeWindow | null; cited: Set<number>; total?: number; latest?: { from: number; to: number } }) {
  const n = total ?? (win ? Math.max(win.to + 40, 200) : 400);
  const ticks = useMemo(() => Array.from(cited).sort((a, b) => a - b), [cited]);
  return (
    <div className="wr-code">
      <div className="wr-pane-head"><span>COBOL</span><span>{win ? `${win.path.split('/').pop()} · ${win.from}${win.to !== win.from ? `–${win.to}` : ''}` : 'waiting for a citation'}</span></div>
      <div className="wr-code-body">
        <pre className="wr-code-text">
          {win ? win.lines.map((l) => (
            <div key={l.no} className={`wr-line${cited.has(l.no) ? ' cited' : ''}${latest && l.no >= latest.from && l.no <= latest.to ? ' fresh' : ''}`}>
              <span className="wr-no">{l.no}</span><span className="wr-src">{l.text || ' '}</span>
            </div>
          )) : <div className="wr-line muted"><span className="wr-no" /><span className="wr-src">The first cited line appears here.</span></div>}
        </pre>
        <div className="wr-minimap" title={`${ticks.length} of ${n} lines cited`} aria-hidden>
          {ticks.map((t) => <i key={t} style={{ top: `${Math.min(100, (t / n) * 100)}%` }} className={latest && t >= latest.from && t <= latest.to ? 'fresh' : ''} />)}
          {win && <b style={{ top: `${(win.from / n) * 100}%`, height: `${Math.max(1.5, ((win.to - win.from + 7) / n) * 100)}%` }} />}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- harness */

/** The lookup verdict rides along on the row but is not in the shared type yet. */
const verdictOf = (q: HarnessQuestion) => (q as HarnessQuestion & { verdict?: string }).verdict ?? '';

function HarnessBadge({ h, program }: { h: HarnessState; program: string }) {
  const s = statusLabel(h, program);
  if (!s) return null;
  return <span className={`wr-hbadge ${s.tone}`}>{s.text}</span>;
}

/** The agent is paused: the question it sent, who it went to and why, and the same buttons Slack shows. */
function WaitingCard({ job, questions, people, onAnswer }: { job: string; questions: HarnessQuestion[]; people: { id: string; name: string }[]; onAnswer: (id: string, a: string, by: string) => Promise<void> }) {
  const open = questions.filter(isOpen);
  const q = open[0] ?? questions[0];
  const [as, setAs] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const who = as || q.routeTo || people[0]?.id || '';
  const options = parseJson<string[]>(q.optionsJson, []);
  const answered = !isOpen(q);
  return (
    <div className="wr-wait">
      <div className="wr-wait-head">
        <span className={`wr-chip ${answered ? 'done' : 'ask'}`}>{answered ? 'Answered' : job === 'asking' ? 'Asking on Slack' : 'Paused · waiting on a person'}</span>
        <span className="wr-wait-route">{q.routeName ? <>Routed to <b>{q.routeName}</b> · {q.routeWhy.split(':')[0]}</> : null}{open.length > 1 ? ` · ${open.length} open questions` : ''}</span>
      </div>
      <p className="wr-wait-q">{q.text}</p>
      {answered ? (
        <div className="wr-wait-answer">
          <b>{q.answerText}</b> · {q.answeredBy.split('@')[0].replace('.', ' ')} · becomes a test
        </div>
      ) : (
        <div className="wr-wait-actions">
          {options.map((o) => (
            <button key={o} type="button" className="btn" disabled={busy !== null}
              onClick={() => { setBusy(o); setErr(null); onAnswer(q.id, o, who).catch((e: Error) => setErr(e.message)).finally(() => setBusy(null)); }}>
              {busy === o ? 'Sending…' : o}
            </button>
          ))}
          <label className="wr-wait-as">as
            <select value={who} onChange={(e) => setAs(e.target.value)}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {err && <span className="wr-wait-err">{err}</span>}
        </div>
      )}
    </div>
  );
}

function AgentLog({ h, onPick }: { h: HarnessState; onPick: (program: string) => void }) {
  if (!h.connected && !h.events.length) return <div className="wr-side-empty">The harness feed is not connected. Start the dev server's harness worker and this fills with what the agent is doing.</div>;
  const events = [...h.events].reverse();
  return (
    <ol className="wr-feed agent">
      {events.map((e) => <AgentRow key={e.id} e={e} onPick={onPick} />)}
    </ol>
  );
}

function AgentRow({ e, onPick }: { e: HarnessEvent; onPick: (program: string) => void }) {
  const program = programOf(e.jobId);
  const tone = e.kind === 'waiting' || e.kind === 'asking' ? 'wait' : e.kind === 'answered' || e.kind === 'resumed' || e.kind === 'resume' ? 'go' : e.kind === 'bug' ? 'bug' : '';
  return (
    <li className={`wr-item agent ${tone}`}>
      <button type="button" onClick={() => onPick(program)}>
        <div className="wr-item-head"><span className="wr-item-kind">{e.kind.replace('-', ' ')}</span><span className="wr-item-prog">{program} · {new Date(e.atMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div>
        <p>{e.message}</p>
      </button>
    </li>
  );
}

/* ----------------------------------------------------------------- lanes */

function Progress({ job }: { job: Job }) {
  const items = job.items.length;
  const expected = job.result ? job.result.findings.length + job.result.questions.length : 0;
  const pct = expected ? Math.round((items / expected) * 100) : 0;
  return <span className="wr-progress" aria-label={`${pct}% written`}><i style={{ width: `${pct}%` }} /></span>;
}

function Counts({ job }: { job: Job }) {
  const bugs = job.items.filter((it) => it.kind === 'finding' && it.finding.kind === 'defect').length;
  const qs = job.items.filter((it) => it.kind === 'question').length;
  const rules = job.items.filter((it) => it.kind === 'finding' && it.finding.kind === 'rule').length;
  return (
    <span className="wr-counts">
      {rules > 0 && <em className="rule">{rules} rule{rules === 1 ? '' : 's'}</em>}
      {bugs > 0 && <em className="bug">{bugs} bug{bugs === 1 ? '' : 's'}</em>}
      {qs > 0 && <em className="q">{qs} q</em>}
      {rules + bugs + qs === 0 && <em>links only</em>}
    </span>
  );
}

/* ----------------------------------------------------------------- side */

function Feed({ items, onPick }: { items: (Item & { decision?: JevDecision })[]; onPick: (program: string) => void }) {
  if (!items.length) return <div className="wr-side-empty">Rules, suspected bugs and questions land here as the model closes them.</div>;
  return (
    <ol className="wr-feed">
      {items.map((it) => {
        const kind = it.kind === 'question' ? 'question' : it.finding.kind;
        const text = it.kind === 'question' ? it.question.text : it.finding.summary;
        const cite = it.cites[0];
        return (
          <li key={`${it.program}-${it.at}-${text.slice(0, 24)}`} className={`wr-item ${kind}`}>
            <button type="button" onClick={() => onPick(it.program)}>
              <div className="wr-item-head">
                <span className="wr-item-kind">{it.kind === 'question' ? (it.question.blocks === 'none' ? 'Question' : `Question · blocks ${it.question.blocks}`) : KIND_LABEL[kind] ?? kind}</span>
                <span className="wr-item-prog">{it.program}</span>
              </div>
              <p>{text}</p>
              <div className="wr-item-foot">
                {cite && <span className="wr-cite">{cite.path.split('/').pop()}:{cite.from}{cite.to !== cite.from ? `-${cite.to}` : ''}</span>}
                {it.kind === 'finding' && <span className="wr-conf">{it.finding.confidence}</span>}
                {it.decision && (
                  <span className={`wr-chip jev small ${it.decision.choice === 'yes' ? 'ask' : ''}${it.decision.source === 'jev' ? '' : ' off'}`} title={it.decision.source === 'jev' ? `${it.decision.modelId} · ${fmtMs(it.decision.latencyMs)}` : it.decision.fallback === 'pending' ? 'Stand-in while Jev answers' : 'Stand-in'}>
                    {it.decision.choice === 'yes' ? 'Ask a human' : 'No human needed'} · {Math.round(it.decision.probabilities.yes * 100)}%{it.decision.source === 'jev' ? '' : it.decision.fallback === 'pending' ? ' · …' : ' · stand-in'}
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Decisions({ items }: { items: JevDecision[] }) {
  if (!items.length) return <div className="wr-side-empty">Every typed decision Jev makes shows here: the labels it was given, the distribution it returned, and how long it took.</div>;
  return (
    <ol className="wr-feed jev">
      {items.map((d) => (
        <li key={d.id} className="wr-item decision">
          <div className="wr-item-head">
            <span className="wr-item-kind">{d.question}</span>
            <span className="wr-item-prog">{d.source === 'jev' ? 'Jev' : d.fallback === 'pending' ? 'stand-in · waiting' : `stand-in · ${d.fallback}`} · {fmtMs(d.latencyMs)}</span>
          </div>
          <div className="wr-dist">
            {Object.entries(d.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => (
              <div key={k} className={`wr-bar${k === d.choice ? ' pick' : ''}`}>
                <span>{k}</span><i style={{ width: `${Math.round(v * 100)}%` }} /><b>{Math.round(v * 100)}%</b>
              </div>
            ))}
          </div>
          <details className="wr-labels">
            <summary>What Jev saw · drives {d.drives}</summary>
            {Object.entries(d.state).map(([who, labels]) => (
              <div key={who} className="wr-label-row">
                <span>{who}</span>
                <span>{Object.entries(labels).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>
              </div>
            ))}
          </details>
        </li>
      ))}
    </ol>
  );
}

/** A number that ticks up instead of jumping. */
function Num({ n }: { n: number }) {
  const [shown, setShown] = useState(n);
  const target = useRef(n);
  useEffect(() => {
    target.current = n;
    let raf = 0;
    const step = () => {
      setShown((s) => {
        if (s === target.current) return s;
        const d = target.current - s;
        const next = s + Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) / 6));
        return Math.sign(d) > 0 ? Math.min(next, target.current) : Math.max(next, target.current);
      });
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [n]);
  return <>{shown}</>;
}
