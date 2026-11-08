// network: CICS WEB commands, web service invokes, and socket calls.
import type { Scanner } from './util';
import { Collector, SOCKET_API, callSites, execBlocks, option, resolveOperand } from './util';

export const network: Scanner = (prog, lookups) => {
  const c = new Collector(prog, 'network');
  for (const block of execBlocks(prog, 'CICS')) {
    const web = /^\s*WEB\s+(OPEN|SEND|RECEIVE|CONVERSE|CLOSE)\b/.exec(block.body);
    if (web) {
      const hostOp = option(block.body, 'HOST') ?? option(block.body, 'URIMAP');
      const host = hostOp ? resolveOperand(prog, lookups, hostOp).exact : undefined;
      if (web[1] === 'CLOSE') { c.touch(block.offset); continue; }
      c.edge(`http:${host ?? '?'}`, 'calls-external', block.offset, host ? 'extracted' : 'unknown', `WEB ${web[1]}`);
      if (!host && web[1] === 'OPEN') c.unresolved('HTTP host (set at runtime)', hostOp ?? 'WEB OPEN', block.offset);
      continue;
    }
    const inv = /^\s*INVOKE\s+(?:WEBSERVICE|SERVICE)\s*\(\s*([^)]+?)\s*\)/.exec(block.body);
    if (inv) {
      const r = resolveOperand(prog, lookups, inv[1]);
      c.edge(`ws:${r.exact ?? '?'}`, 'calls-external', block.offset, r.exact ? 'extracted' : 'unknown', 'INVOKE SERVICE');
      if (!r.exact) c.unresolved('web service name', inv[1], block.offset, r.values);
    }
  }
  for (const s of callSites(prog, lookups)) {
    if (s.target && SOCKET_API.test(s.target)) c.edge('socket:?', 'calls-external', s.offset, 'unknown', s.target);
  }
  return c.result;
};
