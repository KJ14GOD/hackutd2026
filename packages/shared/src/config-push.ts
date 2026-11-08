// `pnpm config:push`: validates theseus.config.json and stores it in SpacetimeDB
// (config table) so reducers can read it. Run it after every config edit.
import { readFileSync } from 'node:fs';
import { configPath, parseConfig } from './config';
import { connectStdb } from './stdb';

const raw = readFileSync(configPath(), 'utf8');
parseConfig(JSON.parse(raw)); // throws with a readable zod error if the file is invalid

const conn = await connectStdb();
await conn.reducers.setConfig({ json: raw });
console.log(`config pushed from ${configPath()}`);
conn.disconnect();
process.exit(0);
