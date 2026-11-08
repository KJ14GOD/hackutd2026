// Seeds github.json into a private GitHub repo: CardDemo files with commits authored and dated as the
// synthetic Harbor Card people, plus CODEOWNERS. Usage: node fixtures/org/seed-github.mjs <owner/repo> <workdir>
// Each commit appends one comment line to its file, so the history is real without changing behavior.
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [repo, work] = process.argv.slice(2);
if (!repo || !work) throw new Error('usage: seed-github.mjs <owner/repo> <workdir>');
const here = dirname(new URL(import.meta.url).pathname);
const gh = JSON.parse(readFileSync(join(here, 'github.json'), 'utf8'));
const hr = JSON.parse(readFileSync(join(here, 'hr.json'), 'utf8'));
const legacy = resolve(here, '../../legacy/carddemo');
const who = (id) => {
  const w = hr.workers.find((x) => x.workerId === id);
  return w ? { name: `${w.firstName} ${w.lastName}`, email: w.workEmail } : gh.aliases[id];
};
const git = (args, env = {}) => execFileSync('git', args, { cwd: work, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

mkdirSync(work, { recursive: true });
git(['init', '-q', '-b', 'main']);
const files = [...new Set(gh.commits.map((c) => c.path))];
for (const f of files) { mkdirSync(dirname(join(work, f)), { recursive: true }); copyFileSync(join(legacy, f), join(work, f)); }
writeFileSync(join(work, 'README.md'), '# Harbor Card mainframe\n\nSynthetic history for the Theseus demo, on top of AWS CardDemo (Apache-2.0).\n');
const first = '2018-12-03T10:00:00';
git(['add', '.']);
git(['commit', '-q', '-m', 'Import CardDemo programs'], { GIT_AUTHOR_NAME: 'Dana Whitfield', GIT_AUTHOR_EMAIL: who('dana').email, GIT_AUTHOR_DATE: first, GIT_COMMITTER_NAME: 'Dana Whitfield', GIT_COMMITTER_EMAIL: who('dana').email, GIT_COMMITTER_DATE: first });

for (const c of [...gh.commits].sort((a, b) => a.date.localeCompare(b.date))) {
  const p = who(c.author);
  appendFileSync(join(work, c.path), `      * ${c.date} ${c.message}`.slice(0, 72) + '\n');
  if (c.message.includes('CODEOWNERS')) { mkdirSync(join(work, '.github'), { recursive: true }); writeFileSync(join(work, '.github/CODEOWNERS'), gh.codeowners); }
  git(['add', '.']);
  const date = `${c.date}T15:00:00`;
  git(['commit', '-q', '-m', c.message], { GIT_AUTHOR_NAME: p.name, GIT_AUTHOR_EMAIL: p.email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: p.name, GIT_COMMITTER_EMAIL: p.email, GIT_COMMITTER_DATE: date });
}
console.log(git(['log', '--format=%ad %an: %s', '--date=short']).trim().split('\n').slice(0, 5).join('\n'));
console.log(`${gh.commits.length + 1} commits ready in ${work}; push with: gh repo create ${repo} --private --source ${work} --push`);
