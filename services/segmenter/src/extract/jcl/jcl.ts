// Minimal JCL reader: jobs, steps (EXEC PGM= / EXEC proc), DD -> dataset names, and
// IDCAMS DEFINE statements that make a PATH/AIX an alias of a base cluster. Pure.
// Handles symbolic parameters (SET, PROC defaults, EXEC overrides), procstep DD overrides
// (//STEP.DD DD ...), IMS batch (DFSRRC00 PARM) and DB2 batch (IKJEFT01 RUN PROGRAM).

export interface JclStep {
  name: string;
  program: string; // '' when the step runs a proc we could not find
  psb: string; // IMS PSB of a DFSRRC00 step, else ''
  dds: Map<string, string[]>; // DD name -> dataset names (generation suffix stripped)
  ddWrites: Set<string>; // DD names opened NEW/MOD (by DISP)
}

export interface JclJob {
  name: string;
  path: string;
  steps: JclStep[];
}

export interface JclFacts {
  jobs: JclJob[];
  /** alias dataset -> the dataset it points at (PATH -> AIX -> base cluster) */
  aliases: Map<string, string>;
}

interface Stmt {
  label: string;
  op: string;
  operands: string;
  inline: string[]; // in-stream data following `DD *` / `DD DATA`
}

/** Groups `//` records into statements, joining continuations and collecting in-stream data. */
export function statements(src: string): Stmt[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n').map((l) => l.slice(0, 72).trimEnd());
  const out: Stmt[] = [];
  let cur: Stmt | null = null;
  let inStream: Stmt | null = null;
  for (const line of lines) {
    if (inStream) {
      if (line.startsWith('/*') || line.startsWith('//')) inStream = null;
      else {
        inStream.inline.push(line);
        continue;
      }
    }
    if (!line.startsWith('//') || line.startsWith('//*')) continue;
    const body = line.slice(2);
    if (cur && /^\s/.test(body) && /,$/.test(cur.operands)) {
      cur.operands += body.trim().split(/\s+/)[0];
      continue;
    }
    const m = body.match(/^(\S*)\s+(\S+)\s*(\S*)/);
    if (!m) continue;
    cur = { label: m[1], op: m[2], operands: m[3], inline: [] };
    out.push(cur);
    if (cur.op === 'DD' && /^(\*|DATA)(,|$)/.test(cur.operands)) inStream = cur;
  }
  return out;
}

const DSN_RE = /\bDSN(?:AME)?=([A-Z0-9$#@.&]+(?:\([^)]*\))?)/;

/** Load libraries, catalogs and IMS control files: plumbing, not application data. */
const SYSTEM_DDS = new Set([
  'STEPLIB', 'JOBLIB', 'SYSPROC', 'SYSEXEC', 'SYSLIB', 'DFSRESLB', 'IMS', 'RECON1', 'RECON2', 'RECON3',
  'DFSVSAMP', 'IEFRDER', 'IMSLOGR', 'SYSUDUMP', 'SYSABEND', 'CEEDUMP',
]);
/** EXEC keywords that are not symbolic parameters. */
const EXEC_PARAMS = new Set(['PGM', 'PARM', 'COND', 'REGION', 'TIME', 'DYNAMNBR', 'ACCT', 'ADDRSPC', 'PERFORM', 'RD']);

/** `A=1,B='x y'` -> [[A,1],[B,x y]] (top-level commas only). */
export function keywords(operands: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let quote = false;
  let cur = '';
  for (const c of operands + ',') {
    if (c === "'") quote = !quote;
    if (!quote && c === '(') depth++;
    if (!quote && c === ')') depth--;
    if (c === ',' && depth === 0 && !quote) {
      const m = cur.match(/^([A-Z0-9$#@]+)=(.*)$/);
      if (m) out.push([m[1], m[2].replace(/^'(.*)'$/, '$1')]);
      cur = '';
    } else cur += c;
  }
  return out;
}

/** Replaces &NAME and &NAME. with known symbol values; unknown symbols stay as they are. */
export function substitute(text: string, symbols: Map<string, string>): string {
  return text.replace(/&([A-Z0-9$#@]+)\.?/g, (m, k: string) => symbols.get(k) ?? m);
}

export function cleanDsn(dsn: string): string {
  return dsn.replace(/\([^)]*\)$/, '');
}

/** IDCAMS: DEFINE ALTERNATEINDEX(NAME(x) RELATE(base)) and DEFINE PATH(NAME(p) PATHENTRY(x)). */
export function idcamsAliases(inline: string[], into: Map<string, string>): void {
  const text = inline
    .map((l) => l.replace(/-\s*$/, ' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
  for (const def of text.split(/\bDEFINE\b/).slice(1)) {
    const name = def.match(/\bNAME\s*\(\s*([A-Z0-9$#@.]+)\s*\)/)?.[1];
    if (!name) continue;
    const relate = def.match(/\bRELATE\s*\(\s*([A-Z0-9$#@.]+)\s*\)/)?.[1];
    const entry = def.match(/\bPATHENTRY\s*\(\s*([A-Z0-9$#@.]+)\s*\)/)?.[1];
    if (/^\s*(ALTERNATEINDEX|AIX)\b/.test(def) && relate) into.set(name, relate);
    if (/^\s*PATH\b/.test(def) && entry) into.set(name, entry);
  }
}

export function parseJcl(files: { path: string; text: string }[], procs: Map<string, string>): JclFacts {
  const aliases = new Map<string, string>();
  const jobs: JclJob[] = [];

  const stepsOf = (src: string, depth: number, inherited: Map<string, string>): JclStep[] => {
    const steps: JclStep[] = [];
    const symbols = new Map(inherited);
    let step: JclStep | null = null;
    let procSteps: JclStep[] = []; // steps of the last EXEC proc, for //PROCSTEP.DD overrides
    for (const s of statements(src)) {
      if (s.op === 'SET') {
        for (const [k, v] of keywords(s.operands)) symbols.set(k, v);
      } else if (s.op === 'PROC') {
        for (const [k, v] of keywords(s.operands)) if (!inherited.has(k)) symbols.set(k, v); // defaults
      } else if (s.op === 'EXEC') {
        const pgm = s.operands.match(/\bPGM=([A-Z0-9$#@]+)/)?.[1];
        const proc = pgm ? undefined : (s.operands.match(/^(?:PROC=)?([A-Z0-9$#@]+)/)?.[1] ?? '');
        if (proc && procs.has(proc) && depth < 3) {
          const overrides = new Map(symbols);
          for (const [k, v] of keywords(s.operands)) if (k !== 'PROC' && !EXEC_PARAMS.has(k)) overrides.set(k, v);
          procSteps = stepsOf(procs.get(proc)!, depth + 1, overrides);
          steps.push(...procSteps);
          step = null;
          continue;
        }
        procSteps = [];
        step = { name: s.label, program: pgm ?? '', psb: '', dds: new Map(), ddWrites: new Set() };
        // IMS batch: EXEC PGM=DFSRRC00,PARM='BMP,<program>,<psb>' really runs <program>.
        const ims = pgm === 'DFSRRC00' ? s.operands.match(/\bPARM=\(?'?(?:BMP|DLI|DBB),([A-Z0-9$#@]+),([A-Z0-9$#@]*)/) : null;
        if (ims) Object.assign(step, { program: ims[1], psb: ims[2] });
        steps.push(step);
      } else if (s.op === 'DD') {
        // `//PRC001.FILEIN DD` overrides DD FILEIN of step PRC001 in the proc just executed.
        const [stepName, ddName] = s.label.includes('.') ? s.label.split('.', 2) : ['', s.label];
        const target = stepName ? procSteps.find((p) => p.name === stepName) : step;
        if (!target) continue;
        if (target.program === 'IDCAMS') idcamsAliases(s.inline, aliases);
        // DB2 batch: IKJEFT01 with SYSTSIN `RUN PROGRAM(X)` really runs X.
        const run = /^IKJEFT/.test(target.program) ? s.inline.join(' ').match(/\bRUN\s+PROG(?:RAM)?\s*\(\s*([A-Z0-9$#@]+)\s*\)/) : null;
        if (run) target.program = run[1];
        const raw = s.operands.match(DSN_RE)?.[1];
        if (!ddName || !raw || raw.startsWith('&&') || SYSTEM_DDS.has(ddName)) continue;
        const dsn = cleanDsn(substitute(raw, symbols));
        if (dsn === 'NULLFILE') {
          if (stepName) target.dds.delete(ddName);
          continue;
        }
        if (stepName) target.dds.set(ddName, [dsn]);
        else target.dds.set(ddName, [...(target.dds.get(ddName) ?? []), dsn]);
        if (/\bDISP=\(?(NEW|MOD)\b/.test(s.operands)) target.ddWrites.add(ddName);
        else if (stepName) target.ddWrites.delete(ddName);
      }
    }
    return steps;
  };

  for (const f of files) {
    const job = statements(f.text).find((s) => s.op === 'JOB');
    if (!job) continue;
    jobs.push({ name: job.label, path: f.path, steps: stepsOf(f.text, 0, new Map()) });
  }
  jobs.sort((a, b) => a.name.localeCompare(b.name));
  return { jobs, aliases };
}

/** Follows PATH -> AIX -> base cluster. */
export function canonicalDataset(dsn: string, aliases: Map<string, string>): string {
  let cur = cleanDsn(dsn);
  for (let i = 0; i < 5 && aliases.has(cur); i++) cur = aliases.get(cur)!;
  return cur;
}
