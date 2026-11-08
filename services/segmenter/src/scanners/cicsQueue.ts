// cics-queue: temporary-storage (TS) and transient-data (TD) queue commands.
import type { Scanner } from './util';
import { Collector, execBlocks, option, resolveOperand } from './util';

export const cicsQueue: Scanner = (prog, lookups) => {
  const c = new Collector(prog, 'cics-queue');
  for (const block of execBlocks(prog, 'CICS')) {
    const m = /^\s*(WRITEQ|READQ|DELETEQ)(?:\s+(TS|TD))?\b/.exec(block.body);
    if (!m) continue;
    const kind = m[2] === 'TD' ? 'tdq' : 'tsq';
    const operand = option(block.body, 'QUEUE') ?? option(block.body, 'QNAME');
    if (!operand) continue;
    const rel = m[1] === 'READQ' ? 'read' : 'write';
    const r = resolveOperand(prog, lookups, operand);
    if (r.exact) c.edge(`${kind}:${r.exact}`, rel, block.offset, r.isLiteral ? 'extracted' : 'inferred', r.isLiteral ? undefined : `${operand} = '${r.exact}'`);
    else {
      c.edge(`${kind}:?`, rel, block.offset, 'unknown', operand);
      c.unresolved(`CICS ${m[1]} ${kind === 'tdq' ? 'TD' : 'TS'} queue name`, operand, block.offset, r.values);
    }
  }
  return c.result;
};
