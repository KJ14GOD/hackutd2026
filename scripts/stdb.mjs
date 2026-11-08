#!/usr/bin/env node
// SpacetimeDB helper: uses the native `spacetime` CLI when it is on PATH, otherwise the
// official Docker image (clockworklabs/spacetime). Same commands either way:
//
//   node scripts/stdb.mjs start                 start the local server on :3000
//   node scripts/stdb.mjs stop                  stop it (docker mode only; native: Ctrl+C)
//   node scripts/stdb.mjs publish [--delete-data]
//   node scripts/stdb.mjs generate              regenerate TS client bindings
//   node scripts/stdb.mjs sql "SELECT * FROM pocket"
//   node scripts/stdb.mjs logs [-f]
//   node scripts/stdb.mjs call <reducer> [args...]
//
// Force a mode with STDB_MODE=native|docker. Docker mode stores its CLI login in
// .cache/stdb-cli (gitignored). Delete that folder together with the container to start over.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = 'clockworklabs/spacetime:v2.14.1';
const CONTAINER = 'theseus-stdb';
const DB = process.env.STDB_DB ?? 'theseus';
const SERVER = 'http://localhost:3000';
const MODULE_DIR = 'spacetime';
const BINDINGS_DIR = 'packages/shared/src/module_bindings';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: false, ...opts });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

function hasNative() {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['spacetime'], { stdio: 'ignore' });
  return probe.status === 0;
}

const mode = process.env.STDB_MODE ?? (hasNative() ? 'native' : 'docker');

// Docker mode keeps the CLI identity in a gitignored host folder. A Docker named volume
// is not writable by the image's user, and the CLI hangs without saying why. The database
// is owned by this identity, so it must survive between runs.
const CLI_CONFIG_DIR = resolve(ROOT, '.cache/stdb-cli');

function dockerCli(args) {
  return run('docker', [
    'run', '--rm', '--network', `container:${CONTAINER}`,
    '-v', `${ROOT}:/repo`,
    '-v', `${CLI_CONFIG_DIR}:/home/spacetime/.config/spacetime`,
    '--entrypoint', '/opt/spacetime/spacetimedb-cli',
    IMAGE,
    ...args,
  ]);
}

/** Runs a spacetime CLI command. `p(x)` maps a repo-relative path to what the CLI sees. */
function cli(build) {
  if (mode === 'native') return run('spacetime', build((x) => resolve(ROOT, x)));
  if (!existsSync(resolve(CLI_CONFIG_DIR, 'cli.toml'))) {
    mkdirSync(CLI_CONFIG_DIR, { recursive: true });
    const code = dockerCli(['login', '--server-issued-login', SERVER]);
    if (code !== 0) return code;
  }
  return dockerCli(build((x) => `/repo/${x}`));
}

const [cmd, ...rest] = process.argv.slice(2);
let code = 0;
switch (cmd) {
  case 'start':
    if (mode === 'native') {
      code = run('spacetime', ['start']);
    } else {
      const exists = spawnSync('docker', ['inspect', CONTAINER], { stdio: 'ignore' }).status === 0;
      code = exists
        ? run('docker', ['start', CONTAINER])
        : run('docker', [
            'run', '-d', '--name', CONTAINER, '-p', '3000:3000', IMAGE, 'start',
          ]);
      if (code === 0) console.log(`SpacetimeDB running in container ${CONTAINER} on ${SERVER}`);
    }
    break;
  case 'stop':
    code = mode === 'docker' ? run('docker', ['stop', CONTAINER]) : (console.log('native mode: stop with Ctrl+C'), 0);
    break;
  case 'publish': {
    const wipe = rest.includes('--delete-data');
    code = cli((p) => ['publish', '-p', p(MODULE_DIR), '-s', SERVER, '-y', ...(wipe ? ['--delete-data=always'] : []), DB]);
    break;
  }
  case 'generate':
    code = cli((p) => ['generate', '--lang', 'typescript', '--out-dir', p(BINDINGS_DIR), '-p', p(MODULE_DIR)]);
    break;
  case 'sql':
    code = cli(() => ['sql', '-s', SERVER, DB, rest.join(' ')]);
    break;
  case 'logs':
    code = cli(() => ['logs', '-s', SERVER, ...rest, DB]);
    break;
  case 'call':
    code = cli(() => ['call', '-s', SERVER, DB, ...rest]);
    break;
  default:
    console.log('usage: node scripts/stdb.mjs <start|stop|publish [--delete-data]|generate|sql|logs|call>');
    code = cmd ? 1 : 0;
}
process.exit(code);
