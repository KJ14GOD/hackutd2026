// mq: queue calls. The queue name is a value set at runtime, so the target is always mq:? (Part 2 reads values).
import type { Scanner } from './util';
import { Collector, MQ_API, callSites } from './util';

const REL: Record<string, string> = { MQOPEN: 'opens', MQPUT: 'write', MQPUT1: 'write', MQGET: 'read' };

export const mq: Scanner = (prog, lookups) => {
  const c = new Collector(prog, 'mq');
  let flagged = false;
  for (const s of callSites(prog, lookups)) {
    if (!s.target || !MQ_API.test(s.target)) continue;
    const rel = REL[s.target];
    if (rel) c.edge('mq:?', rel, s.offset, 'unknown', s.target);
    else c.touch(s.offset);
    if (!flagged) {
      c.unresolved('MQ queue (name set at runtime)', s.target, s.offset);
      flagged = true;
    }
  }
  return c.result;
};
