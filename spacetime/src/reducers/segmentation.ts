// Segmentation reducers. Owner: segmenter (services/segmenter). docs/SEGMENTATION.md.
import { SenderError, t } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { parseSegmentation } from '../segmentation';

/**
 * Replaces the whole segmentation (graph, pockets, endpoints) with the segmenter's output.
 * All or nothing: a bad payload changes nothing.
 */
export const loadSegmentation = spacetimedb.reducer({ json: t.string() }, (ctx, { json }) => {
  let rows;
  try {
    rows = parseSegmentation(json);
  } catch (e) {
    throw new SenderError(`loadSegmentation: ${(e as Error).message}`);
  }

  for (const r of [...ctx.db.graphNode.iter()]) ctx.db.graphNode.id.delete(r.id);
  for (const r of [...ctx.db.depEdge.iter()]) ctx.db.depEdge.id.delete(r.id);
  for (const r of [...ctx.db.pocket.iter()]) ctx.db.pocket.id.delete(r.id);
  for (const r of [...ctx.db.pocketEdge.iter()]) ctx.db.pocketEdge.id.delete(r.id);
  for (const r of [...ctx.db.endpoint.iter()]) ctx.db.endpoint.id.delete(r.id);

  const run = { id: 0, ...rows.run, loadedAtMs: Number(ctx.timestamp.toMillis()) };
  if (ctx.db.segmentationRun.id.find(0)) ctx.db.segmentationRun.id.update(run);
  else ctx.db.segmentationRun.insert(run);

  // Domains before pockets so subscribers can place pockets as rows arrive.
  const ordered = [...rows.pockets].sort((a, b) => (a.level === b.level ? 0 : a.level === 'domain' ? -1 : 1));
  for (const p of ordered) ctx.db.pocket.insert(p);
  for (const n of rows.nodes) ctx.db.graphNode.insert(n);
  for (const e of rows.edges) ctx.db.depEdge.insert({ id: 0, ...e });
  for (const e of rows.pocketEdges) ctx.db.pocketEdge.insert({ id: 0, ...e });
  for (const e of rows.endpoints) ctx.db.endpoint.insert(e);
});
