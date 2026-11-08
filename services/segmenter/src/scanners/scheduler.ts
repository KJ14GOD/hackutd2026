// scheduler: job -> job triggers from the scheduler export, and online transactions a program
// starts on a timer (EXEC CICS START ... INTERVAL/TIME/AFTER/AT).
import type { Edge } from '../types';
import type { Scanner } from './util';
import { Collector, execBlocks, option, resolveOperand } from './util';

export const timedStarts: Scanner = (prog, lookups) => {
  const c = new Collector(prog, 'scheduler');
  for (const block of execBlocks(prog, 'CICS')) {
    if (!/^\s*START\b/.test(block.body) || !/\b(INTERVAL|TIME|AFTER|AT)\b/.test(block.body)) continue;
    const tran = option(block.body, 'TRANSID');
    if (!tran) continue;
    const r = resolveOperand(prog, lookups, tran);
    const when = /\b(INTERVAL|TIME|AFTER|AT)\b[^A-Z]*([^)]*\))?/.exec(block.body)?.[0].trim();
    if (r.exact) c.edge(`tran:${r.exact}`, 'starts-async', block.offset, r.isLiteral ? 'extracted' : 'inferred', `timed: ${when}`);
    else c.unresolved('CICS START TRANSID (timed)', tran, block.offset, r.values);
  }
  return c.result;
};

export function triggerEdges(triggers: { from: string; to: string; evidence: string }[]): Edge[] {
  return triggers.map((t) => ({ from: `job:${t.from}`, to: `job:${t.to}`, rel: 'triggers', evidence: t.evidence, confidence: 'extracted', system: 'scheduler' }));
}
