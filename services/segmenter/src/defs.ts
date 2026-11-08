// Definitions that live outside programs: online config (CSD), scheduler exports, IMS PSBs, BMS maps.

export interface CsdInfo {
  files: Map<string, { dsn: string; evidence: string }>;
  transactions: Map<string, { program: string; evidence: string }>;
  tdQueues: Map<string, { trigger?: string; dsn?: string; evidence: string }>;
}

/** Reads DEFINE FILE/TRANSACTION/TDQUEUE blocks. Each block runs until the next DEFINE. */
export function parseCsd(text: string, path: string, into: CsdInfo) {
  const lines = text.split(/\r?\n/);
  let block: { kind: string; name: string; line: number; body: string } | undefined;
  const flush = () => {
    if (!block) return;
    const attr = (k: string) => new RegExp(`\\b${k}\\(\\s*([^)]+?)\\s*\\)`).exec(block!.body)?.[1];
    const evidence = `${path}:${block.line}`;
    if (block.kind === 'FILE') {
      const dsn = attr('DSNAME');
      if (dsn) into.files.set(block.name, { dsn, evidence });
    } else if (block.kind === 'TRANSACTION') {
      const program = attr('PROGRAM');
      if (program) into.transactions.set(block.name, { program, evidence });
    } else if (block.kind === 'TDQUEUE') {
      into.tdQueues.set(block.name, { trigger: attr('TRANSID'), dsn: attr('DSNAME') ?? attr('DDNAME'), evidence });
    }
  };
  lines.forEach((raw, i) => {
    const m = /^\s*DEFINE\s+([A-Z]+)\(\s*([^)]+?)\s*\)/.exec(raw.toUpperCase());
    if (m) {
      flush();
      block = { kind: m[1], name: m[2], line: i + 1, body: raw.toUpperCase() };
    } else if (block) {
      block.body += ' ' + raw.toUpperCase();
    }
  });
  flush();
}

/** Control-M: job A triggers job B when A sets an OUTCOND (+) that B waits on as an INCOND. */
export function parseControlM(text: string, path: string): { from: string; to: string; evidence: string }[] {
  const lines = text.split(/\r?\n/);
  const sets = new Map<string, { job: string; line: number }[]>();
  const waits: { job: string; cond: string; line: number }[] = [];
  let job = '';
  lines.forEach((l, i) => {
    const j = /<JOB\b[^>]*\bJOBNAME="([^"]+)"/.exec(l);
    if (j) job = j[1].toUpperCase();
    const out = /<OUTCOND\b[^>]*\bNAME="([^"]+)"[^>]*\bSIGN="\+"/.exec(l);
    if (out && job) {
      if (!sets.has(out[1])) sets.set(out[1], []);
      sets.get(out[1])!.push({ job, line: i + 1 });
    }
    const inc = /<INCOND\b[^>]*\bNAME="([^"]+)"/.exec(l);
    if (inc && job) waits.push({ job, cond: inc[1], line: i + 1 });
  });
  const out: { from: string; to: string; evidence: string }[] = [];
  for (const w of waits) for (const s of sets.get(w.cond) ?? []) {
    if (s.job !== w.job) out.push({ from: s.job, to: w.job, evidence: `${path}:${w.line}` });
  }
  return out;
}

/** CA-7 listings: a job's "TRIGGERED JOBS" / successor lines name the jobs it triggers. */
export function parseCa7(text: string, path: string): { from: string; to: string; evidence: string }[] {
  const out: { from: string; to: string; evidence: string }[] = [];
  let job = '';
  text.split(/\r?\n/).forEach((l, i) => {
    const head = /\bJOB=([A-Z0-9#@$]+)\s+LIST=/.exec(l);
    if (head) job = head[1];
    const trig = /\bTRIGGERS?\s*(?:JOB)?[:=]?\s+([A-Z0-9#@$]{2,8})\b/.exec(l);
    if (job && trig && trig[1] !== job && !/^(OTHER|JOBS)$/.test(trig[1])) out.push({ from: job, to: trig[1], evidence: `${path}:${i + 1}` });
  });
  return out;
}

/** PSB name -> DBD names from `PCB TYPE=DB|GSAM,DBDNAME=...` lines. */
export function parsePsb(text: string): { psb?: string; dbds: string[] } {
  const dbds = [...text.matchAll(/\bPCB\s+TYPE=(?:DB|GSAM)\s*,\s*DBDNAME=([A-Z0-9#@$]+)/gi)].map((m) => m[1].toUpperCase());
  const psb = /\bPSBNAME=([A-Z0-9#@$]+)/i.exec(text)?.[1]?.toUpperCase();
  return { psb, dbds: [...new Set(dbds)] };
}

/** BMS: map name -> number of named fields. */
export function parseBms(text: string): Map<string, number> {
  const out = new Map<string, number>();
  let map = '';
  for (const l of text.split(/\r?\n/)) {
    const mdi = /^([A-Z0-9#@$]+)\s+DFHMDI\b/i.exec(l);
    if (mdi) { map = mdi[1].toUpperCase(); out.set(map, 0); continue; }
    if (map && /^[A-Z0-9#@$]+\s+DFHMDF\b/i.test(l)) out.set(map, (out.get(map) ?? 0) + 1);
  }
  return out;
}
