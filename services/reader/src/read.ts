// One model call per pack (spec §3.3), then the checks that make the output trustworthy:
// schema validation, citation checks against the pack, and connection-explanation coverage.
import type { LlmProvider } from '../../../packages/llm/src/index';
import { FindingSchema, ModelOutputSchema, QuestionSchema, type Dropped, type Finding, type PackResult, type Question } from './contract';
import type { Pack } from './pack';

export const SYSTEM_PROMPT = `You are Theseus's code reader. You read one legacy COBOL program at a time and explain it to engineers who must replace it without changing what the business depends on.
Rules: use only the pack you are given; cite lines exactly as they are prefixed in the pack; never invent code, files, or lines; report defects but never fix them; when the code cannot settle something, ask a question instead of guessing. Reply with JSON only.`;

/** Brackets still open at the end of `s`, closed in reverse, ignoring anything inside strings. */
function closers(s: string): string {
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) { if (c === '\\') i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  return stack.reverse().join('');
}

/**
 * Pulls the JSON object out of a reply that may be wrapped in a code fence or prose. A reply cut off
 * at the token limit keeps every item that was complete: it is closed after the last whole object.
 */
export function extractJson(text: string): { value: unknown; truncated: boolean } {
  const fenced = /```(?:json)?\s*([\s\S]*?)(?:```|$)/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  if (start < 0) throw new Error('no JSON object in reply');
  const end = body.lastIndexOf('}');
  try { return { value: JSON.parse(body.slice(start, end + 1)), truncated: false }; } catch { /* try salvage */ }
  for (let i = end, tries = 0; i > start && tries < 400; i = body.lastIndexOf('}', i - 1), tries++) {
    const prefix = body.slice(start, i + 1);
    try { return { value: JSON.parse(prefix + closers(prefix)), truncated: true }; } catch { /* earlier cut */ }
  }
  throw new Error('no complete JSON object in reply');
}

/** "path:12" and ranges "path:12-15" are valid when every cited line is in the pack. */
function validCitations(evidence: string[], citable: Set<string>): string[] {
  return evidence.filter((ev) => {
    const m = /^(.*):(\d+)(?:-(\d+))?$/.exec(ev.trim());
    if (!m) return false;
    const [, path, a, b] = m;
    const lo = Number(a);
    const hi = b ? Number(b) : lo;
    if (hi < lo || hi - lo > 200) return false;
    for (let n = lo; n <= hi; n++) if (!citable.has(`${path}:${n}`) && (n === lo || n === hi)) return false;
    return true;
  });
}

export interface ReadOutcome {
  result: PackResult;
  dropped: Dropped[];
  model: string;
}

export async function readPack(provider: LlmProvider, pack: Pack, maxTokens: number, onToken?: (text: string) => void): Promise<ReadOutcome> {
  const reply = await provider.complete({
    role: 'strong',
    maxTokens,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: pack.text }],
    ...(onToken ? { onChunk: onToken } : {}),
  });
  const dropped: Dropped[] = [];
  const findings: Finding[] = [];
  const questions: Question[] = [];
  let needMore: PackResult['needMore'];

  let parsed: ReturnType<typeof ModelOutputSchema.parse> | undefined;
  try {
    const { value, truncated } = extractJson(reply.text);
    parsed = ModelOutputSchema.parse(value);
    if (truncated) dropped.push({ program: pack.program, reason: 'truncated', detail: 'reply hit the output token limit; complete items were kept, the rest is lost' });
  } catch (err) {
    dropped.push({ program: pack.program, reason: 'schema', detail: `reply was not the contract JSON: ${String(err).slice(0, 160)}` });
  }

  for (const raw of parsed?.findings ?? []) {
    const f = FindingSchema.safeParse(raw);
    if (!f.success) { dropped.push({ program: pack.program, reason: 'schema', detail: `finding: ${f.error.issues[0]?.message ?? 'invalid'}` }); continue; }
    const good = validCitations(f.data.evidence, pack.citable);
    if (good.length === 0) {
      dropped.push({ program: pack.program, reason: f.data.evidence.length ? 'bad-citation' : 'no-citation', detail: `${f.data.kind}: ${f.data.summary.slice(0, 120)} [${f.data.evidence.join(', ')}]` });
      continue;
    }
    if (f.data.kind === 'connection' && !pack.connections.some((c) => c.id === f.data.ref)) {
      dropped.push({ program: pack.program, reason: 'schema', detail: `connection explanation for unknown ref ${f.data.ref ?? '(none)'}` });
      continue;
    }
    findings.push({ ...f.data, evidence: good });
  }

  for (const raw of parsed?.questions ?? []) {
    const q = QuestionSchema.safeParse(raw);
    if (!q.success) { dropped.push({ program: pack.program, reason: 'schema', detail: `question: ${q.error.issues[0]?.message ?? 'invalid'}` }); continue; }
    const good = validCitations(q.data.evidence, pack.citable);
    if (good.length === 0) {
      dropped.push({ program: pack.program, reason: q.data.evidence.length ? 'bad-citation' : 'no-citation', detail: `question: ${q.data.text.slice(0, 120)}` });
      continue;
    }
    questions.push({ ...q.data, evidence: good, id: '', program: pack.program });
  }
  if (parsed?.needMore?.length) needMore = parsed.needMore;

  const explained = new Set(findings.filter((f) => f.kind === 'connection').map((f) => f.ref));
  const missing = pack.connections.filter((c) => !explained.has(c.id)).map((c) => c.id);
  return {
    model: reply.model,
    dropped,
    result: {
      program: pack.program, findings, questions, ...(needMore ? { needMore } : {}),
      coverage: { connections: pack.connections.length, explained: pack.connections.length - missing.length, missing },
    },
  };
}

export interface CrossPack {
  dataset: string;
  programs: string[];
  /** How each program declares the record, with citable lines. */
  layouts: { title: string; lines: string[]; refs: string[] }[];
  /** Every read and write of the dataset, with evidence. */
  uses: string[];
  /** What the per-program reads already said about it. */
  notes: string[];
}

const CROSS_TASK = `TASK
Several programs share the dataset above. Using only this pack, compare them:
1. Mismatches: the same bytes laid out or used differently by different programs (kind "mismatch").
2. Conflicting rules: programs that update or validate the same field in incompatible ways (kind "rule").
3. Anything one program writes that no program here reads correctly, or reads that nobody writes (kind "mismatch").
Each LAYOUT title gives record sizes, and each FIELDS table gives byte positions, computed by code from the PICTURE clauses. Compare those numbers; never do your own byte arithmetic.
Normal COBOL, not a mismatch: an FD declared as a key plus one PIC X area and read INTO a copybook record of the same size; one program opening a file INPUT while another opens it I-O; reading an indexed file sequentially by key.
Report only real differences you can cite. Cite at least one line from LAYOUTS or USES per finding, exactly as written. Be brief: one sentence per summary.
OUTPUT
Reply with one JSON object and nothing else:
{"findings":[{"kind":"mismatch|rule","summary":"...","evidence":["path:line"],"confidence":"high|medium|low"}]}`;

/** One call for one shared dataset (spec §3.5). Findings without a citation from the pack are dropped. */
export async function readCross(provider: LlmProvider, pack: CrossPack, maxTokens: number): Promise<{ findings: Finding[]; dropped: Dropped[] }> {
  const usesRefs = pack.uses.map((u) => /evidence (\S+)/.exec(u)?.[1]).filter((x): x is string => !!x);
  const citable = new Set([...pack.layouts.flatMap((l) => l.refs), ...usesRefs]);
  const text = [
    `DATASET ${pack.dataset.replace(/^data:/, '')}, shared by ${pack.programs.join(', ')}`, '',
    'USES', ...pack.uses, '',
    ...pack.layouts.flatMap((l) => [`LAYOUT ${l.title}`, ...(l.lines.length ? l.lines : ['(no record layout found)']), '']),
    'WHAT EACH PROGRAM\'S READ SAID', ...(pack.notes.length ? pack.notes : ['nothing specific']), '',
    CROSS_TASK,
  ].join('\n');
  const reply = await provider.complete({ role: 'strong', maxTokens, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }] });
  const program = `cross:${pack.dataset.replace(/^data:/, '')}`;
  const dropped: Dropped[] = [];
  const findings: Finding[] = [];
  let parsed: ReturnType<typeof ModelOutputSchema.parse> | undefined;
  try {
    const { value, truncated } = extractJson(reply.text);
    parsed = ModelOutputSchema.parse(value);
    if (truncated) dropped.push({ program, reason: 'truncated', detail: 'reply hit the output token limit' });
  } catch (err) {
    dropped.push({ program, reason: 'schema', detail: `reply was not the contract JSON: ${String(err).slice(0, 160)}` });
  }
  for (const raw of parsed?.findings ?? []) {
    const f = FindingSchema.safeParse(raw);
    if (!f.success) { dropped.push({ program, reason: 'schema', detail: `finding: ${f.error.issues[0]?.message ?? 'invalid'}` }); continue; }
    const good = validCitations(f.data.evidence, citable);
    if (!good.length) { dropped.push({ program, reason: f.data.evidence.length ? 'bad-citation' : 'no-citation', detail: f.data.summary.slice(0, 120) }); continue; }
    findings.push({ ...f.data, summary: `${pack.dataset.replace(/^data:/, '').split('.').slice(3, 4)[0] ?? pack.dataset}: ${f.data.summary}`, evidence: good });
  }
  return { findings, dropped };
}
