// screen: BMS maps sent and received. Field counts come from the map definitions when they're in the repo.
import type { Scanner } from './util';
import { Collector, execBlocks, option, resolveOperand } from './util';

export const screen: Scanner = (prog, lookups) => {
  const c = new Collector(prog, 'screen');
  for (const block of execBlocks(prog, 'CICS')) {
    const m = /^\s*(SEND|RECEIVE)\s+MAP\b/.exec(block.body);
    if (!m) continue;
    const mapOp = option(block.body, 'MAP');
    if (!mapOp) continue;
    const map = resolveOperand(prog, lookups, mapOp);
    const setOp = option(block.body, 'MAPSET');
    const mapset = setOp ? resolveOperand(prog, lookups, setOp).exact : undefined;
    const rel = m[1] === 'SEND' ? 'shows' : 'receives';
    if (!map.exact) {
      c.edge('screen:?', rel, block.offset, 'unknown', mapOp);
      c.unresolved(`CICS ${m[1]} MAP name`, mapOp, block.offset, map.values);
      continue;
    }
    const fields = lookups.mapFields.get(map.exact);
    const via = [mapset ? `mapset ${mapset}` : '', fields !== undefined ? `${fields} fields` : ''].filter(Boolean).join(', ');
    c.edge(`screen:${map.exact}`, rel, block.offset, map.isLiteral ? 'extracted' : 'inferred', via || undefined);
  }
  return c.result;
};
