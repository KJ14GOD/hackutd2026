// programs: static and dynamic CALLs, CICS hand-offs (XCTL, LINK, RETURN TRANSID, START TRANSID),
// alternate entry points, nested programs.
import type { Scanner } from './util';
import { Collector, codeMatches, IMS_API, MQ_API, SOCKET_API, SYSTEM_API, allLiterals, callSites, execBlocks, matches, option, resolveOperand } from './util';

const isApi = (name: string) => MQ_API.test(name) || IMS_API.test(name) || SYSTEM_API.test(name) || SOCKET_API.test(name);

export const programs: Scanner = (prog, lookups) => {
  const c = new Collector(prog, 'programs');

  for (const call of callSites(prog, lookups)) {
    if (call.target) {
      if (lookups.programs.has(call.target)) {
        c.edge(`prog:${call.target}`, 'calls', call.offset, call.dynamic ? 'inferred' : 'extracted', call.dynamic ? `${call.operand} = '${call.target}'` : undefined);
      }
      continue; // anything else is an API or external target, owned by other scanners
    }
    const progCandidates = call.values.filter((v) => lookups.programs.has(v));
    if (call.values.length > 0 && call.values.every(isApi)) continue;
    c.unresolved('CALL target', call.operand, call.offset, progCandidates.length ? progCandidates : call.values);
  }

  for (const block of execBlocks(prog, 'CICS')) {
    const verb = /^\s*(XCTL|LINK|RETURN|START)\b/.exec(block.body)?.[1];
    if (!verb) continue;
    if (verb === 'XCTL' || verb === 'LINK') {
      const operand = option(block.body, 'PROGRAM');
      if (!operand) continue;
      const rel = verb === 'XCTL' ? 'transfers' : 'links';
      const r = resolveOperand(prog, lookups, operand);
      if (r.exact) {
        c.edge(`prog:${r.exact}`, rel, block.offset, r.isLiteral ? 'extracted' : 'inferred', r.isLiteral ? undefined : `${operand} = '${r.exact}'`);
        if (!lookups.programs.has(r.exact)) c.unresolved(`CICS ${verb} target has no source`, r.exact, block.offset);
      } else {
        const fromValues = r.values.filter((v) => lookups.programs.has(v));
        const fromLiterals = [...allLiterals(prog, lookups)].filter((v) => lookups.programs.has(v) && v !== prog.name);
        c.unresolved(`CICS ${verb} PROGRAM`, operand, block.offset, fromValues.length ? fromValues : fromLiterals);
      }
      continue;
    }
    const tran = option(block.body, 'TRANSID');
    if (!tran) continue;
    const timed = verb === 'START' && /\b(INTERVAL|TIME|AFTER|AT)\b/.test(block.body);
    if (timed) continue; // time-triggered starts belong to the scheduler scanner
    const r = resolveOperand(prog, lookups, tran);
    const rel = verb === 'RETURN' ? 'next' : 'starts-async';
    if (r.exact) c.edge(`tran:${r.exact}`, rel, block.offset, r.isLiteral ? 'extracted' : 'inferred', r.isLiteral ? undefined : `${tran} = '${r.exact}'`);
    else c.unresolved(`CICS ${verb} TRANSID`, tran, block.offset, r.values);
  }

  for (const m of codeMatches(prog, /\bENTRY\s+(['"])([A-Z0-9#@$-]+)\1/)) {
    c.edge(`prog:${m[2]}`, 'entry', m.index);
  }
  const ids = [...matches(/\bPROGRAM-ID\.?\s+['"]?([A-Z0-9#@$-]+)/, prog.joined)];
  for (const m of ids.slice(1)) c.edge(`prog:${m[1]}`, 'contains', m.index);

  return c.result;
};
