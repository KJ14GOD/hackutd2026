// The live harness feed: which jobs are paused waiting on a person, the questions sent to Slack, and
// the answers as they land. Read-only here except answer(), which does what a Slack button does.
import { useCallback, useEffect, useState } from 'react';
import type { HarnessEvent, HarnessFrame, HarnessJob, HarnessQuestion } from '../../server/harnessTypes';

export interface Person { id: string; name: string; title: string }

export interface HarnessState {
  connected: boolean;
  jobs: Record<string, HarnessJob>;
  questions: HarnessQuestion[];
  events: HarnessEvent[];
  people: Person[];
}

const EMPTY: HarnessState = { connected: false, jobs: {}, questions: [], events: [], people: [] };
const MAX_EVENTS = 300;

export function useHarness() {
  const [state, setState] = useState<HarnessState>(EMPTY);

  // The SSE connection is an external system; it lives for as long as the chapter does.
  useEffect(() => {
    const es = new EventSource('/api/harness/stream');
    es.onmessage = (msg) => {
      const f = JSON.parse(msg.data) as HarnessFrame;
      setState((s) => {
        if (f.type === 'snapshot') {
          return { connected: true, jobs: Object.fromEntries(f.jobs.map((j) => [j.program, j])), questions: f.questions, events: f.events.slice(-MAX_EVENTS), people: f.people };
        }
        if (f.type === 'job') return { ...s, jobs: { ...s.jobs, [f.job.program]: f.job } };
        if (f.type === 'event') return { ...s, events: [...s.events.filter((e) => e.id !== f.event.id), f.event].slice(-MAX_EVENTS) };
        if (f.type === 'question') return { ...s, questions: [...s.questions.filter((q) => q.id !== f.question.id), f.question] };
        return s;
      });
    };
    es.onerror = () => setState((s) => ({ ...s, connected: false }));
    return () => es.close();
  }, []);

  const answer = useCallback(async (questionId: string, answerText: string, answeredBy: string) => {
    const r = await fetch('/api/harness/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId, answer: answerText, answeredBy }) });
    if (!r.ok) throw new Error(`answer failed: ${r.status}`);
  }, []);

  return { ...state, answer };
}

export function programOf(jobId: string) { return jobId.replace(/^job:/, ''); }

export function parseJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/** The questions a job is paused on, open ones first. */
export function questionsFor(h: HarnessState, program: string): HarnessQuestion[] {
  const job = h.jobs[program];
  const waiting = new Set(job ? parseJson<string[]>(job.waitingOnJson, []) : []);
  return h.questions
    .filter((q) => q.program === program)
    .sort((a, b) => Number(waiting.has(b.id)) - Number(waiting.has(a.id)) || a.id.localeCompare(b.id));
}

export function isOpen(q: HarnessQuestion) { return q.status === 'asking' || q.status === 'waiting' || q.status === 'open'; }

/** A short label for the program list: what the harness is doing with this program right now. */
export function statusLabel(h: HarnessState, program: string): { text: string; tone: 'wait' | 'work' | 'done' } | null {
  const job = h.jobs[program];
  if (!job) return null;
  if (job.status === 'waiting' || job.status === 'asking') {
    const q = questionsFor(h, program).find(isOpen);
    return { text: q?.routeName ? `waiting on ${q.routeName.split(' ')[0]}` : 'waiting on a person', tone: 'wait' };
  }
  if (job.status === 'done') return { text: 'harness done', tone: 'done' };
  return { text: job.status.replace('-', ' '), tone: 'work' };
}

/** What Jev is told about the harness state of a program. Labels only. */
export function harnessLabel(h: HarnessState, program: string, nowMs: number): string {
  const job = h.jobs[program];
  if (!job) return 'not in the harness';
  const recent = nowMs - job.updatedAtMs < 15_000;
  if (job.status === 'resuming' || (job.status === 'done' && recent)) return 'answer just landed';
  if (job.status === 'waiting' || job.status === 'asking') return recent ? 'just paused for a person' : 'waiting on a person';
  return job.status;
}
