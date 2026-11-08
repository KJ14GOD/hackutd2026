// Rewrites one batch program into Java and shadows it against the COBOL:
//   write (Nemotron, streamed) -> compile (javac in Docker) -> fix passes on compile errors -> run every scenario the
//   COBOL ran -> diff the printed output line by line -> optionally one fix pass fed with the mismatches.
// The best version (highest match rate) is kept. Nothing is simulated: a program that never compiles is 'failed'
// with its javac log, and one with no COBOL run to compare against is 'not-runnable'.
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage, LlmProvider } from '../../../packages/llm/src/index';
import type { Part2 } from '../../reader/src/contract';
import { recordSizes } from '../../reader/src/pack';
import { fileDefs, openModes } from '../../runtime/src/cobolFiles';
import type { Pass1 } from '../../segmenter/src/types';
import { normalizeLines } from '../../segmenter/src/inventory';
import { cleanCobolOutput, cleanJavaOutput, diffLines, groupMismatches, onlySignOrLastDigit, overpunchCount } from './diff';
import { compileFixPrompt, diffFixPrompt, extractJava, writePrompt, type PromptInput } from './prompt';
import { compile, runScenarios, scenarioNames } from './sandbox';
import type { Mismatch, MismatchCategory, Pass, RewriteEvent, RewriteResult, ScenarioResult } from './types';

export interface RewriteOptions {
  program: string;
  root: string;
  pass1: Pass1;
  part2: Part2;
  /** The Runtime witness's work dir: stage/<program>/sc/<scenario>/{data,env.sh} and out/<program>/<scenario>/{stdout.txt,rc}. */
  runtimeDir: string;
  /** Scratch space for the Java build. */
  workDir: string;
  provider: LlmProvider;
  maxCompileFixes: number;
  maxDiffFixes: number;
  maxOutputTokens: number;
  /**
   * Owner answers to earlier mismatch questions. accept: the difference is fine, its lines count as settled; otherwise
   * the decision text goes into the prompt so the rewrite follows it.
   */
  decisions?: { cause: string; decision: string; accept: boolean }[];
  emit?: (e: RewriteEvent) => void;
}

const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '');

export function promptInput(o: RewriteOptions): PromptInput | string {
  const { program, root, pass1, part2 } = o;
  const node = pass1.nodes.find((n) => n.id === `prog:${program}`);
  if (!node?.file) return `${program} is not in the map`;
  const source = readFileSync(join(root, node.file), 'utf8');
  const books = pass1.edges.filter((e) => e.from === `prog:${program}` && e.rel === 'copies').map((e) => pass1.nodes.find((n) => n.id === e.to)).filter((n) => n?.file)
    .map((n) => ({ name: n!.id.slice(4), text: readFileSync(join(root, n!.file!), 'utf8') }));
  const modes = openModes(source);
  const normal = join(o.runtimeDir, 'out', program, 'normal');
  if (!existsSync(join(normal, 'stdout.txt'))) return `${program} has no COBOL run to compare with (Runtime didn't run it)`;
  const parm = /THESEUS_PARM='([^']*)'/.exec(read(join(o.runtimeDir, 'stage', program, 'sc', 'normal', 'env.sh')))?.[1] ?? '';
  const dataDir = join(o.runtimeDir, 'stage', program, 'sc', 'normal', 'data');
  const inputSamples = existsSync(dataDir) ? readdirSync(dataDir).filter((f) => f.endsWith('.txt')).sort().map((f) => ({ dd: f.replace(/\.txt$/, ''), records: read(join(dataDir, f)).split('\n').filter((l) => l.trim()).slice(0, 2).map((l) => l.slice(0, 400)) })) : [];
  return {
    program, source, copybooks: books,
    recordSizes: recordSizes(source, new Map(books.map((b) => [b.name, b.text]))),
    files: fileDefs(source).filter((d) => !d.isSort).map((d) => ({ file: d.file, dd: d.dd, organization: d.organization, mode: modes.get(d.file) ?? 'not opened' })),
    rules: (part2.results.find((r) => r.program === program)?.findings ?? []).filter((f) => f.kind === 'rule').slice(0, 10).map((f) => f.summary),
    parm, sampleOutput: cleanCobolOutput(read(join(normal, 'stdout.txt'))).slice(0, 60), sampleRc: Number(read(join(normal, 'rc')).trim() || 0),
    decisions: (o.decisions ?? []).filter((d) => !d.accept).map((d) => `Where ${d.cause}: ${d.decision}`),
    inputSamples,
    externalCalls: [...new Set(pass1.edges.filter((e) => e.from === `prog:${program}` && ['calls', 'uses-api'].includes(e.rel) && !e.to.startsWith('prog:')).map((e) => e.to.split(':').pop()!))],
  };
}

export async function rewrite(o: RewriteOptions): Promise<RewriteResult> {
  const emit = o.emit ?? (() => {});
  const started = Date.now();
  const zero = () => ({ formatting: 0, rounding: 0, noise: 0, logic: 0, baseline: 0 });
  const empty = { matchRate: 0, effectiveMatchRate: 0, byCategory: zero(), byCategoryLines: zero(), groups: [], decisions: [], scenarios: [] as ScenarioResult[], passes: [] as Pass[], java: '', model: o.provider.mode as string };
  const input = promptInput(o);
  if (typeof input === 'string') {
    const result: RewriteResult = { version: 1, program: o.program, status: 'not-runnable', reason: input, ...empty, startedAt: new Date(started).toISOString(), ms: 0 };
    emit({ type: 'done', result });
    return result;
  }
  const stageSc = join(o.runtimeDir, 'stage', o.program, 'sc');
  const scenarios = scenarioNames(stageSc);
  const dds = input.files.map((f) => f.dd);
  mkdirSync(o.workDir, { recursive: true });
  let model = o.provider.mode as string;
  let pass = 0;

  // Paragraphs and their line ranges, so the stream can say which COBOL lines the Java is translating.
  const file = o.pass1.nodes.find((n) => n.id === `prog:${o.program}`)!.file!;
  const lines = normalizeLines(input.source);
  const procStart = lines.findIndex((l) => /\bPROCEDURE\s+DIVISION\b/.test(l.text));
  const heads = lines.slice(procStart + 1).filter((l) => /^ {0,3}[A-Z0-9][A-Z0-9-]*\.\s*$/.test(l.text) && /[A-Z]/.test(l.text) && !/^ *(EXIT|GOBACK)\./.test(l.text));
  const paragraphs = heads.map((h, i) => ({ label: h.text.trim().replace(/\.$/, ''), key: h.text.replace(/[^A-Z0-9]/g, ''), ref: `${file}:${h.no}-${(heads[i + 1]?.no ?? lines[lines.length - 1].no + 1) - 1}` })).filter((p) => p.key.length >= 6);
  const ask = async (messages: ChatMessage[]) => {
    let window = '', focused = '';
    const onChunk = (text: string) => {
      emit({ type: 'token', text, pass });
      window = (window + text).slice(-160);
      const flat = window.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const hit = paragraphs.find((p) => flat.includes(p.key));
      if (hit && hit.label !== focused) { focused = hit.label; window = ''; emit({ type: 'focus', ref: hit.ref, label: hit.label, pass }); }
    };
    const reply = await o.provider.complete({ role: 'strong', maxTokens: o.maxOutputTokens, messages, onChunk });
    model = reply.model;
    return extractJava(reply.text);
  };

  /** Compiles, fixing what javac rejects up to maxCompileFixes times. Returns the compiling file or null. */
  const compileWithFixes = async (java: string, passes: Pass[], kind: Pass['kind']): Promise<string | null> => {
    emit({ type: 'stage', stage: 'compiling', message: `javac, pass ${pass}`, pass });
    let c = await compile(o.workDir, java);
    passes.push({ kind, compileOk: c.ok, compileLog: c.ok ? '' : c.log });
    for (let fix = 0; !c.ok && fix < o.maxCompileFixes; fix++) {
      emit({ type: 'compile_error', text: c.log, pass });
      pass++;
      emit({ type: 'fix_pass', pass, reason: 'compile', reset: true });
      emit({ type: 'stage', stage: 'fixing', message: `Nemotron fixes what javac rejected (fix ${fix + 1} of ${o.maxCompileFixes})`, pass });
      java = await ask(compileFixPrompt(input, java, c.log));
      emit({ type: 'stage', stage: 'compiling', message: `javac, pass ${pass}`, pass });
      c = await compile(o.workDir, java);
      passes.push({ kind: 'compile-fix', compileOk: c.ok, compileLog: c.ok ? '' : c.log });
    }
    if (!c.ok) { emit({ type: 'compile_error', text: c.log, pass }); return null; }
    emit({ type: 'compiled', pass });
    return java;
  };

  /** What the Java wrote to stderr in the last shadow run, for the next fix pass. */
  let crashes: { scenario: string; stderr: string }[] = [];
  /** Runs every scenario and diffs it against the COBOL run. */
  const shadow = async (): Promise<ScenarioResult[]> => {
    emit({ type: 'stage', stage: 'running', message: `Running the Java on the ${scenarios.length} scenarios the COBOL ran`, pass });
    const runs = await runScenarios(o.workDir, stageSc, scenarios, dds);
    crashes = scenarios.filter((sc) => /Exception|Error/.test(runs[sc].stderr)).map((sc) => ({ scenario: sc, stderr: runs[sc].stderr }));
    emit({ type: 'stage', stage: 'diffing', message: 'Comparing printed output line by line', pass });
    return scenarios.map((sc) => {
      const expected = cleanCobolOutput(read(join(o.runtimeDir, 'out', o.program, sc, 'stdout.txt')));
      const expectedRc = Number(read(join(o.runtimeDir, 'out', o.program, sc, 'rc')).trim() || 0);
      const actual = cleanJavaOutput(runs[sc].stdout);
      emit({ type: 'run', scenario: sc, rc: runs[sc].rc, expectedRc, ms: runs[sc].ms, lines: actual.slice(0, 200) });
      const d = diffLines(sc, expected, actual);
      // The return code counts as one more compared line.
      const rcOk = runs[sc].rc === expectedRc;
      const mismatches: Mismatch[] = [...(rcOk ? [] : [{ scenario: sc, line: 0, old: `exit ${expectedRc}`, new: `exit ${runs[sc].rc}`, category: 'logic' as MismatchCategory }]), ...d.mismatches];
      const matched = d.matched + (rcOk ? 1 : 0), total = d.total + 1;
      const r: ScenarioResult = { name: sc, expectedRc, actualRc: runs[sc].rc, matched, total, matchRate: Math.round((matched / total) * 1000) / 1000, mismatches, ms: runs[sc].ms,
        ...(runs[sc].stderr.trim() ? { stderr: runs[sc].stderr.split('\n').slice(0, 25).join('\n') } : {}) };
      emit({ type: 'diff', scenario: sc, matchRate: r.matchRate, matched, total, mismatches: mismatches.slice(0, 50) });
      return r;
    });
  };
  const overall = (s: ScenarioResult[]) => { const t = s.reduce((n, x) => n + x.total, 0); return t ? Math.round((s.reduce((n, x) => n + x.matched, 0) / t) * 1000) / 1000 : 0; };

  const passes: Pass[] = [];
  emit({ type: 'stage', stage: 'writing', message: `Nemotron writes ${o.program} in Java`, pass });
  let java = await compileWithFixes(await ask(writePrompt(input)), passes, 'write');
  let best: { java: string; scenarios: ScenarioResult[]; rate: number } | null = null;
  if (java) {
    const s = await shadow();
    best = { java, scenarios: s, rate: overall(s) };
    passes[passes.length - 1].matchRate = best.rate;
    for (let k = 0; k < o.maxDiffFixes && best.rate < 1; k++) {
      pass++;
      emit({ type: 'fix_pass', pass, reason: 'diff', reset: true });
      emit({ type: 'stage', stage: 'fixing', message: `Nemotron fixes the lines that differ (${best.scenarios.reduce((n, x) => n + x.mismatches.length, 0)} mismatches)`, pass });
      java = await compileWithFixes(await ask(diffFixPrompt(input, best.java, best.scenarios.flatMap((x) => x.mismatches), crashes)), passes, 'diff-fix');
      if (!java) break;
      const s2 = await shadow();
      passes[passes.length - 1].matchRate = overall(s2);
      if (overall(s2) > best.rate) best = { java, scenarios: s2, rate: overall(s2) };
    }
  }
  const result: RewriteResult = finalize({
    version: 1, program: o.program, status: best ? 'shadowed' : 'failed', ...(best ? {} : { reason: 'The Java never compiled; see the javac log in the last pass' }),
    model, java: best?.java ?? '', passes, scenarios: best?.scenarios ?? [], matchRate: best?.rate ?? 0, effectiveMatchRate: best?.rate ?? 0, byCategory: zero(), byCategoryLines: zero(), groups: [],
    decisions: (o.decisions ?? []).map((d) => `${d.cause}: ${d.decision}`),
    startedAt: new Date(started).toISOString(), ms: Date.now() - started,
  }, o.decisions ?? [], baselineScenarios(o.runtimeDir, o.program));
  emit({ type: 'stage', stage: 'done', message: best ? `${o.program}: ${Math.round(result.matchRate * 100)}% of lines match the COBOL` : `${o.program}: did not compile`, pass });
  emit({ type: 'done', result });
  return result;
}

/**
 * Groups the mismatches by root cause, applies the owner's answers (an accepted cause's lines count as matched),
 * and recomputes the counts. Used after a run, and on its own when an answer accepts a difference without a rerun.
 */
export function finalize(r: RewriteResult, decisions: { cause: string; decision: string; accept: boolean }[], baselineScenarios: Set<string> = new Set()): RewriteResult {
  // Mismatches the legacy run causes: the scenario feeds mainframe sign overpunch that GnuCOBOL decodes unlike z/OS,
  // and the lines differ only in a last digit or sign. Checked by code; everything else keeps its category.
  const scenarios = r.scenarios.map((s) => ({ ...s, mismatches: s.mismatches.map((m) => (baselineScenarios.has(s.name) && onlySignOrLastDigit(m.old, m.new) ? { ...m, category: 'baseline' as const } : m)) }));
  r = { ...r, scenarios };
  const groups = groupMismatches(r.scenarios.flatMap((s) => s.mismatches)).map((g) => {
    const d = decisions.find((x) => x.cause === g.cause);
    return d ? { ...g, decision: d.decision, accepted: d.accept } : g;
  });
  const accepted = groups.filter((g) => g.accepted).reduce((n, g) => n + g.lines, 0);
  const total = r.scenarios.reduce((n, s) => n + s.total, 0);
  const matched = r.scenarios.reduce((n, s) => n + s.matched, 0) + accepted;
  const byCategory = { formatting: 0, rounding: 0, noise: 0, logic: 0, baseline: 0 };
  const byCategoryLines = { formatting: 0, rounding: 0, noise: 0, logic: 0, baseline: 0 };
  for (const g of groups.filter((x) => !x.accepted)) { byCategory[g.category]++; byCategoryLines[g.category] += g.lines; }
  const rate = (n: number) => (total ? Math.round((Math.min(n, total) / total) * 1000) / 1000 : 0);
  return { ...r, groups, byCategory, byCategoryLines, matchRate: rate(matched), effectiveMatchRate: rate(matched + byCategoryLines.baseline) };
}

/** Scenarios whose input carries more mainframe sign overpunch than the normal run's (so GnuCOBOL's reading of it differs). */
export function baselineScenarios(runtimeDir: string, program: string): Set<string> {
  const scDir = join(runtimeDir, 'stage', program, 'sc');
  if (!existsSync(scDir)) return new Set();
  const count = (sc: string) => {
    const d = join(scDir, sc, 'data');
    return existsSync(d) ? readdirSync(d).reduce((n, f) => n + overpunchCount(read(join(d, f))), 0) : 0;
  };
  const normal = count('normal');
  return new Set(readdirSync(scDir).filter((sc) => sc !== 'normal' && count(sc) > normal));
}
