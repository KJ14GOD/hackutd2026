// layouts: COPY members (quoted or not, with library and REPLACING) and EXEC SQL INCLUDE members.
import type { Scanner } from './util';
import { Collector, codeMatches, execBlocks, matches } from './util';

const SQL_SYSTEM = new Set(['SQLCA', 'SQLDA']);

export const layouts: Scanner = (prog, lookups) => {
  const c = new Collector(prog, 'layouts');
  for (const m of codeMatches(prog, /\bCOPY\s+(['"]?)([A-Z0-9#@$-]+)\1(?:\s+(?:OF|IN)\s+([A-Z0-9#@$-]+))?(\s+REPLACING\b)?/)) {
    const name = m[2];
    const via = [m[3] ? `library ${m[3]}` : '', m[4] ? 'with REPLACING' : '', lookups.copybooks.has(name) ? '' : 'no source (system or vendor copybook)']
      .filter(Boolean).join(', ');
    c.edge(`cpy:${name}`, 'copies', m.index, 'extracted', via || undefined);
  }
  for (const block of execBlocks(prog, 'SQL')) {
    const m = /^\s*INCLUDE\s+([A-Z0-9#@$-]+)/.exec(block.body);
    if (m && !SQL_SYSTEM.has(m[1])) c.edge(`cpy:${m[1]}`, 'copies', block.offset, 'extracted', 'SQL INCLUDE');
  }
  return c.result;
};
