// SpacetimeDB module entry. Built so far: config and the segmentation tables. Everything
// else in docs/DATA_MODEL.md is still PROPOSED and comes once the team signs off on it.
//
// Reducers are the named exports of this file; SpacetimeDB converts the names to
// snake_case for the CLI and SQL (setConfig becomes set_config). Each area keeps its
// reducers in src/reducers/<area>.ts and re-exports them here.
import { SenderError, t } from 'spacetimedb/server';
import spacetimedb from './schema';

export default spacetimedb;
export * from './reducers/segmentation';

export const init = spacetimedb.init((ctx) => {
  ctx.db.config.insert({ id: 0, json: '', version: 0 });
});

/** Stores the config file contents. Validation happens client-side (packages/shared). */
export const setConfig = spacetimedb.reducer({ json: t.string() }, (ctx, { json }) => {
  try {
    JSON.parse(json);
  } catch {
    throw new SenderError('setConfig: invalid JSON');
  }
  const row = ctx.db.config.id.find(0);
  const version = (row?.version ?? 0) + 1;
  if (row) ctx.db.config.id.update({ id: 0, json, version });
  else ctx.db.config.insert({ id: 0, json, version });
});
