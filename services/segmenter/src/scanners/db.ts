// db: embedded SQL. Tables read (FROM/JOIN) and written (INSERT/UPDATE/DELETE/MERGE),
// stored procedure calls, and dynamic SQL, which is flagged because its text is a value.
import type { Scanner } from './util';
import { Collector, execBlocks } from './util';

const NAME = '([A-Z][A-Z0-9_#@$]*(?:\\.[A-Z][A-Z0-9_#@$]*)?)';

export const db: Scanner = (prog) => {
  const c = new Collector(prog, 'db');
  for (const block of execBlocks(prog, 'SQL')) {
    const body = block.body;
    if (/^\s*(INCLUDE|DECLARE\s+\S+\s+TABLE|WHENEVER|BEGIN|END)\b/.test(body)) continue;
    const writes = new Set<string>();
    for (const re of [new RegExp(`\\bINSERT\\s+INTO\\s+${NAME}`, 'g'), new RegExp(`\\bUPDATE\\s+${NAME}\\s+SET\\b`, 'g'),
      new RegExp(`\\bDELETE\\s+FROM\\s+${NAME}`, 'g'), new RegExp(`\\bMERGE\\s+INTO\\s+${NAME}`, 'g')]) {
      for (const m of body.matchAll(re)) writes.add(m[1]);
    }
    const reads = new Set<string>();
    for (const m of body.matchAll(new RegExp(`\\b(FROM|JOIN)\\s+${NAME}`, 'g'))) {
      const before = body.slice(Math.max(0, m.index! - 8), m.index);
      if (m[1] === 'FROM' && /DELETE\s*$/.test(before)) continue;
      reads.add(m[2]);
    }
    for (const t of [...writes].sort()) c.edge(`data:db2:${t}`, 'write', block.offset);
    for (const t of [...reads].sort()) c.edge(`data:db2:${t}`, 'read', block.offset);
    const proc = new RegExp(`^\\s*CALL\\s+${NAME}`).exec(body);
    if (proc) c.edge(`data:db2proc:${proc[1]}`, 'calls', block.offset);
    if (/\b(PREPARE|EXECUTE\s+IMMEDIATE)\b/.test(body)) {
      c.touch(block.offset);
      c.unresolved('dynamic SQL (statement text is a value)', /\b(PREPARE\s+\S+|EXECUTE\s+IMMEDIATE)/.exec(body)?.[0] ?? 'dynamic', block.offset);
    }
  }
  return c.result;
};
