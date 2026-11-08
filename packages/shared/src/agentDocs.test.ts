// CLAUDE.md (Claude Code) and AGENTS.md (Codex and other agents) carry the same
// instructions. This fails as soon as someone edits one without the other.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { findRepoRoot } from './config';

it('CLAUDE.md and AGENTS.md are identical', () => {
  const root = findRepoRoot();
  const read = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n');
  expect(read('AGENTS.md')).toBe(read('CLAUDE.md'));
});
