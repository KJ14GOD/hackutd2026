// Part 2: read every program (or a chosen few), merge split packs, add the cross-program checks
// that code can do on its own, and keep the not-verified list honest.
import type { LlmProvider } from '../../../packages/llm/src/index';
import type { Pass1 } from '../../segmenter/src/types';
import type { Runtime } from '../../runtime/src/types';
import type { Dropped, Finding, Part2, PackResult, Question } from './contract';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPacks, estimateTokens, numbered, recordSizes, withExtras, type Extra } from './pack';
import { expandCopies, layoutOf } from '../../runtime/src/layout';
import { readCross, readPack } from './read';

export interface Part2Options {
  pass1: Pass1;
  /** The Runtime sandbox result, when it has run: adds ran/never-ran marks and coverage to each pack. */
  runtime?: Runtime;
  root: string;
  provider: LlmProvider;
  programs?: string[];
  maxPackTokens: number;
  maxOutputTokens: number;
  /** How many times one program may ask for more context (spec: needMore). */
  maxNeedMoreRounds: number;
  /** Programs read at the same time. */
  concurrency: number;
  /** Size cap for each piece of extra context the model asks for. */
  maxExtraTokens: number;
  onProgress?: (step: string, done: number, total: number) => void;
  /** Called as each program finishes, so a UI can show results while the rest are read. */
  onResult?: (result: PackResult) => void;
  /** Free-form progress lines (extra context asked for, cross-program checks). */
  onLog?: (line: string) => void;
  /** Nemotron's answer for a program as it's written (live) or played back (cached). */
  onToken?: (program: string, text: string) => void;
}

/** Datasets someone reads but no program or job writes, and the reverse: questions about outside parties. */
export function crossProgramChecks(pass1: Pass1): Finding[] {
  const out: Finding[] = [];
  const data = [...new Set(pass1.edges.filter((e) => e.to.startsWith('data:') && !e.to.startsWith('data:dd:')).map((e) => e.to))].sort();
  for (const d of data) {
    const into = pass1.edges.filter((e) => e.to === d);
    const writers = into.filter((e) => ['write', 'defines'].includes(e.rel));
    const readers = into.filter((e) => e.rel === 'read');
    if (readers.length && !writers.length) {
      out.push({ kind: 'mismatch', summary: `${d.slice(5)} is read by ${new Set(readers.map((e) => e.from)).size} program(s) or job(s) but nothing in this codebase writes it: something outside feeds it.`, evidence: [readers[0].evidence], confidence: 'medium' });
    } else if (writers.length && !readers.length && !into.some((e) => e.rel === 'deletes')) {
      out.push({ kind: 'mismatch', summary: `${d.slice(5)} is written but nothing in this codebase reads it: an outside party may depend on it.`, evidence: [writers[0].evidence], confidence: 'low' });
    }
  }
  return out;
}

/** Fetches what the model asked for: another program, a file in the repo, or who shares a dataset. */
export function fetchExtras(pass1: Pass1, root: string, asks: NonNullable<PackResult['needMore']>, maxTokens = Infinity): Extra[] {
  const out: Extra[] = [];
  for (const ask of asks.slice(0, 2)) {
    const id = ask.id.trim();
    if (ask.kind === 'program' || ask.kind === 'file') {
      const node = ask.kind === 'program'
        ? pass1.nodes.find((n) => n.id === `prog:${id.toUpperCase()}`)
        : pass1.nodes.find((n) => n.file === id || n.id.endsWith(`:${id.toUpperCase()}`));
      const path = node?.file ?? (ask.kind === 'file' ? id : undefined);
      try {
        if (!path || path.includes('..')) throw new Error('not found');
        const n = numbered(path, readFileSync(join(root, path), 'utf8'));
        // Whole programs made second calls up to ~97k tokens; the first lines (data, then early logic) are capped.
        let used = 0;
        const keep = n.lines.findIndex((l) => (used += estimateTokens(l + '\n')) > maxTokens);
        const cut = keep < 0 ? n.lines.length : keep;
        out.push({ title: `${ask.kind} ${path}${cut < n.lines.length ? ` (first ${cut} of ${n.lines.length} lines)` : ''}`, lines: n.lines.slice(0, cut), refs: n.refs.slice(0, cut) });
      } catch { out.push({ title: `${ask.kind} ${id}`, lines: ['not found in this codebase'], refs: [] }); }
    } else {
      const data = pass1.edges.filter((e) => e.to.startsWith('data:') && e.to.toUpperCase().includes(id.toUpperCase()));
      out.push({ title: `data ${id}`, lines: data.length ? data.map((e) => `${e.from} ${e.rel} ${e.to} evidence ${e.evidence}`) : ['no program touches it'], refs: data.map((e) => e.evidence) });
    }
  }
  return out;
}

/** Runs `work` over `items` with at most `limit` at once, keeping the input order in the result. */
async function pool<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await work(items[i], i); }
  }));
  return out;
}

/** Reads one program: every pack, plus up to `maxNeedMoreRounds` re-reads with the context it asked for. */
async function readProgram(opts: Part2Options, program: string): Promise<{ result: PackResult; dropped: Dropped[]; model: string }> {
  const { pass1, root, provider } = opts;
  const packs = buildPacks(pass1, root, program, opts.maxPackTokens, opts.runtime);
  const merged: PackResult = { program, findings: [], questions: [], coverage: { connections: packs[0].connections.length, explained: 0, missing: [] } };
  const dropped: Dropped[] = [];
  let model = provider.mode as string;
  // A split program's parts are independent, so they're read at the same time.
  const parts = await Promise.all(packs.map(async (first) => {
    let pack = first;
    const partDropped: Dropped[] = [];
    const asked: NonNullable<PackResult['needMore']> = [];
    const tok = opts.onToken ? (t: string) => opts.onToken!(program, t) : undefined;
    let r = await readPack(provider, pack, opts.maxOutputTokens, tok);
    for (let round = 0; round < opts.maxNeedMoreRounds && r.result.needMore?.length; round++) {
      asked.push(...r.result.needMore);
      opts.onLog?.(`${program}: asked for ${r.result.needMore.map((a) => `${a.kind} ${a.id}`).join(', ')}`);
      pack = withExtras(pack, fetchExtras(pass1, root, r.result.needMore, opts.maxExtraTokens));
      partDropped.push(...r.dropped);
      r = await readPack(provider, pack, opts.maxOutputTokens, tok);
    }
    return { r, asked, dropped: [...partDropped, ...r.dropped] };
  }));
  for (const { r, asked, dropped: d } of parts) {
    model = r.model;
    dropped.push(...d);
    if (asked.length) merged.needMore = [...(merged.needMore ?? []), ...asked];
    merged.findings.push(...r.result.findings);
    merged.questions.push(...r.result.questions);
  }
  const explained = new Set(merged.findings.filter((f) => f.kind === 'connection' && f.ref).map((f) => f.ref));
  const missing = packs[0].connections.map((c) => c.id).filter((id) => !explained.has(id));
  merged.coverage = { connections: packs[0].connections.length, explained: packs[0].connections.length - missing.length, missing };
  merged.questions = merged.questions.map((q, n): Question => ({ ...q, id: `${program}-Q${n + 1}` }));
  return { result: merged, dropped, model };
}

/** The record layout a program uses for a dataset: its FD entry and the copybook record it reads into. */
function layoutFor(pass1: Pass1, root: string, program: string, edge: { via?: string }): Extra | undefined {
  const node = pass1.nodes.find((n) => n.id === `prog:${program}`);
  const file = /OPEN\s+(?:INPUT|OUTPUT|I-O|EXTEND)\s+(\S+)/.exec(edge.via ?? '')?.[1];
  if (!node?.file || !file) return undefined;
  const src = numbered(node.file, readFileSync(join(root, node.file), 'utf8'));
  const fd = src.lines.findIndex((l) => new RegExp(`\\|\\s*FD\\s+${file}\\b`).test(l));
  const lines: string[] = [];
  const refs: string[] = [];
  if (fd >= 0) for (let i = fd; i < src.lines.length && (i === fd || !/\|\s*(FD|SD)\s|SECTION\./.test(src.lines[i])); i++) { lines.push(src.lines[i]); refs.push(src.refs[i]); }
  const into = new RegExp(`READ\\s+${file}[^.]*?INTO\\s+([A-Z0-9-]+)`).exec(src.lines.map((l) => l.split('| ')[1] ?? '').join(' '))?.[1];
  if (into) {
    for (const e of pass1.edges.filter((x) => x.from === `prog:${program}` && x.rel === 'copies')) {
      const book = pass1.nodes.find((n) => n.id === e.to);
      if (!book?.file) continue;
      const c = numbered(book.file, readFileSync(join(root, book.file), 'utf8'));
      if (c.lines.some((l) => new RegExp(`\\b01\\s+${into}\\b`).test(l))) { lines.push(...c.lines); refs.push(...c.refs); break; }
    }
  }
  const books = new Map(pass1.edges.filter((x) => x.from === `prog:${program}` && x.rel === 'copies')
    .map((x) => pass1.nodes.find((n) => n.id === x.to)).filter((n) => n?.file).map((n) => [n!.id.slice(4), readFileSync(join(root, n!.file!), 'utf8')] as const));
  const text = readFileSync(join(root, node.file), 'utf8');
  const size = recordSizes(text, books).find((l) => l.startsWith(`${file} `));
  // Byte positions computed by code, so the comparison is between numbers, not the model's arithmetic.
  const record = into ?? /\|\s*01\s+([A-Z0-9-]+)/.exec(lines[1] ?? '')?.[1];
  const fields = record ? layoutOf(expandCopies(text, books), record) : [];
  const table = fields.length ? [`FIELDS of ${record} (bytes are 1-based, computed by code)`, ...fields.map((f) => `  ${f.name} bytes ${f.offset + 1}-${f.offset + f.length} (${f.length}, ${f.kind}${f.scale ? `, ${f.scale} decimals` : ''}${f.signed ? ', signed' : ''})`)] : [];
  return { title: `${program} (${size ?? file})`, lines: [...lines, ...table], refs };
}

/**
 * Cross-program pass (spec §3.5): for each dataset that two or more of the read programs touch, Nemotron
 * compares how each one lays out and uses it, and reports mismatches and conflicting rules.
 */
async function crossRead(opts: Part2Options, results: PackResult[]): Promise<{ findings: Finding[]; dropped: Dropped[] }> {
  const { pass1, root, provider } = opts;
  const read = new Set(results.map((r) => `prog:${r.program}`));
  const shared = new Map<string, typeof pass1.edges>();
  for (const e of pass1.edges) {
    if (!['read', 'write'].includes(e.rel) || !read.has(e.from) || !e.to.startsWith('data:')) continue;
    if (!shared.has(e.to)) shared.set(e.to, []);
    shared.get(e.to)!.push(e);
  }
  const targets = [...shared].filter(([, es]) => new Set(es.map((e) => e.from)).size >= 2);
  const outcomes = await pool(targets, opts.concurrency, async ([dataset, edges]) => {
    const programs = [...new Set(edges.map((e) => e.from.slice(5)))];
    const layouts = programs.map((p) => layoutFor(pass1, root, p, edges.find((e) => e.from === `prog:${p}`)!)).filter((x): x is Extra => !!x);
    const notes = results.filter((r) => programs.includes(r.program)).flatMap((r) => r.findings
      .filter((f) => f.kind !== 'connection' && f.summary.toUpperCase().includes((dataset.split('.')[3] ?? dataset).toUpperCase().slice(0, 6)))
      .map((f) => `${r.program} ${f.kind}: ${f.summary} [${f.evidence.join(', ')}]`));
    const r = await readCross(provider, {
      dataset, programs, layouts, notes,
      uses: edges.map((e) => `${e.from.slice(5)} ${e.rel} evidence ${e.evidence}${e.via ? ` via ${e.via}` : ''}`),
    }, opts.maxOutputTokens);
    opts.onLog?.(`cross-program ${dataset.replace(/^data:/, '')}: ${r.findings.length} findings`);
    return r;
  });
  return { findings: outcomes.flatMap((o) => o.findings), dropped: outcomes.flatMap((o) => o.dropped) };
}

export async function runPart2(opts: Part2Options): Promise<Part2> {
  const { pass1 } = opts;
  const wanted = (opts.programs?.length ? opts.programs : pass1.inventory.programs).filter((p) => pass1.nodes.some((n) => n.id === `prog:${p}`));
  let done = 0;
  const reads = await pool(wanted, opts.concurrency, async (program) => {
    opts.onLog?.(`${program}: reading`);
    const r = await readProgram(opts, program);
    opts.onProgress?.(program, ++done, wanted.length);
    opts.onResult?.(r.result);
    opts.onLog?.(`${program}: ${r.result.findings.length} findings, ${r.result.questions.length} questions, ${r.result.coverage.explained}/${r.result.coverage.connections} links explained`);
    return r;
  });
  const results = reads.map((r) => r.result);
  const cross = await crossRead(opts, results);

  // What nobody could verify: Part 1's open items, links whose line never ran, and code that never ran.
  const runtime = opts.runtime;
  const inScope = new Set(wanted);
  const notVerified: Part2['notVerified'] = [
    ...pass1.unresolved.filter((u) => inScope.has(u.program)).map((u) => ({ kind: 'unresolved' as const, ref: `${u.program}: ${u.what} ${u.token} (${u.at})` })),
    ...(runtime?.edges ?? []).filter((e) => e.mark === 'never-fired' && inScope.has(e.from.slice(5))).map((e) => ({ kind: 'never-fired' as const, ref: `${e.from.slice(5)} ${e.rel} ${e.to} (${e.evidence})` })),
    ...wanted.flatMap((p) => {
      const run = runtime?.programs.find((x) => x.program === p);
      if (!run || run.status !== 'ran') return [{ kind: 'never-ran' as const, ref: `${p}: ${run?.reason ?? 'not run in the sandbox'}` }];
      return run.paragraphs.neverRan.map((para) => ({ kind: 'never-ran' as const, ref: `${p}: paragraph ${para}` }));
    }),
  ];

  return {
    version: 1,
    commit: pass1.commit,
    model: reads.find((r) => r.model !== 'mock')?.model ?? reads[0]?.model ?? opts.provider.mode,
    results,
    crossProgram: [...crossProgramChecks(pass1), ...cross.findings],
    notVerified,
    dropped: [...reads.flatMap((r) => r.dropped), ...cross.dropped],
  };
}
