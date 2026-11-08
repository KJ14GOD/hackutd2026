// Endpoints are what traffic hits: CICS transactions and batch jobs. Each maps to the pocket of
// its entry program, plus every pocket reachable through calls/links/transfers (not through
// hubs), so the router can tell which pockets a request touches. Pure.
import type { BuiltGraph } from './deps';
import type { Endpoint } from './types';

const INVOCATIONS = new Set(['calls', 'links', 'transfers']);

export function buildEndpoints(graph: BuiltGraph, pocketOf: Map<string, string>, hubs: Set<string>): Endpoint[] {
  const next = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!INVOCATIONS.has(e.kind) || e.confidence === 'unknown' || !pocketOf.get(e.dst)) continue;
    if (!next.has(e.src)) next.set(e.src, []);
    next.get(e.src)!.push(e.dst);
  }
  const servedBy = (entry: string): string[] => {
    const seen = new Set([entry]);
    const queue = hubs.has(entry) ? [] : [entry];
    while (queue.length) {
      for (const m of next.get(queue.shift()!) ?? []) {
        if (seen.has(m) || hubs.has(m)) continue;
        seen.add(m);
        queue.push(m);
      }
    }
    const first = pocketOf.get(entry) ?? '';
    const rest = [...new Set([...seen].map((n) => pocketOf.get(n) ?? ''))].filter((p) => p && p !== first).sort();
    return first ? [first, ...rest] : rest;
  };

  const out: Endpoint[] = [];
  for (const t of graph.transactions) {
    if (!pocketOf.get(t.program)) continue; // program not in source
    out.push({
      id: `CICS ${t.name}`,
      kind: 'cics',
      name: t.name,
      description: t.description,
      entryNode: t.program,
      pocketId: pocketOf.get(t.program)!,
      servedBy: servedBy(t.program),
    });
  }
  for (const j of graph.jobs) {
    const entries = j.programs.filter((p) => pocketOf.get(p));
    if (!entries.length) continue; // utility-only job (IDCAMS, SORT): nothing of ours to migrate
    out.push({
      id: `JOB ${j.name}`,
      kind: 'batch',
      name: j.name,
      description: `runs ${entries.map((p) => p.slice(p.indexOf(':') + 1)).join(', ')}`,
      entryNode: entries[0],
      pocketId: pocketOf.get(j.id) || pocketOf.get(entries[0])!,
      servedBy: [...new Set(entries.flatMap(servedBy))],
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
