// Finds which programs a piece of text is about: program names, the jobs that run them (INTCALC means
// CBACT04C), and short forms like COTRN02. Built from the Part 1 map, so it works for any codebase.
import type { Pass1 } from '../../segmenter/src/types';

export interface ScopeIndex { programs: Set<string>; byToken: Map<string, Set<string>> }

export function scopeIndex(pass1: Pass1): ScopeIndex {
  const programs = new Set(pass1.inventory.programs);
  const byToken = new Map<string, Set<string>>();
  const add = (token: string, program: string) => {
    if (!byToken.has(token)) byToken.set(token, new Set());
    byToken.get(token)!.add(program);
  };
  for (const p of programs) {
    add(p, p);
    // "COTRN02" for COTRN02C, but only when that short form names one program.
    const short = p.slice(0, -1);
    if (short.length >= 6 && [...programs].filter((q) => q.startsWith(short)).length === 1) add(short, p);
  }
  for (const e of pass1.edges) if (e.rel === 'runs' && e.from.startsWith('job:') && e.to.startsWith('prog:')) add(e.from.slice(4), e.to.slice(5));
  return { programs, byToken };
}

/** Program ids (prog:X) a text mentions. */
export function mentions(index: ScopeIndex, text: string): string[] {
  const found = new Set<string>();
  for (const word of text.toUpperCase().match(/[A-Z0-9#@$-]{5,}/g) ?? []) {
    for (const p of index.byToken.get(word) ?? []) found.add(`prog:${p}`);
  }
  return [...found].sort();
}

/** Programs a repo path is about, e.g. app/cbl/CBACT04C.cbl or a CODEOWNERS glob like /app/cbl/CB*. */
export function programsForPath(index: ScopeIndex, path: string): string[] {
  const base = path.split('/').pop() ?? '';
  const name = base.replace(/\.[^.]*$/, '').toUpperCase();
  if (!name || name === '') {
    // A directory: everything we can't place precisely is left to the caller.
    return [];
  }
  if (name.includes('*')) {
    const re = new RegExp(`^${name.replace(/\*/g, '.*')}$`);
    const inDir = path.includes('/app/cbl/') || path.startsWith('app/cbl/') || path.startsWith('/app/cbl/');
    return [...index.programs].filter((p) => re.test(p) && inDir).map((p) => `prog:${p}`).sort();
  }
  return index.programs.has(name) ? [`prog:${name}`] : (index.byToken.get(name) ? [...index.byToken.get(name)!].map((p) => `prog:${p}`) : []);
}
