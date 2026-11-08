// files: batch SELECT/OPEN (via the job steps that run the program), SORT/MERGE files,
// and online CICS file commands (via the online config's file names).
import type { Lookups, NormalizedProgram } from '../types';
import type { Scanner } from './util';
import { Collector, codeMatches, execBlocks, matches, option, resolveOperand } from './util';

const OPEN_STOP = /\b(IF|MOVE|PERFORM|DISPLAY|READ|WRITE|REWRITE|END-IF|ELSE|EVALUATE|CALL|EXEC|SET|ADD|COMPUTE|CLOSE|GO|INITIALIZE|CONTINUE)\b/;
const READ_VERBS = new Set(['READ', 'STARTBR', 'READNEXT', 'READPREV']);
const WRITE_VERBS = new Set(['WRITE', 'REWRITE', 'DELETE']);

interface FileUse { mode: 'read' | 'write'; offset: number; how: string }

function batchUses(prog: NormalizedProgram): { selects: Map<string, { dd: string; offset: number }>; uses: Map<string, FileUse[]>; sortWork: Set<string> } {
  const selects = new Map<string, { dd: string; offset: number }>();
  for (const m of codeMatches(prog, /\bSELECT\s+(?:OPTIONAL\s+)?([A-Z0-9-]+)\s+ASSIGN\s+(?:TO\s+)?(['"]?)([A-Z0-9#@$-]+)\2/)) {
    selects.set(m[1], { dd: m[3].split('-').pop() ?? m[3], offset: m.index });
  }
  const sortWork = new Set([...matches(/\bSD\s+([A-Z0-9-]+)/, prog.joined)].map((m) => m[1]));
  const uses = new Map<string, FileUse[]>();
  const add = (file: string, use: FileUse) => {
    if (!selects.has(file)) return;
    if (!uses.has(file)) uses.set(file, []);
    if (!uses.get(file)!.some((u) => u.mode === use.mode)) uses.get(file)!.push(use);
  };
  for (const m of codeMatches(prog, /\bOPEN\s+([\s\S]*?)(?=\.\s|$)/)) {
    const stop = OPEN_STOP.exec(m[1]);
    const clause = stop ? m[1].slice(0, stop.index) : m[1];
    let mode: 'read' | 'write' | undefined;
    let how = '';
    for (const tok of clause.split(/\s+/)) {
      if (tok === 'INPUT') { mode = 'read'; how = 'OPEN INPUT'; }
      else if (tok === 'OUTPUT' || tok === 'EXTEND' || tok === 'I-O') { mode = 'write'; how = `OPEN ${tok}`; }
      else if (mode && /^[A-Z0-9-]+$/.test(tok) && !['WITH', 'NO', 'REWIND', 'REVERSED', 'LOCK'].includes(tok)) add(tok, { mode, offset: m.index, how });
    }
  }
  for (const m of codeMatches(prog, /\b(?:SORT|MERGE)\s+[A-Z0-9-]+([\s\S]*?)(?=\.\s|$)/)) {
    const using = /\bUSING\s+((?:[A-Z0-9-]+\s*)+?)(?=\bGIVING\b|\bOUTPUT\b|$)/.exec(m[1]);
    const giving = /\bGIVING\s+((?:[A-Z0-9-]+\s*)+)/.exec(m[1]);
    using?.[1].trim().split(/\s+/).forEach((f) => add(f, { mode: 'read', offset: m.index, how: 'SORT USING' }));
    giving?.[1].trim().split(/\s+/).forEach((f) => add(f, { mode: 'write', offset: m.index, how: 'SORT GIVING' }));
  }
  // Files never opened by name (opened through a paragraph we couldn't follow) still count by their verbs.
  // WRITE and REWRITE name the record, so map each FD's 01 record back to its file.
  const recordOf = new Map<string, string>();
  for (const m of codeMatches(prog, /\bFD\s+([A-Z0-9-]+)[\s\S]*?\b01\s+([A-Z0-9-]+)/)) recordOf.set(m[1], m[2]);
  for (const [file] of selects) {
    if (uses.has(file) || sortWork.has(file)) continue;
    const rec = recordOf.get(file);
    const write = (rec && new RegExp(`\\b(?:WRITE|REWRITE)\\s+${rec}\\b`).exec(prog.joined))
      || new RegExp(`\\bDELETE\\s+${file}\\b`).exec(prog.joined);
    const read = new RegExp(`\\bREAD\\s+${file}\\b`).exec(prog.joined);
    if (write) add(file, { mode: 'write', offset: write.index, how: 'WRITE' });
    if (read) add(file, { mode: 'read', offset: read.index, how: 'READ' });
  }
  return { selects, uses, sortWork };
}

function datasetNode(dsn: string): string {
  return `data:${dsn.replace(/\(([+-]?\d+)\)$/, '')}`;
}

export const files: Scanner = (prog, lookups: Lookups) => {
  const c = new Collector(prog, 'files');

  const { selects, uses } = batchUses(prog);
  for (const [file, fileUses] of [...uses].sort(([a], [b]) => a.localeCompare(b))) {
    const { dd } = selects.get(file)!;
    const bound = lookups.stepFiles.get(`${prog.name}|${dd}`) ?? [];
    for (const use of fileUses) {
      if (bound.length) {
        for (const dsn of [...new Set(bound.map((b) => b.dsn))].sort()) {
          const step = bound.find((b) => b.dsn === dsn)!;
          c.edge(datasetNode(dsn), use.mode, use.offset, 'extracted', `${use.how} ${file} -> DD ${dd} (${step.evidence})`);
        }
        continue;
      }
      const elsewhere = [...(lookups.ddAnywhere.get(dd) ?? [])].sort();
      if (elsewhere.length === 1) {
        c.edge(datasetNode(elsewhere[0]), use.mode, use.offset, 'inferred', `${use.how} ${file} -> DD ${dd}; no job runs ${prog.name}, but DD ${dd} means one dataset everywhere`);
      } else {
        c.edge(`data:dd:${dd}`, use.mode, use.offset, 'unknown', `${use.how} ${file} -> DD ${dd}`);
        c.unresolved('batch DD with no JCL step', dd, use.offset, elsewhere);
      }
    }
  }

  for (const block of execBlocks(prog, 'CICS')) {
    const verb = /^\s*([A-Z]+)/.exec(block.body)?.[1] ?? '';
    if (!READ_VERBS.has(verb) && !WRITE_VERBS.has(verb)) continue;
    const operand = option(block.body, 'FILE') ?? option(block.body, 'DATASET');
    if (!operand) continue; // DELETE without FILE is a queue or container command
    const mode = WRITE_VERBS.has(verb) ? 'write' : 'read';
    const remote = option(block.body, 'SYSID');
    const r = resolveOperand(prog, lookups, operand);
    if (!r.exact) {
      c.unresolved('CICS file name', operand, block.offset, r.values);
      continue;
    }
    const dsn = lookups.fileAlias.get(r.exact);
    const via = [`CICS ${verb} ${r.exact}`, r.isLiteral ? '' : `${operand} = '${r.exact}'`, remote ? `remote SYSID ${remote}` : ''].filter(Boolean).join('; ');
    if (dsn) {
      c.edge(datasetNode(dsn), mode, block.offset, r.isLiteral ? 'extracted' : 'inferred', via);
    } else {
      c.edge(`data:cics:${r.exact}`, mode, block.offset, 'unknown', via);
      c.unresolved('CICS file not in the online config', r.exact, block.offset);
    }
  }
  return c.result;
};
