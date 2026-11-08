// external: call targets that aren't COBOL in this repo. Assembler/C/vendor code becomes
// external:NAME; runtime library calls (CEE*, DSNTIAR...) become sys:NAME.
import type { Scanner } from './util';
import { Collector, DATE_API, IMS_API, MQ_API, SOCKET_API, SYSTEM_API, callSites } from './util';

export const external: Scanner = (prog, lookups) => {
  const c = new Collector(prog, 'external');
  for (const s of callSites(prog, lookups)) {
    const t = s.target;
    if (!t || lookups.programs.has(t) || MQ_API.test(t) || IMS_API.test(t) || DATE_API.test(t) || SOCKET_API.test(t)) continue;
    const confidence = s.dynamic ? 'inferred' : 'extracted';
    if (SYSTEM_API.test(t)) {
      c.edge(`sys:${t}`, 'uses-api', s.offset, confidence);
      continue;
    }
    const source = lookups.externalSources.get(t);
    c.edge(`external:${t}`, 'calls', s.offset, confidence, source ? `source ${source}` : 'no source in the repo');
    if (!source) c.unresolved('call target with no source', t, s.offset);
  }
  return c.result;
};
