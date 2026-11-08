// Runtime witness (docs/SPEC_DEPENDENCY_PASSES.md §2). Compiles each batch program with GnuCOBOL
// inside a Docker sandbox (no network, capped memory and time), loads the sample data its job
// step names, runs it under the stress scenarios, and traces every statement that executes.
// A Part 1 link is confirmed when its evidence line ran, never-fired when no scenario reached it,
// and a link the run made that Part 1 lacks is added. DB2 programs run against a PostgreSQL inside
// the same container, through the Open-COBOL-ESQL translator.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLines, readRepo, type SourceFile } from '../../segmenter/src/inventory';
import type { Edge, Pass1 } from '../../segmenter/src/types';
import { fileDefs, loaderSource, openModes, type FileDef } from './cobolFiles';
import { expandCopies, layoutOf, recordReadFrom, testedValues } from './layout';
import { buildScenarios, dateFromParm, synthesize, type Scenario } from './scenarios';
import { sqlCopybook, sqlProgram } from './sqlSource';
import type { EdgeMark, ProgramRun, Runtime, RuntimeEvent, ScenarioResult } from './types';

export const IMAGE = 'theseus-runtime:2';
const HERE = dirname(fileURLToPath(import.meta.url));
const SECONDS_PER_SCENARIO = 30;

/** Code we can't run outside a mainframe yet: CICS, DB2, IMS and MQ all need their own runtime. */
const NEEDS = [
  { re: /\bEXEC\s+CICS\b/, what: 'CICS' },
  { re: /\bEXEC\s+SQL\b/, what: 'DB2' },
  { re: /\bEXEC\s+DLI\b|CBLTDLI|AIBTDLI/, what: 'IMS' },
  { re: /\bMQ(?:OPEN|GET|PUT|CONN)\b/, what: 'MQ' },
];

const VERBS = new Set(['ACCEPT', 'ADD', 'CALL', 'CLOSE', 'COMPUTE', 'CONTINUE', 'DELETE', 'DISPLAY', 'DIVIDE', 'EVALUATE', 'EXEC', 'EXIT',
  'GO', 'GOBACK', 'IF', 'INITIALIZE', 'INSPECT', 'MERGE', 'MOVE', 'MULTIPLY', 'OPEN', 'PERFORM', 'READ', 'RELEASE', 'RETURN',
  'REWRITE', 'SEARCH', 'SET', 'SORT', 'START', 'STOP', 'STRING', 'SUBTRACT', 'UNSTRING', 'WRITE']);

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

/** Runs a command, sending each output line to `onLine` as it arrives. */
function stream(cmd: string, args: string[], onLine: (line: string) => void): Promise<{ code: number; log: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
    let log = '', partial = '';
    const take = (d: Buffer) => {
      log += d;
      const parts = (partial + d).split('\n');
      partial = parts.pop() ?? '';
      for (const l of parts) if (l.trim()) onLine(l.trimEnd());
    };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('close', (code) => { if (partial.trim()) onLine(partial.trimEnd()); resolve({ code: code ?? 1, log }); });
  });
}

/** Builds the sandbox image the first time, so nobody has to run docker by hand. */
export async function ensureImage(emit: (e: RuntimeEvent) => void): Promise<void> {
  if (!run('docker', ['info', '--format', '{{.ServerVersion}}']).ok) throw new Error('Docker isn’t running. Start Docker Desktop and try again.');
  if (run('docker', ['image', 'inspect', IMAGE]).ok) return;
  emit({ type: 'stage', message: 'Building the sandbox: GnuCOBOL, PostgreSQL and the SQL translator (first run only, a few minutes)' });
  const built = await stream('docker', ['build', '--progress=plain', '-t', IMAGE, join(HERE, '../docker')], (line) => emit({ type: 'log', line }));
  if (built.code !== 0) throw new Error(`Couldn’t build the sandbox image: ${built.log.slice(-400)}`);
}

/** "dailytran" and "DALYTRAN" match: same consonants, or one is a prefix of the other. */
const skeleton = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/[aeiou]/g, '');
function sampleFor(dataset: string, samples: SourceFile[]): SourceFile | undefined {
  const parts = dataset.split('.');
  const q = (parts.length > 3 ? parts[3] : parts[parts.length - 1]).toLowerCase();
  return samples.find((s) => {
    const n = posix.basename(s.path).replace(/\.[^.]+$/, '').toLowerCase();
    return n === q || skeleton(n) === skeleton(q) || (n.length >= 5 && (q.startsWith(n) || n.startsWith(q)));
  });
}

/** Paragraph and section names in the procedure division, in order. */
function paragraphs(text: string): string[] {
  const lines = normalizeLines(text);
  const start = lines.findIndex((l) => /\bPROCEDURE\s+DIVISION\b/.test(l.text));
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = /^ {0,3}([A-Z0-9][A-Z0-9-]*)(?:\s+SECTION)?\.\s*$/.exec(l.text);
    if (m && !VERBS.has(m[1]) && m[1] !== 'EXIT') out.push(m[1]);
  }
  return out;
}

/** For each procedure line, the line its statement starts on, which is what the trace reports. */
function statementStarts(text: string): Map<number, number> {
  const lines = normalizeLines(text);
  const start = lines.findIndex((l) => /\bPROCEDURE\s+DIVISION\b/.test(l.text));
  const map = new Map<number, number>();
  let current = -1;
  for (const l of lines.slice(start + 1)) {
    const first = /^\s*([A-Z-]+)/.exec(l.text)?.[1] ?? '';
    if (VERBS.has(first)) current = l.no;
    if (current > 0) map.set(l.no, current);
  }
  return map;
}

interface Trace { lines: Map<string, Set<number>>; paragraphs: Set<string>; entries: Set<string>; statements: number }

/** A translated SQL source in the container, mapped back to the original file and its line numbers. */
interface Alias { path: string; lines: number[] }

function parseTrace(path: string, aliases: Map<string, Alias>): Trace {
  const t: Trace = { lines: new Map(), paragraphs: new Set(), entries: new Set(), statements: 0 };
  if (!existsSync(path)) return t;
  let source = '';
  let alias: Alias | undefined;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const src = /^Source:\s+'(.+)'/.exec(raw);
    if (src) { alias = aliases.get(src[1]); source = alias?.path ?? src[1].replace(/^\/src\//, ''); continue; }
    const m = /^Program-Id:\s+(\S+)\s+(.*?)\s*Line:\s+(\d+)/.exec(raw);
    if (!m) continue;
    const [, prog, what, line] = m;
    const n = alias ? alias.lines[Number(line) - 1] ?? 0 : Number(line);
    if (!t.lines.has(source)) t.lines.set(source, new Set());
    t.lines.get(source)!.add(n);
    t.statements++;
    const para = /Paragraph:\s+(\S+)|Section:\s+(\S+)/.exec(what);
    if (para) t.paragraphs.add(`${prog}:${para[1] ?? para[2]}`);
    if (/^Entry:/.test(what)) t.entries.add(prog);
  }
  return t;
}

/**
 * The SQL translator rewrites EXEC SQL blocks, which shifts line numbers. Walks the translated file
 * and the original together, so each translated line maps to the original line it came from.
 */
export function alignLines(original: string, translated: string): number[] {
  // Comments never match. The translator marks lines it commented out as OCESQL* in columns 1-7.
  const origCode = (l: string) => ('*/'.includes(l[6] ?? ' ') ? '' : l.slice(7, 72).trim().toUpperCase());
  // Other OCESQL lines are the translator's own code or inlined copybooks; they never match either.
  const code = (l: string) => (l.startsWith('OCESQL*') ? l.slice(7, 72).trim().toUpperCase() : l.startsWith('OCESQL') ? '' : origCode(l));
  const orig = original.split(/\r?\n/).map(origCode);
  const map: number[] = [];
  let i = 0, last = 1;
  for (const line of translated.split(/\r?\n/)) {
    const c = code(line);
    // Commented-out SQL comes right where it was, so it may only match nearby; inlined copybook comments look the same.
    const reach = line.startsWith('OCESQL*') ? 3 : 400;
    let seen = 0;
    if (c) for (let k = i; k < orig.length && seen < reach; k++) {
      if (!orig[k]) continue; // comments and blank lines don't count toward the reach
      if (orig[k] === c) { last = k + 1; i = k + 1; break; }
      seen++;
    }
    map.push(last);
  }
  return map;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

interface Table { name: string; ddl: string; seed: string[] }

interface Plan {
  program: string;
  file: SourceFile;
  job?: string;
  parm: string;
  modules: SourceFile[];
  stubs: string[];
  defs: FileDef[];
  /** Every input that gets loaded, with the text of its normal run. */
  inputs: { def: FileDef; text: string }[];
  missingData: string[];
  synthesized: string[];
  mappedDds: Set<string>;
  scenarios: Scenario[];
  /** Set when the program uses DB2: the tables to recreate in PostgreSQL. */
  tables?: Table[];
}

interface Context {
  pass1: Pass1;
  programs: Map<string, SourceFile>;
  copybooks: Map<string, string>;
  samples: SourceFile[];
  dbDefs: SourceFile[];
}

const isSequentialRead = (d: FileDef) => d.organization !== 'indexed' || /ACCESS\s+MODE\s+(?:IS\s+)?SEQUENTIAL/.test(d.select);

function planFor(program: string, file: SourceFile, ctx: Context, sql: boolean): Plan {
  const { pass1, programs, copybooks, samples } = ctx;
  const id = `prog:${program}`;
  const step = pass1.edges.find((e) => e.rel === 'runs' && e.to === id && e.from.startsWith('job:'));
  const jcl = step?.evidence.split(':')[0];
  const parm = /^PARM\s+(?!via\b)(.*)$/.exec(step?.via ?? '')?.[1]?.trim() ?? '';

  // This program plus every application program it calls, transitively.
  const modules = new Map<string, SourceFile>([[program, file]]);
  const stubs = new Set<string>();
  const queue = [program];
  while (queue.length) {
    const p = queue.pop()!;
    for (const e of pass1.edges) {
      if (e.from !== `prog:${p}` || !['calls', 'uses-api'].includes(e.rel)) continue;
      const name = e.to.split(':').pop()!;
      const src = programs.get(name);
      if (e.to.startsWith('prog:') && src && !modules.has(name)) { modules.set(name, src); queue.push(name); }
      else if (!src) stubs.add(name);
    }
  }

  const defs = fileDefs(file.text).filter((d) => !d.isSort);
  const modes = openModes(file.text);
  const ddToDataset = new Map<string, string>();
  for (const e of pass1.edges) {
    if (e.from !== id || !['read', 'write'].includes(e.rel) || !e.to.startsWith('data:')) continue;
    const m = /->\s+DD\s+(\S+)\s+\(([^:)]+)/.exec(e.via ?? '');
    if (m && (!jcl || m[2] === jcl)) ddToDataset.set(m[1], e.to.slice(5));
  }
  const lines = expandCopies(file.text, copybooks);
  const reads = defs.filter((d) => ['INPUT', 'I-O', 'EXTEND'].includes(modes.get(d.file) ?? ''));
  const drivingDef = reads.find((d) => modes.get(d.file) === 'INPUT' && isSequentialRead(d));

  const inputs: Plan['inputs'] = [];
  const missingData: string[] = [];
  const synthesized: string[] = [];
  let driving: Parameters<typeof buildScenarios>[0]['driving'];
  const others: Parameters<typeof buildScenarios>[0]['others'] = [];
  for (const def of reads) {
    const dataset = ddToDataset.get(def.dd);
    const sample = dataset ? sampleFor(dataset, samples) : undefined;
    let text = sample?.text.replace(/\r/g, '');
    if (def === drivingDef) {
      const record = recordReadFrom(lines, def.file, def.record);
      const fields = layoutOf(lines, record).length ? layoutOf(lines, record) : layoutOf(lines, def.record);
      const tested = testedValues(lines, fields);
      if (text === undefined && fields.length) { text = synthesize(fields, tested); synthesized.push(def.dd); }
      if (text !== undefined) driving = { dd: def.dd, text, sequential: def.organization !== 'indexed', fields, tested, synthesized: !sample };
    } else if (text !== undefined) {
      others.push({ dd: def.dd, text, lookup: def.organization === 'indexed' && !isSequentialRead(def) });
    }
    if (text === undefined) missingData.push(`${def.dd}${dataset ? ` (${dataset})` : ''}`);
    else inputs.push({ def, text });
  }

  let tables: Table[] | undefined;
  if (sql) {
    tables = [];
    for (const e of pass1.edges.filter((x) => x.from === id && x.to.startsWith('data:db2:'))) {
      const name = e.to.slice('data:db2:'.length);
      if (tables.some((t) => t.name === name)) continue;
      const ddl = ctx.dbDefs.map((d) => new RegExp(`CREATE\\s+TABLE\\s+${name.replace('.', '\\.')}\\s*\\(([\\s\\S]*?)\\)\\s*;`, 'i').exec(d.text)?.[0]).find(Boolean);
      if (ddl) tables.push({ name, ddl, seed: seedRows(name, ddl, samples) });
    }
  }
  return {
    program, file, job: step?.from.slice(4), parm, modules: [...modules.values()], stubs: [...stubs].sort(), defs, inputs, missingData, synthesized,
    mappedDds: new Set(ddToDataset.keys()), scenarios: buildScenarios({ driving, others }), tables,
  };
}

/** Sample rows for a table whose columns are all text, cut by column width from a matching sample file. */
function seedRows(table: string, ddl: string, samples: SourceFile[]): string[] {
  const cols = [...ddl.matchAll(/^\s*\(?\s*([A-Z0-9_]+)\s+(CHAR|VARCHAR)\((\d+)\)/gim)].map((m) => ({ name: m[1], width: Number(m[3]) }));
  if (!cols.length) return [];
  const sk = skeleton(table.split('.').pop() ?? table);
  const isSub = (small: string, big: string) => { let i = 0; for (const c of big) if (c === small[i]) i++; return i === small.length; };
  const match = samples.map((s) => ({ s, k: skeleton(posix.basename(s.path).replace(/\.[^.]+$/, '')) }))
    .filter((x) => x.k.length >= 4 && isSub(x.k, sk)).sort((a, b) => b.k.length - a.k.length)[0];
  if (!match) return [];
  const q = (v: string) => `'${v.trim().replace(/'/g, "''")}'`;
  return match.s.text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    let at = 0;
    const values = cols.map((c) => { const v = l.slice(at, at + c.width); at += c.width; return q(v); });
    return `INSERT INTO ${table} (${cols.map((c) => c.name).join(', ')}) VALUES (${values.join(', ')});`;
  });
}

function stubSource(name: string): string {
  const body = name === 'CEE3ABD'
    ? ["    DISPLAY 'THESEUS-STUB CEE3ABD'.", '    MOVE 16 TO RETURN-CODE.', '    STOP RUN.']
    : [`    DISPLAY 'THESEUS-STUB ${name}'.`, '    GOBACK.'];
  return ['* Recording stub: answers the call and notes that it happened.', 'IDENTIFICATION DIVISION.', `PROGRAM-ID. ${name}.`, 'PROCEDURE DIVISION.', ...body]
    .map((l) => (l.startsWith('*') ? `      ${l}` : `       ${l}`)).join('\n') + '\n';
}

/** Writes everything the container needs into `stage` and returns the script it runs. */
function stagePlan(plan: Plan, stage: string, copyDirs: string[], copyFiles: SourceFile[]): string[] {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, 'cbl'), { recursive: true });
  for (const f of ['RUNDRV.cbl', 'CEE3ABD.cbl', 'SQLDRV.cbl']) writeFileSync(join(stage, 'cbl', f), readFileSync(join(HERE, '../cobol', f)));
  for (const s of plan.stubs.filter((s) => s !== 'CEE3ABD')) writeFileSync(join(stage, 'cbl', `${s}.cbl`), stubSource(s));
  for (const { def } of plan.inputs) writeFileSync(join(stage, 'cbl', `LOAD_${def.dd}.cbl`), loaderSource(def, `LOAD-${def.dd}`.slice(0, 30)));

  const date = dateFromParm(plan.parm);
  for (const sc of plan.scenarios) {
    const dir = join(stage, 'sc', sc.name);
    mkdirSync(join(dir, 'data'), { recursive: true });
    for (const [dd, text] of Object.entries(sc.files)) writeFileSync(join(dir, 'data', `${dd}.txt`), text);
    writeFileSync(join(dir, 'env.sh'), [`export THESEUS_PARM=${shq(plan.parm)}`, `export COB_CURRENT_DATE=${shq(`${date} 01:00:00`)}`].join('\n') + '\n');
  }

  const sql = !!plan.tables;
  if (sql) {
    mkdirSync(join(stage, 'db'), { recursive: true });
    const schemas = [...new Set(plan.tables!.map((t) => t.name.split('.')[0]))];
    writeFileSync(join(stage, 'db', 'setup.sql'), [
      ...schemas.map((s) => `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`),
      ...plan.tables!.flatMap((t) => [t.ddl, ...t.seed]),
    ].join('\n') + '\n');
    writeFileSync(join(stage, 'db', 'tables.txt'), plan.tables!.map((t) => t.name).join('\n') + '\n');
    mkdirSync(join(stage, 'sql'), { recursive: true });
    for (const m of plan.modules) writeFileSync(join(stage, 'sql', `${m.name}.sqb`), sqlProgram(m.text));
    // EXEC SQL INCLUDE looks for the member by bare name next to the source; DCLGEN members can be any kind of file.
    const wanted = new Set(plan.modules.flatMap((m) => [...m.text.toUpperCase().matchAll(/EXEC\s+SQL\s+INCLUDE\s+([A-Z0-9#@$-]+)/g)].map((x) => x[1])));
    for (const c of copyFiles.filter((f) => wanted.has(f.name))) {
      writeFileSync(join(stage, 'sql', c.name), sqlCopybook(c.text));
      writeFileSync(join(stage, 'sql', `${c.name}.cbl`), sqlCopybook(c.text));
    }
  }

  const inc = copyDirs.map((d) => `-I ${shq(`/src/${d}`)}`).join(' ');
  const compile = (m: SourceFile) => [`echo ${shq(`compile ${m.name}${sql ? ' (EXEC SQL -> PostgreSQL)' : ''}`)}`, ...(sql
    ? [`ocesql ${m.name}.sqb ${m.name}.cob >> /out/compile.txt 2>&1 || fail ${shq(m.name)}`,
       `cp ${m.name}.cob /out/${m.name}.cob`,
       `cobc -m -std=ibm -fixed -ftraceall -I /opt/ocesql/copy ${inc} -o ${m.name}.so ${m.name}.cob -locesql >> /out/compile.txt 2>&1 || fail ${shq(m.name)}`]
    : [`cobc -m -std=ibm -fixed -ftraceall ${inc} -o ${m.name}.so ${shq(`/src/${m.path}`)} >> /out/compile.txt 2>&1 || fail ${shq(m.name)}`])];
  const dump = (when: string) => `    i=0; while read t; do i=$((i+1)); psql -qAt -F'|' -c "SELECT * FROM $t ORDER BY 1" > "/out/$n/db-${when}-$i.txt" 2>&1; done < /in/db/tables.txt`;
  return [
    'set -u', 'ulimit -f 400000', 'mkdir -p /work/bin && cd /work/bin && cp /in/cbl/*.cbl .',
    'fail() { echo "$1" > /out/compile-failed; echo "compile failed: $1"; exit 0; }',
    ...(sql ? [
      'echo "start postgresql (stands in for DB2)"',
      'export PGDATA=/work/pg PGHOST=/work/pgsock PGUSER=runner PGDATABASE=carddemo',
      'mkdir -p /work/pgsock && initdb -A trust -U runner >/dev/null 2>&1 || fail postgres-init',
      `pg_ctl -o "-k /work/pgsock -c listen_addresses=''" -l /work/pg.log -w start >/dev/null 2>&1 || fail postgres-start`,
      'createdb -U runner carddemo || fail postgres-createdb',
      // DB2 copybooks pulled in by EXEC SQL INCLUDE are looked up next to the source.
      'cp /in/sql/* .',
    ] : []),
    ...plan.modules.flatMap(compile),
    sql
      ? 'ocesql SQLDRV.cbl SQLDRV.cob >> /out/compile.txt 2>&1 && cobc -x -std=ibm -fixed -I /opt/ocesql/copy SQLDRV.cob -locesql -o RUNDRV >> /out/compile.txt 2>&1 || fail SQLDRV'
      : 'cobc -x -std=ibm -fixed RUNDRV.cbl >> /out/compile.txt 2>&1 || fail RUNDRV',
    'for f in *.cbl; do case $f in RUNDRV.cbl|SQLDRV.cbl) ;; LOAD_*) cobc -x -std=ibm -fixed "$f" >> /out/compile.txt 2>&1 || fail "$f";; *) [ -f "${f%.cbl}.so" ] || [ ! -f "/in/cbl/$f" ] || cobc -m -std=ibm -fixed "$f" >> /out/compile.txt 2>&1 || fail "$f";; esac; done',
    sql ? 'export COB_LIBRARY_PATH=/work/bin:/usr/local/lib COB_PRE_LOAD=libocesql COB_FILE_PATH=.' : 'export COB_LIBRARY_PATH=/work/bin COB_FILE_PATH=.',
    'for sc in /in/sc/*; do',
    '  n=$(basename "$sc"); mkdir -p "/work/run/$n" "/out/$n"; cd "/work/run/$n"',
    '  echo "scenario $n: load $(ls "$sc"/data | wc -l) input files, run"',
    '  ( . "$sc/env.sh"',
    '    for f in "$sc"/data/*.txt; do [ -e "$f" ] || continue; dd=$(basename "$f" .txt); LOADIN="$f" "/work/bin/LOAD_$dd" >> "/out/$n/load.txt" 2>&1; done',
    ...(sql ? ['    psql -q -v ON_ERROR_STOP=1 -f /in/db/setup.sql > "/out/$n/db-setup.txt" 2>&1', dump('before')] : []),
    '    ls > "/out/$n/before.txt"',
    '    s=$(date +%s%N)',
    `    THESEUS_PROGRAM=${plan.program} COB_SET_TRACE=Y COB_TRACE_FILE="/out/$n/trace.txt" timeout ${SECONDS_PER_SCENARIO} /work/bin/RUNDRV > "/out/$n/stdout.txt" 2>&1`,
    '    echo $? > "/out/$n/rc"; echo $(( ($(date +%s%N) - s) / 1000000 )) > "/out/$n/ms"; ls > "/out/$n/after.txt"',
    ...(sql ? [dump('after')] : []),
    '    echo "scenario $n: return code $(cat "/out/$n/rc"), $(grep -c "" "/out/$n/trace.txt" 2>/dev/null || echo 0) trace lines, $(cat "/out/$n/ms") ms"',
    '    grep -v "^THESEUS-" "/out/$n/stdout.txt" | tail -n 2 | sed "s/^/  | /"',
    '  )',
    'done',
  ];
}

function dockerRun(stage: string, out: string, root: string, script: string[], onLine: (line: string) => void): Promise<{ code: number; log: string }> {
  writeFileSync(join(stage, 'run.sh'), script.join('\n') + '\n');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  onLine(`$ docker run --rm --network none --memory 768m ${IMAGE} sh /in/run.sh`);
  return stream('docker', ['run', '--rm', '--network', 'none', '--memory', '768m', '--cpus', '2', '--pids-limit', '256',
    '-v', `${root}:/src:ro`, '-v', `${stage}:/in:ro`, '-v', `${out}:/out`, IMAGE, 'sh', '/in/run.sh'], onLine);
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

export interface WitnessOptions {
  /** Scratch space for staging and container output. */
  workDir: string;
  /** Only these programs (ids without `prog:`); default is every batch program. */
  only?: string[];
  emit?: (e: RuntimeEvent) => void;
}

export async function runWitness(root: string, pass1: Pass1, opts: WitnessOptions): Promise<Runtime> {
  const emit = opts.emit ?? (() => {});
  await ensureImage(emit);
  emit({ type: 'stage', message: 'Reading programs, job steps and sample data' });
  const sources = readRepo(root);
  const programs = new Map(sources.filter((s) => s.kind === 'program').map((s) => [s.name, s]));
  const samples = sources.filter((s) => s.kind === 'data' && /\.(txt|dat|csv)$/i.test(s.path));
  const copyDirs = [...new Set(sources.filter((s) => s.kind === 'copybook').map((s) => posix.dirname(s.path)))];
  const copyFiles = sources.filter((s) => s.kind === 'copybook');
  const copybooks = new Map(copyFiles.map((s) => [s.name, s.text]));
  const ctx: Context = { pass1, programs, copybooks, samples, dbDefs: sources.filter((s) => s.kind === 'db-def') };
  const batch = pass1.nodes.filter((n) => n.kind === 'program' && n.mode === 'batch').map((n) => n.id.slice(5))
    .filter((p) => !opts.only || opts.only.includes(p)).sort();

  const runs: ProgramRun[] = [];
  const marks: EdgeMark[] = [];
  for (const program of batch) {
    const file = programs.get(program);
    const blank = { program, file: file?.path ?? '', scenarios: [], paragraphs: { total: [], neverRan: [] }, missingData: [], synthesized: [] };
    const needs = file && NEEDS.filter((n) => n.re.test(file.text.toUpperCase())).map((n) => n.what);
    // DB2 alone is fine: the sandbox has PostgreSQL. CICS, IMS and MQ still aren't there.
    const sql = needs?.length === 1 && needs[0] === 'DB2';
    if (!file || (needs?.length && !sql)) {
      const reason = file ? `Needs ${needs!.join(' and ')}, which the sandbox doesn’t have yet` : 'No source file';
      runs.push({ ...blank, status: 'skipped', reason });
      emit({ type: 'program', program, status: 'skipped', reason });
      continue;
    }
    const plan = planFor(program, file, ctx, sql);
    if (!plan.job) {
      const reason = 'No job step runs it, so there’s nothing to say what data it gets';
      runs.push({ ...blank, status: 'skipped', reason });
      emit({ type: 'program', program, status: 'skipped', reason });
      continue;
    }
    emit({ type: 'program', program, status: 'running' });
    const stage = join(opts.workDir, 'stage', program), out = join(opts.workDir, 'out', program);
    const result = await dockerRun(stage, out, root, stagePlan(plan, stage, copyDirs, sources), (line) => emit({ type: 'log', program, line }));
    const failedAt = read(join(out, 'compile-failed')).trim();
    if (result.code !== 0 || failedAt) {
      const errors = read(join(out, 'compile.txt')).split('\n').filter((l) => /error/i.test(l)).slice(0, 3).join(' · ');
      const reason = failedAt ? `Didn’t compile under GnuCOBOL (${failedAt}): ${errors || 'see compiler output'}` : `Sandbox failed: ${result.log.slice(-300)}`;
      runs.push({ ...blank, status: 'failed', reason, job: plan.job, parm: plan.parm, missingData: plan.missingData, synthesized: plan.synthesized });
      emit({ type: 'program', program, status: 'failed', reason });
      continue;
    }

    const total = paragraphs(file.text);
    const ranAnywhere = new Set<string>();
    const executed = new Map<string, Set<number>>();
    const linesByScenario = new Map<string, Trace>();
    const scenarios: ScenarioResult[] = [];
    const aliases = new Map<string, Alias>();
    if (sql) for (const m of plan.modules) aliases.set(`${m.name}.cob`, { path: m.path, lines: alignLines(m.text, read(join(out, `${m.name}.cob`))) });
    let normal: Set<string> | undefined;
    for (const sc of plan.scenarios) {
      const dir = join(out, sc.name);
      const trace = parseTrace(join(dir, 'trace.txt'), aliases);
      linesByScenario.set(sc.name, trace);
      for (const [src, set] of trace.lines) {
        if (!executed.has(src)) executed.set(src, new Set());
        for (const n of set) executed.get(src)!.add(n);
      }
      const stdout = read(join(dir, 'stdout.txt'));
      const rc = Number(read(join(dir, 'rc')).trim() || 1);
      const abended = /THESEUS-STUB CEE3ABD/.test(stdout);
      const own = [...trace.paragraphs].filter((p) => p.startsWith(`${program}:`)).map((p) => p.slice(program.length + 1));
      own.forEach((p) => ranAnywhere.add(p));
      const result: ScenarioResult = {
        name: sc.name, label: sc.label, setup: sc.setup, returnCode: rc,
        outcome: rc === 124 ? 'timeout' : abended ? 'abend' : rc === 0 ? 'ok' : rc === 4 ? 'warning' : 'error',
        ms: Number(read(join(dir, 'ms')).trim() || 0),
        messages: stdout.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.startsWith('THESEUS-') && !/warning: implicit CLOSE/.test(l)).slice(-14),
        paragraphsRun: total.filter((p) => own.includes(p)),
        newParagraphs: normal ? total.filter((p) => own.includes(p) && !normal!.has(p)) : [],
        statementsRun: trace.statements,
        dbChanges: sql ? dbChanges(dir, plan.tables!.length) : undefined,
      };
      if (!normal) normal = new Set(own);
      scenarios.push(result);
      emit({ type: 'scenario', program, scenario: result });
    }

    // Compare with Part 1: every link this program's code makes, judged by whether its line ran.
    const starts = new Map(plan.modules.map((m) => [m.path, statementStarts(m.text)]));
    const own = pass1.edges.filter((e) => plan.modules.some((m) => e.from === `prog:${m.name}`) && e.rel !== 'copies');
    for (const e of own) {
      const [path, lineText] = [e.evidence.slice(0, e.evidence.lastIndexOf(':')), e.evidence.slice(e.evidence.lastIndexOf(':') + 1)];
      const start = starts.get(path)?.get(Number(lineText));
      if (!start) continue; // evidence outside the procedure division: nothing to watch at run time
      // Compare statement starts on both sides: translated SQL reports lines inside the EXEC SQL block.
      const ranStart = (t: Trace) => [...(t.lines.get(path) ?? [])].some((n) => (starts.get(path)?.get(n) ?? n) === start);
      const hit = [...linesByScenario].filter(([, t]) => ranStart(t)).map(([n]) => n);
      marks.push(edgeMark(e, hit.length ? 'confirmed' : 'never-fired', hit));
    }
    const step = pass1.edges.find((e) => e.rel === 'runs' && e.to === `prog:${program}` && e.from === `job:${plan.job}`);
    if (step) marks.push(edgeMark(step, 'confirmed', scenarios.filter((s) => s.statementsRun > 0).map((s) => s.name)));

    // Added: programs it entered, routines it called, and files it created that Part 1 didn't list.
    const known = new Set(own.map((e) => e.to.split(':').pop()));
    for (const [name, t] of linesByScenario) {
      for (const entered of t.entries) if (!plan.modules.some((m) => m.name === entered) || (entered !== program && !known.has(entered))) addMark(marks, `prog:${program}`, `prog:${entered}`, 'calls', name);
      for (const m of read(join(out, name, 'stdout.txt')).matchAll(/THESEUS-STUB (\S+)/g)) if (!known.has(m[1])) addMark(marks, `prog:${program}`, `external:${m[1]}`, 'calls', name);
      const before = new Set(read(join(out, name, 'before.txt')).split('\n'));
      for (const f of read(join(out, name, 'after.txt')).split('\n')) {
        if (f && !before.has(f) && plan.defs.some((d) => d.dd === f) && !plan.mappedDds.has(f)) addMark(marks, `prog:${program}`, `dd:${f}`, 'write', name);
      }
    }

    const neverRan = total.filter((p) => !ranAnywhere.has(p));
    runs.push({ program, file: file.path, status: 'ran', job: plan.job, parm: plan.parm, scenarios, paragraphs: { total, neverRan }, missingData: plan.missingData, synthesized: plan.synthesized, tables: plan.tables?.map((t) => t.name) });
    emit({ type: 'program', program, status: 'ran' });
  }

  const count = (m: string) => marks.filter((e) => e.mark === m).length;
  const runtime: Runtime = {
    version: 1, image: IMAGE, programs: runs, edges: marks,
    summary: {
      ran: runs.filter((r) => r.status === 'ran').length, skipped: runs.filter((r) => r.status === 'skipped').length,
      failed: runs.filter((r) => r.status === 'failed').length,
      confirmed: count('confirmed'), neverFired: count('never-fired'), added: count('added'),
    },
  };
  emit({ type: 'done', runtime });
  return runtime;
}

/** Rows a run added (+) or removed (-), table by table, from the dumps taken before and after it. */
function dbChanges(dir: string, tables: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= tables; i++) {
    const before = read(join(dir, `db-before-${i}.txt`)).split('\n').filter(Boolean);
    const after = read(join(dir, `db-after-${i}.txt`)).split('\n').filter(Boolean);
    const b = new Set(before), a = new Set(after);
    for (const r of after) if (!b.has(r)) out.push(`+ ${r}`);
    for (const r of before) if (!a.has(r)) out.push(`- ${r}`);
  }
  return out.slice(0, 20);
}

function edgeMark(e: Edge, mark: EdgeMark['mark'], scenarios: string[]): EdgeMark {
  return { from: e.from, to: e.to, rel: e.rel, evidence: e.evidence, mark, scenarios };
}

function addMark(marks: EdgeMark[], from: string, to: string, rel: string, scenario: string) {
  const found = marks.find((m) => m.mark === 'added' && m.from === from && m.to === to && m.rel === rel);
  if (found) { if (!found.scenarios.includes(scenario)) found.scenarios.push(scenario); return; }
  marks.push({ from, to, rel, evidence: 'observed at run time', mark: 'added', scenarios: [scenario] });
}
