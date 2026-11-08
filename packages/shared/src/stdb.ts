// One way to connect to SpacetimeDB from any Node service or script.
// Bindings in ./module_bindings are generated: run `pnpm stdb:generate` after any
// module change and commit the result.
import { DbConnection } from './module_bindings';
import { loadEnv } from './config';

export interface ConnectOptions {
  uri?: string;
  database?: string;
}

/** Connects and resolves once the connection is open. */
export function connectStdb(opts: ConnectOptions = {}): Promise<DbConnection> {
  loadEnv();
  const uri = opts.uri ?? process.env.STDB_URI ?? 'ws://localhost:3000';
  const database = opts.database ?? process.env.STDB_DB ?? 'theseus';
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .onConnect((conn) => resolve(conn))
      .onConnectError((_ctx, err) => reject(err))
      .build();
  });
}
