// ims: DL/I calls (CBLTDLI/AIBTDLI) and EXEC DLI. The databases come from the PSB, found by
// the program's literals, its own name, or the IMS step that runs it.
import type { Scanner } from './util';
import { Collector, IMS_API, allLiterals, callSites, execBlocks, literalValues } from './util';

const READ_FUNCS = /^(GU|GN|GNP|GHU|GHN|GHNP)$/;
const WRITE_FUNCS = /^(ISRT|REPL|DLET)$/;

export const ims: Scanner = (prog, lookups) => {
  const c = new Collector(prog, 'ims');
  const sites = callSites(prog, lookups).filter((s) => s.target && IMS_API.test(s.target)).map((s) => s.offset);
  for (const b of execBlocks(prog, 'DLI')) sites.push(b.offset);
  if (sites.length === 0) return c.result;
  const first = Math.min(...sites);

  // Which function codes does the program use? They live in VALUE clauses like 'GU  '.
  const funcs = new Set<string>();
  for (const vals of literalValues(prog, lookups).values()) for (const v of vals) funcs.add(v.trim());
  for (const b of execBlocks(prog, 'DLI')) funcs.add(/^\s*([A-Z]+)/.exec(b.body)?.[1] ?? '');
  const rels = [...funcs].some((f) => WRITE_FUNCS.test(f)) ? ['read', 'write'] : ['read'];
  if (![...funcs].some((f) => READ_FUNCS.test(f) || WRITE_FUNCS.test(f))) rels.splice(0, rels.length, 'read');

  const literals = allLiterals(prog, lookups);
  const psbs = [...lookups.psbDatabases.keys()].filter((p) => literals.has(p) || p === prog.name);
  const stepPsb = lookups.steps.find((s) => s.program === prog.name && /PSB=/.test(s.parm ?? ''));
  if (stepPsb) psbs.push(/PSB=([A-Z0-9#@$]+)/.exec(stepPsb.parm!)![1]);
  const dbs = [...new Set(psbs.flatMap((p) => lookups.psbDatabases.get(p) ?? []))].sort();
  if (dbs.length) {
    for (const d of dbs) for (const rel of rels) c.edge(`ims:${d}`, rel, first, 'inferred', `PSB ${[...new Set(psbs)].sort().join(', ')}`);
  } else {
    for (const rel of rels) c.edge('ims:?', rel, first, 'unknown');
    c.unresolved('IMS database access (segments via PSB)', 'CBLTDLI', first);
  }
  return c.result;
};
