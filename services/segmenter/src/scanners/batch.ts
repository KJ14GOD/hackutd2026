// batch: what the job scripts say. Job -> program steps (with run parameters and conditions),
// utility steps and the datasets they read and write, generation datasets, control cards, file transfers.
import type { Edge, JclDd, JclStep, Touch } from '../types';

const SORTS = /^(SORT|ICEMAN|SYNCSORT)$/;

function dataNode(dd: JclDd): string {
  return `data:${dd.dsn}`;
}

function ddVia(step: JclStep, dd: JclDd): string {
  return [`${step.step} ${step.program} DD ${dd.name}`, dd.generation ? `generation ${dd.generation}` : ''].filter(Boolean).join(', ');
}

/** IDCAMS control statements: REPRO, DEFINE, DELETE, PRINT. */
function idcamsEdges(step: JclStep, cards: string, cardsAt: string): Edge[] {
  const out: Edge[] = [];
  const job = `job:${step.job}`;
  const byDd = (name: string) => step.dds.find((d) => d.name === name);
  const text = cards.toUpperCase().replace(/-\s*\n\s*/g, ' ');
  const add = (dsn: string | undefined, rel: string, via: string) => {
    if (dsn) out.push({ from: job, to: `data:${dsn.replace(/\(([+-]?\d+)\)$/, '')}`, rel, evidence: cardsAt, via: `${step.step} IDCAMS ${via}`, confidence: 'extracted', system: 'batch' });
  };
  for (const m of text.matchAll(/\b(INFILE|OUTFILE)\s*\(\s*([A-Z0-9#@$]+)\s*\)/g)) add(byDd(m[2])?.dsn, m[1] === 'INFILE' ? 'read' : 'write', `${m[1]}(${m[2]})`);
  for (const m of text.matchAll(/\b(INDATASET|IDS|OUTDATASET|ODS)\s*\(\s*([A-Z0-9#@$.()+-]+?)\s*\)/g)) add(m[2], /^(INDATASET|IDS)$/.test(m[1]) ? 'read' : 'write', m[1]);
  for (const m of text.matchAll(/\bDEFINE\s+(CLUSTER|GDG|GENERATIONDATAGROUP|ALTERNATEINDEX|AIX|PATH)\b[\s\S]*?\bNAME\s*\(\s*([A-Z0-9#@$.]+)\s*\)/g)) add(m[2], 'defines', `DEFINE ${m[1]}`);
  for (const m of text.matchAll(/\bDELETE\s+([A-Z0-9#@$.]+(?:\.[A-Z0-9#@$]+)+)/g)) add(m[1], 'deletes', 'DELETE');
  return out;
}

export function scanJobs(steps: JclStep[], controlMembers: Map<string, { text: string; path: string }>): { edges: Edge[]; touches: Touch[] } {
  const edges: Edge[] = [];
  const touches: Touch[] = [];
  for (const step of steps) {
    const job = `job:${step.job}`;
    const instream = step.dds.filter((d) => d.instream && d.name !== 'SYSTSIN').map((d) => d.name);
    const via = [step.parm ? `PARM ${step.parm}` : '', step.cond ? `COND ${step.cond}` : '', instream.length ? `in-stream ${instream.join(', ')}` : '', step.utility ? 'utility' : '']
      .filter(Boolean).join('; ');
    edges.push({ from: job, to: `prog:${step.program}`, rel: 'runs', evidence: step.evidence, confidence: 'extracted', system: 'batch', ...(via ? { via } : {}) });
    if (!step.utility) {
      touches.push({ program: step.program, system: 'batch', evidence: step.evidence });
      continue;
    }
    if (step.program === 'FTP') {
      edges.push({ from: job, to: 'external:FTP', rel: 'transfers-file', evidence: step.evidence, confidence: 'extracted', system: 'batch' });
      continue;
    }
    if (step.program === 'IDCAMS') {
      const sysin = step.dds.find((d) => d.name === 'SYSIN');
      const member = sysin?.dsn ? /\(([A-Z0-9#@$]+)\)$/.exec(sysin.dsn)?.[1] : undefined;
      const ctl = member ? controlMembers.get(member) : undefined;
      if (sysin?.instream) edges.push(...idcamsEdges(step, sysin.instream.join('\n'), sysin.evidence));
      else if (ctl) edges.push(...idcamsEdges(step, ctl.text, `${ctl.path}:1`));
      continue;
    }
    for (const dd of step.dds) {
      if (!dd.dsn || dd.sysout || dd.instream) continue;
      let rel: string;
      if (SORTS.test(step.program)) rel = /^SORTOU|^SORTOF/.test(dd.name) ? 'write' : /^SORTIN|^SORTJNF/.test(dd.name) ? 'read' : '';
      else if (step.program === 'IEBGENER') rel = dd.name === 'SYSUT1' ? 'read' : dd.name === 'SYSUT2' ? 'write' : '';
      else rel = /^(NEW|MOD)$/.test(dd.disp ?? '') ? 'write' : 'read';
      if (!rel || dd.name === 'STEPLIB' || dd.name === 'JOBLIB') continue;
      edges.push({ from: job, to: dataNode(dd), rel, evidence: dd.evidence, confidence: 'extracted', system: 'batch', via: ddVia(step, dd) });
    }
  }
  return { edges, touches };
}
