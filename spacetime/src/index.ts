// SpacetimeDB module: PLACEHOLDER.
// This proves the toolchain works (build, publish, generate bindings, push config).
// It holds only the config table. The real tables and reducers come once the team
// signs off on docs/DATA_MODEL.md.
//
// Reducer names come from the export names. SpacetimeDB converts them to snake_case
// for the CLI and SQL (setConfig becomes set_config).
import { schema, table, t, SenderError } from 'spacetimedb/server';

const spacetimedb = schema({
  /** theseus.config.json as last pushed with `pnpm config:push`. Single row, id 0. */
  config: table(
    { public: true },
    {
      id: t.u32().primaryKey(),
      json: t.string(),
      version: t.u32(),
    },
  ),
});

export default spacetimedb;

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
