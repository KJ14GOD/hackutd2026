// Context packs (spec §3.2): everything the model may look at for one program, built by code.
// Every line carries its `path:line`, and the set of citable lines is what findings are checked against.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeLines } from '../../segmenter/src/inventory';
import type { Edge, Pass1 } from '../../segmenter/src/types';
import type { Runtime } from '../../runtime/src/types';
import { fileDefs } from '../../runtime/src/cobolFiles';
import { expandCopies, recordLength, recordReadFrom } from '../../runtime/src/layout';

export interface Connection {
  id: string;
  edge: Edge;
}

export interface Pack {
  program: string;
  part: number;
  parts: number;
  text: string;
  connections: Connection[];
  citable: Set<string>;
  tokens: number;
}

/** Rough token estimate: about four characters per token for code. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

const PARAGRAPH = /^\s{0,4}[A-Z0-9][A-Z0-9-]*\.\s*$/;

export function numbered(path: string, text: string): { lines: string[]; refs: string[]; paragraphStarts: number[] } {
  const lines: string[] = [];
  const refs: string[] = [];
  const paragraphStarts: number[] = [];
  for (const l of normalizeLines(text)) {
    if (PARAGRAPH.test(l.text)) paragraphStarts.push(lines.length);
    lines.push(`${path}:${l.no}| ${l.text.trimEnd()}`);
    refs.push(`${path}:${l.no}`);
  }
  return { lines, refs, paragraphStarts };
}

const TASK = `TASK
For this program, using only what is in this pack:
1. Explain every connection listed under CONNECTIONS: one finding of kind "connection" per connection, with "ref" set to its id (C1, C2...), saying what it is for in one line.
2. Report connections you can see in the code that are not listed (kind "missed-connection").
3. Find business rules, including rules driven by data used as configuration (kind "rule").
4. Find suspected defects: silent truncation, unchecked errors, uninitialized fields, unreachable code, date windowing (kind "defect"). Never fix anything; only report.
5. For important input fields, derive edge values from their layout: max, min, zero, negative, blank, one past the limit, special dates (kind "edge-value").
6. For each paragraph listed under COVERAGE as never run, say what condition reaches it (kind "coverage-gap"). If none is listed, report no coverage gaps.
Byte sizes and field offsets: use RECORD SIZES. Do not report truncation or layout mismatches that those sizes contradict.
Valid COBOL, not a defect: abbreviated conditions like IF X = '00' OR '23'; an FD of a key plus one PIC X area read INTO a same-size copybook record; reading an indexed file sequentially.
7. Ask a question for anything the code cannot settle: why a rule exists, whether old behavior is intended, who decides. Each question needs 2-4 short answer options and says whether it blocks the rewrite, the cutover, or nothing.
8. Most programs need nothing more. Only if a specific finding depends on code you cannot see, ask for it in "needMore" (at most 2 items): another program, a copybook or JCL file, or who shares a dataset. Otherwise leave "needMore" out.
Every finding and question must cite at least one line exactly as written at the start of a pack line, like "app/cbl/X.cbl:464", or a connection's evidence. Never cite a line that is not in this pack.
Be brief: each summary is one sentence, under 30 words. Give edge values for the 5 most important input fields only. Cite one to three lines per item.`;

const FORMAT = `OUTPUT
Reply with one JSON object and nothing else:
{"findings":[{"kind":"connection|missed-connection|rule|defect|edge-value|coverage-gap|mismatch","ref":"C1 (connections only)","summary":"...","evidence":["path:line"],"confidence":"high|medium|low"}],
 "questions":[{"text":"...","evidence":["path:line"],"options":["Keep old behavior","Fix it"],"blocks":"rewrite|cutover|none"}],
 "needMore":[{"kind":"file|program|data","id":"path, program name, or dataset name"}]}
Put connection explanations first, then rules, defects, coverage gaps, edge values, and questions last.`;

/**
 * Record sizes computed by code from the PICTURE clauses. Models add byte counts badly (they drop key
 * fields), so the pack states them and the task says to trust them.
 */
export function recordSizes(programText: string, copybooks: Map<string, string>): string[] {
  const lines = expandCopies(programText, copybooks);
  return fileDefs(programText).map((d) => {
    const fd = recordLength(lines, d.record);
    const into = recordReadFrom(lines, d.file, d.record);
    const intoLen = into !== d.record ? recordLength(lines, into) : 0;
    return `${d.file} (DD ${d.dd}, ${d.organization}): FD record ${d.record} = ${fd} bytes${intoLen ? `; read into ${into} = ${intoLen} bytes${intoLen === fd ? ' (same size)' : ` (DIFFERENT by ${Math.abs(intoLen - fd)})`}` : ''}`;
  });
}

/** What Runtime saw for one link: which scenarios ran its line, or why it couldn't be checked. */
function runtimeNote(edge: Edge, runtime: Runtime | undefined, ran: boolean): string {
  if (!runtime) return 'runtime: not run yet';
  if (!ran) return 'runtime: program not run in the sandbox';
  const m = runtime.edges.find((r) => r.from === edge.from && r.to === edge.to && r.rel === edge.rel && r.evidence === edge.evidence);
  if (!m) return edge.rel === 'copies' ? 'runtime: compile-time only' : 'runtime: not observable';
  return m.mark === 'confirmed' ? `runtime: RAN in ${m.scenarios.join(', ')}` : 'runtime: NEVER RAN in any scenario';
}

/**
 * Builds one or more packs for a program; splits by paragraph when the pack is over `maxTokens`.
 * `runtime` is the sandbox result (runtime.json), when Runtime has run.
 */
export function buildPacks(pass1: Pass1, root: string, program: string, maxTokens: number, runtime?: Runtime): Pack[] {
  const node = pass1.nodes.find((n) => n.id === `prog:${program}`);
  if (!node?.file) throw new Error(`program ${program} is not in pass1.json`);
  const id = `prog:${program}`;
  const edges = pass1.edges.filter((e) => e.from === id || e.to === id);
  const connections: Connection[] = edges.map((edge, i) => ({ id: `C${i + 1}`, edge }));

  const src = numbered(node.file, readFileSync(join(root, node.file), 'utf8'));
  const layouts = edges.filter((e) => e.rel === 'copies').map((e) => pass1.nodes.find((n) => n.id === e.to)).filter((n) => n?.file)
    .map((n) => ({ name: n!.id.slice(4), ...numbered(n!.file!, readFileSync(join(root, n!.file!), 'utf8')) }));

  const copybookTexts = new Map(layouts.map((l) => [l.name, readFileSync(join(root, pass1.nodes.find((n) => n.id === `cpy:${l.name}`)!.file!), 'utf8')]));
  const sizes = recordSizes(readFileSync(join(root, node.file), 'utf8'), copybookTexts);
  const touched = [...new Set(edges.filter((e) => e.from === id && e.to.startsWith('data:')).map((e) => e.to))];
  const neighbors = touched.map((d) => {
    const others = pass1.edges.filter((e) => e.to === d && e.from !== id && e.from.startsWith('prog:')).map((e) => `${e.from.slice(5)} ${e.rel}`);
    return `${d}: ${others.length ? [...new Set(others)].join(', ') : 'no other program'}`;
  });
  const run = runtime?.programs.find((p) => p.program === program);
  const ran = run?.status === 'ran';
  const coverage = !runtime ? ['Runtime has not run.']
    : !run || run.status !== 'ran' ? [`Not run in the sandbox: ${run?.reason ?? 'not a batch program'}.`]
    : [
      `Ran under ${run.scenarios.length} scenarios: ${run.scenarios.map((s) => `${s.label} (${s.outcome}, return code ${s.returnCode})`).join('; ')}.`,
      `Paragraphs reached: ${run.paragraphs.total.length - run.paragraphs.neverRan.length} of ${run.paragraphs.total.length}.`,
      `Never run: ${run.paragraphs.neverRan.length ? run.paragraphs.neverRan.join(', ') : 'none'}.`,
    ];
  const open = pass1.unresolved.filter((u) => u.program === program).map((u) => `${u.what}: ${u.token} at ${u.at}${u.candidates ? ` (could be ${u.candidates.join(', ')})` : ''}`);

  const header = (part: number, parts: number) => [
    `PROGRAM ${program} (${node.mode ?? 'batch'}, ${node.lines ?? '?'} lines) file ${node.file}${parts > 1 ? `, part ${part} of ${parts}` : ''}`,
    '',
    'CONNECTIONS (found by static analysis, each with its evidence)',
    ...connections.map((c) => `${c.id} ${c.edge.rel} ${c.edge.to === id ? `from ${c.edge.from}` : c.edge.to} [${c.edge.system}] evidence ${c.edge.evidence}${c.edge.via ? ` via ${c.edge.via}` : ''}; ${runtimeNote(c.edge, runtime, ran)}`),
    '',
    'NEIGHBORS (other programs touching the same data)',
    ...(neighbors.length ? neighbors : ['none']),
    '',
    'OPEN (questions static analysis could not settle)',
    ...(open.length ? open : ['none']),
    '',
    'RECORD SIZES (computed by code from the PICTURE clauses; trust these over your own arithmetic)',
    ...(sizes.length ? sizes : ['no files']),
    '',
    'COVERAGE (from running the program in a sandbox)',
    ...coverage,
    '',
  ];
  const layoutBlock = layouts.flatMap((l) => [`LAYOUT ${l.name}`, ...l.lines, '']);
  const layoutRefs = layouts.flatMap((l) => l.refs);
  const fixed = [...header(1, 1), ...layoutBlock, TASK, '', FORMAT].join('\n');

  // Split the program source at paragraph boundaries until each pack fits.
  const budget = Math.max(200, maxTokens - estimateTokens(fixed));
  const chunks: [number, number][] = [];
  let start = 0;
  let size = 0;
  const cut = new Set(src.paragraphStarts);
  for (let i = 0; i < src.lines.length; i++) {
    size += estimateTokens(src.lines[i] + '\n');
    if (size > budget && cut.has(i) && i > start) {
      chunks.push([start, i]);
      start = i;
      size = estimateTokens(src.lines[i] + '\n');
    }
  }
  chunks.push([start, src.lines.length]);

  return chunks.map(([from, to], k) => {
    const body = src.lines.slice(from, to);
    const text = [...header(k + 1, chunks.length), `SOURCE ${node.file} (comments removed; each line starts with its citation)`, ...body, '', ...layoutBlock, TASK, '', FORMAT].join('\n');
    return {
      program, part: k + 1, parts: chunks.length, text, connections,
      // Connection evidence is shown in the pack (JCL lines included), so it may be cited too.
      citable: new Set([...src.refs.slice(from, to), ...layoutRefs, ...connections.map((c) => c.edge.evidence)]),
      tokens: estimateTokens(text),
    };
  });
}

export interface Extra { title: string; lines: string[]; refs: string[] }

/** The pack again with extra context inserted before the task; its lines become citable. */
export function withExtras(pack: Pack, extras: Extra[]): Pack {
  if (!extras.length) return pack;
  const block = extras.flatMap((e) => [`EXTRA ${e.title} (you asked for this)`, ...e.lines, '']).join('\n');
  const at = pack.text.indexOf('\nTASK\n');
  const text = at >= 0 ? `${pack.text.slice(0, at)}\n${block}${pack.text.slice(at)}` : `${pack.text}\n${block}`;
  return { ...pack, text, citable: new Set([...pack.citable, ...extras.flatMap((e) => e.refs)]), tokens: estimateTokens(text) };
}
