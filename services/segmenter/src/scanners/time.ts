// time: every way a program reads the clock or calendar. One edge per mechanism.
import type { Scanner } from './util';
import { Collector, codeMatches, DATE_API, callSites, execBlocks, matches } from './util';

export const time: Scanner = (prog, lookups) => {
  const c = new Collector(prog, 'time');
  const seen = new Set<string>();
  const once = (via: string, offset: number, confidence: 'extracted' | 'inferred' = 'extracted') => {
    if (seen.has(via)) return;
    seen.add(via);
    c.edge('time:clock', 'reads-time', offset, confidence, via);
  };
  for (const m of codeMatches(prog, /\bACCEPT\s+[A-Z0-9-]+(?:\([^)]*\))?\s+FROM\s+(DATE|TIME|DAY-OF-WEEK|DAY)\b/)) once(`ACCEPT FROM ${m[1]}`, m.index);
  for (const m of codeMatches(prog, /\bFUNCTION\s+(CURRENT-DATE|WHEN-COMPILED)\b/)) once(`FUNCTION ${m[1]}`, m.index);
  for (const b of execBlocks(prog, 'CICS')) {
    const m = /^\s*(ASKTIME|FORMATTIME)\b/.exec(b.body);
    if (m) once(`CICS ${m[1]}`, b.offset);
  }
  for (const m of codeMatches(prog, /\bEIB(DATE|TIME)\b/)) once(`EIB${m[1]} (filled in by CICS)`, m.index);
  for (const s of callSites(prog, lookups)) {
    if (s.target && DATE_API.test(s.target)) once(`CALL ${s.target}`, s.offset, s.dynamic ? 'inferred' : 'extracted');
  }
  return c.result;
};
