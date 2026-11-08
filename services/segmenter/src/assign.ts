// Places every non-program node in a pocket, given where the programs landed. Pure.
// Resources go to the pocket that uses them most (writes count double) when that pocket has
// at least `ownershipMin` of the access weight; otherwise they are shared.
import type { GraphEdge, GraphNode } from './types';

export const SHARED_POCKET = 'pkt-shared';

/** Highest-weight key and its share of the total. Ties break on the key. */
export function dominant(weights: Map<string, number>): { key: string; share: number } | undefined {
  let total = 0;
  let best: string | undefined;
  for (const [k, w] of [...weights].sort(([a], [b]) => a.localeCompare(b))) {
    total += w;
    if (best === undefined || w > weights.get(best)!) best = k;
  }
  return best === undefined || total === 0 ? undefined : { key: best, share: weights.get(best)! / total };
}

export function assignNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  programPocket: Map<string, string>,
  opt: { ownershipMin: number; resourceKinds: Set<string> },
): Map<string, string> {
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const isResource = (id: string) => opt.resourceKinds.has(kindOf.get(id)!) && kindOf.get(id) !== 'job';
  const out = new Map(programPocket);
  const owner = (weights: Map<string, number>) => {
    const d = dominant(weights);
    return d && d.share >= opt.ownershipMin ? d.key : SHARED_POCKET;
  };
  const bump = (m: Map<string, Map<string, number>>, node: string, pocket: string, w: number) => {
    if (!m.has(node)) m.set(node, new Map());
    const inner = m.get(node)!;
    inner.set(pocket, (inner.get(pocket) ?? 0) + w);
  };

  // 1. Resources touched by programs.
  const byPrograms = new Map<string, Map<string, number>>();
  for (const e of edges) {
    const pocket = programPocket.get(e.src);
    if (pocket && isResource(e.dst)) bump(byPrograms, e.dst, pocket, e.kind === 'write' ? 2 : 1);
  }
  for (const [resource, weights] of byPrograms) out.set(resource, owner(weights));

  // 2. Jobs follow the programs they run, else the resources they touch.
  const jobVotes = new Map<string, Map<string, number>>();
  for (const e of edges) {
    if (kindOf.get(e.src) !== 'job') continue;
    if (e.kind === 'runs' && programPocket.has(e.dst)) bump(jobVotes, e.src, programPocket.get(e.dst)!, 10);
    else if (out.has(e.dst) && out.get(e.dst) !== SHARED_POCKET) bump(jobVotes, e.src, out.get(e.dst)!, 1);
  }
  for (const n of nodes) {
    if (n.kind !== 'job') continue;
    out.set(n.id, dominant(jobVotes.get(n.id) ?? new Map())?.key ?? SHARED_POCKET);
  }

  // 3. Resources only jobs touch (e.g. a sort work file): follow those jobs.
  const byJobs = new Map<string, Map<string, number>>();
  for (const e of edges) {
    if (kindOf.get(e.src) !== 'job' || out.has(e.dst) || !isResource(e.dst)) continue;
    bump(byJobs, e.dst, out.get(e.src)!, e.kind === 'write' ? 2 : 1);
  }
  for (const [resource, weights] of byJobs) out.set(resource, owner(weights));

  // 4. Transactions follow their program. Utilities, system APIs and programs with no source
  //    are not ours to migrate: unassigned. Any other leftover is shared.
  for (const e of edges) {
    if (e.kind === 'starts' && kindOf.get(e.src) === 'transaction') out.set(e.src, programPocket.get(e.dst) ?? SHARED_POCKET);
  }
  for (const n of nodes) {
    if (out.has(n.id)) continue;
    out.set(n.id, opt.resourceKinds.has(n.kind) || n.kind === 'transaction' ? SHARED_POCKET : '');
  }
  return out;
}
