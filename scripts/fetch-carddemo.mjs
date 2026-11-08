#!/usr/bin/env node
// Downloads AWS CardDemo (Apache-2.0) at a pinned commit into legacy/carddemo/ (gitignored).
// CardDemo is the real legacy codebase we segment and modernize (docs/DECISIONS.md D-014).
// Bump CARDDEMO_SHA deliberately; segmentation output and demo seeds depend on it.
//
//   pnpm legacy:fetch          fetch if missing
//   pnpm legacy:fetch --force  delete and fetch again
//
// The fetch is a blobless partial clone: full commit history (the segmenter reads it for
// co-change), but file contents only for the pinned checkout.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/aws-samples/aws-mainframe-modernization-carddemo.git';
const CARDDEMO_SHA = '59cc6c2fd7ebd7ef7925cad552a01a4b8b6e4d5e'; // main on 2026-11-07
const DEST = resolve(ROOT, 'legacy/carddemo');

function git(...args) {
  const r = spawnSync('git', args, { cwd: DEST, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (process.argv.includes('--force')) rmSync(DEST, { recursive: true, force: true });
if (existsSync(resolve(DEST, '.git'))) {
  const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: DEST, encoding: 'utf8' });
  const note = shallow.stdout?.trim() === 'true' ? ' (shallow: run with --force to get history for co-change)' : '';
  console.log(`legacy/carddemo already present${note} (use --force to refetch)`);
  process.exit(0);
}
mkdirSync(DEST, { recursive: true });
git('init', '--quiet');
git('remote', 'add', 'origin', REPO);
git('fetch', '--quiet', '--filter=blob:none', 'origin', CARDDEMO_SHA);
git('checkout', '--quiet', 'FETCH_HEAD');
console.log(`CardDemo ${CARDDEMO_SHA.slice(0, 7)} -> legacy/carddemo`);
