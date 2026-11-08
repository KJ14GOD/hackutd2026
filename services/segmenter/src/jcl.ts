// Job scripts: statements (with continuations and in-stream data), procedures expanded with
// symbolic parameters, and utility wrappers unwrapped to the program they really run.
import type { JclDd, JclStep } from './types';

interface Stmt {
  name: string;
  op: string;
  operands: string;
  line: number;
  instream?: string[];
}

/** Splits JCL into statements. Continuations join; `DD *` and `DD DATA` collect the lines after them. */
export function statements(text: string): Stmt[] {
  const out: Stmt[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.slice(0, 72));
  let current: Stmt | undefined;
  let collecting: Stmt | undefined;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (collecting) {
      if (raw.startsWith('//') || raw.startsWith('/*')) collecting = undefined;
      else { collecting.instream!.push(raw.trimEnd()); continue; }
    }
    if (!raw.startsWith('//') || raw.startsWith('//*')) continue;
    const body = raw.slice(2);
    if (current && /,\s*$/.test(current.operands) && /^\s+\S/.test(body)) {
      current.operands += operandField(body.trim());
      continue;
    }
    const m = /^(\S*)\s+(\S+)\s*(.*)$/.exec(body);
    if (!m) continue;
    current = { name: m[1], op: m[2].toUpperCase(), operands: operandField(m[3]), line: i + 1 };
    out.push(current);
    if (current.op === 'DD' && /^(\*|DATA)(,|$)/.test(current.operands)) {
      current.instream = [];
      collecting = current;
    }
  }
  return out;
}

/** The operand field ends at the first blank outside quotes and parentheses; the rest is a comment. */
function operandField(s: string): string {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === '(') depth++;
    else if (!quoted && ch === ')') depth--;
    else if (!quoted && depth === 0 && ch === ' ') return s.slice(0, i);
  }
  return s;
}

/** KEY=VALUE pairs at the top level of an operand list. Positional operands get keys "#0", "#1"... */
export function keywords(operands: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let quoted = false;
  let start = 0;
  let pos = 0;
  const push = (item: string) => {
    if (!item) return;
    const eq = item.indexOf('=');
    if (eq > 0 && /^[A-Z0-9#@$.]+$/i.test(item.slice(0, eq))) out.set(item.slice(0, eq).toUpperCase(), item.slice(eq + 1));
    else out.set(`#${pos++}`, item);
  };
  for (let i = 0; i <= operands.length; i++) {
    const ch = operands[i];
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === '(') depth++;
    else if (!quoted && ch === ')') depth--;
    else if ((ch === ',' && !quoted && depth === 0) || i === operands.length) {
      push(operands.slice(start, i).trim());
      start = i + 1;
    }
  }
  return out;
}

const unquote = (v: string | undefined) => (v === undefined ? undefined : v.replace(/^'(.*)'$/, '$1'));

export interface Proc {
  name: string;
  params: Map<string, string>;
  stmts: Stmt[];
  path: string;
}

export function parseProc(name: string, text: string, path: string): Proc {
  const stmts = statements(text);
  const head = stmts.find((s) => s.op === 'PROC');
  const params = head ? new Map([...keywords(head.operands)].filter(([k]) => !k.startsWith('#')).map(([k, v]) => [k, unquote(v) ?? ''])) : new Map<string, string>();
  return { name, params, stmts: stmts.filter((s) => s.op !== 'PROC' && s.op !== 'PEND'), path };
}

function substitute(s: string, params: Map<string, string>): string {
  return s.replace(/&([A-Z0-9#@$]+)\.?/gi, (whole, key: string) => params.get(key.toUpperCase()) ?? whole);
}

function ddFrom(stmt: Stmt, name: string, path: string, params: Map<string, string>): JclDd {
  const kw = keywords(substitute(stmt.operands, params));
  const dd: JclDd = { name, evidence: `${path}:${stmt.line}` };
  const dsn = kw.get('DSN') ?? kw.get('DSNAME');
  if (dsn) {
    const gen = /^(.*)\(([+-]?\d+)\)$/.exec(dsn);
    if (gen) { dd.dsn = gen[1]; dd.generation = gen[2]; }
    else dd.dsn = dsn.replace(/\(([A-Z0-9#@$]+)\)$/, '($1)');
  }
  const disp = kw.get('DISP');
  if (disp) dd.disp = disp.replace(/[()]/g, '').split(',')[0] || undefined;
  if (kw.has('SYSOUT')) dd.sysout = true;
  if (stmt.instream) dd.instream = stmt.instream;
  return dd;
}

const UTILITIES = /^(SORT|ICEMAN|SYNCSORT|IDCAMS|IEBGENER|IEFBR14|IEBCOPY|ADRDSSU|IKJEFT01|IKJEFT1A|IKJEFT1B|DFSRRC00|DSNUTILB|FTP|IEBUPDTE|IEHLIST|DFHCSDUP|DSNTEP2|DSNTIAUL)$/;

/** Turns a parsed job into steps, expanding procedures and seeing through TSO and IMS wrappers. */
export function jobSteps(jobName: string, text: string, path: string, procs: Map<string, Proc>): JclStep[] {
  const stmts = statements(text);
  const steps: JclStep[] = [];
  const inline = new Map<string, Proc>();
  // In-stream procedures: PROC ... PEND inside the job.
  for (let i = 0; i < stmts.length; i++) {
    if (stmts[i].op !== 'PROC') continue;
    const end = stmts.findIndex((s, j) => j > i && s.op === 'PEND');
    const body = stmts.slice(i + 1, end < 0 ? undefined : end);
    inline.set(stmts[i].name, { name: stmts[i].name, params: new Map([...keywords(stmts[i].operands)].filter(([k]) => !k.startsWith('#'))), stmts: body, path });
    stmts.splice(i, (end < 0 ? stmts.length : end + 1) - i);
    i--;
  }
  const jobParams = new Map<string, string>();
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    if (s.op === 'SET') for (const [k, v] of keywords(s.operands)) if (!k.startsWith('#')) jobParams.set(k, unquote(v) ?? '');
    if (s.op !== 'EXEC') continue;
    const kw = keywords(substitute(s.operands, jobParams));
    const pgm = kw.get('PGM');
    // DD statements that follow this EXEC (until the next EXEC).
    const following: Stmt[] = [];
    for (let j = i + 1; j < stmts.length && stmts[j].op !== 'EXEC'; j++) if (stmts[j].op === 'DD') following.push(stmts[j]);
    if (pgm) {
      steps.push(makeStep(jobName, s.name, pgm, kw, following, path, jobParams, `${path}:${s.line}`));
      continue;
    }
    const procName = (kw.get('PROC') ?? kw.get('#0') ?? '').toUpperCase();
    const proc = inline.get(procName) ?? procs.get(procName);
    if (!proc) {
      steps.push({ job: jobName, step: s.name, program: procName || '?', utility: true, evidence: `${path}:${s.line}`, dds: [] });
      continue;
    }
    const params = new Map([...jobParams, ...proc.params]);
    for (const [k, v] of kw) if (!k.startsWith('#') && k !== 'PROC') params.set(k, unquote(v) ?? '');
    for (let p = 0; p < proc.stmts.length; p++) {
      const ps = proc.stmts[p];
      if (ps.op !== 'EXEC') continue;
      const pkw = keywords(substitute(ps.operands, params));
      const ppgm = pkw.get('PGM');
      if (!ppgm) continue;
      const procDds: Stmt[] = [];
      for (let j = p + 1; j < proc.stmts.length && proc.stmts[j].op !== 'EXEC'; j++) if (proc.stmts[j].op === 'DD') procDds.push(proc.stmts[j]);
      // Overrides in the job look like //PROCSTEP.DDNAME DD ...
      const overrides = following.filter((d) => d.name.toUpperCase().startsWith(`${ps.name.toUpperCase()}.`));
      const merged = procDds.filter((d) => !overrides.some((o) => o.name.split('.')[1] === d.name))
        .map((d) => ({ stmt: d, path: proc.path }))
        .concat(overrides.map((o) => ({ stmt: { ...o, name: o.name.split('.')[1] }, path })));
      const step = makeStep(jobName, `${s.name}.${ps.name}`, ppgm, pkw, [], path, params, `${path}:${s.line}`);
      step.dds = merged.map(({ stmt, path: p2 }) => ddFrom(stmt, stmt.name, p2, params)).filter((d) => d.name);
      steps.push(step);
    }
  }
  return steps;
}

function makeStep(job: string, step: string, pgmRaw: string, kw: Map<string, string>, dds: Stmt[], path: string, params: Map<string, string>, evidence: string): JclStep {
  const pgm = pgmRaw.toUpperCase();
  const parm = unquote(kw.get('PARM'));
  const out: JclStep = {
    job, step, program: pgm, utility: UTILITIES.test(pgm), evidence,
    ...(parm ? { parm } : {}), ...(kw.get('COND') ? { cond: kw.get('COND') } : {}),
    dds: dds.map((d) => ddFrom(d, d.name, path, params)).filter((d) => d.name),
  };
  // TSO batch: SYSTSIN "RUN PROGRAM(X)" means the step really runs X (usually a DB2 program).
  if (/^IKJEFT/.test(pgm)) {
    const systsin = out.dds.find((d) => d.name === 'SYSTSIN')?.instream?.join(' ') ?? '';
    const run = /\bRUN\s+PROGRAM\s*\(\s*([A-Z0-9#@$]+)\s*\)/i.exec(systsin);
    if (run) { out.program = run[1].toUpperCase(); out.utility = false; out.parm = `via ${pgm}`; }
  }
  // IMS batch: PARM='DLI,PROGRAM,PSB,...'
  if (pgm === 'DFSRRC00' && parm) {
    const parts = parm.split(',');
    if (parts[1]) { out.program = parts[1].toUpperCase(); out.utility = false; out.parm = `via DFSRRC00 ${parts[0]} PSB=${(parts[2] ?? '').toUpperCase()}`; }
  }
  return out;
}
