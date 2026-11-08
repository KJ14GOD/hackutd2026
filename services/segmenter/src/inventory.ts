// Step 1 (inventory) and step 2 (normalize). Classifies by content first, extension second.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { decodeEbcdic, looksEbcdic } from './ebcdic';
import type { Line, NormalizedProgram } from './types';

export type FileKind =
  | 'program' | 'copybook' | 'job' | 'proc' | 'online-config' | 'scheduler' | 'db-def' | 'ims-def'
  | 'screen-def' | 'external-source' | 'control' | 'data' | 'doc' | 'tooling' | 'unknown';

export interface SourceFile {
  /** Path relative to the repo root, forward slashes. */
  path: string;
  /** Member name: file name without extension, uppercased. */
  name: string;
  kind: FileKind;
  text: string;
  ebcdic: boolean;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', 'out']);

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(full);
  }
}

/** Decides what a file is from what it contains. The extension only breaks ties. */
export function classify(path: string, text: string): FileKind {
  const ext = extname(path).toLowerCase();
  const lower = path.toLowerCase();
  const body = text.slice(0, 200_000);
  if (/^.{0,8}(IDENTIFICATION|ID)\s+DIVISION/im.test(body) && /PROGRAM-ID/i.test(body)) return 'program';
  const firstCode = body.split(/\r?\n/).find((l) => l.trim() !== '' && !l.startsWith('//*') && !/^\s*\*/.test(l)) ?? '';
  if (firstCode.startsWith('//')) {
    if (/^\/\/\S*\s+JOB\b/m.test(body)) return 'job';
    if (/^\/\/\S*\s+PROC\b/m.test(body)) return 'proc';
  }
  if (/<DEFTABLE\b/.test(body) || /LJOB,JOB=/.test(body)) return 'scheduler';
  if (/^\s*DEFINE\s+(FILE|TRANSACTION|PROGRAM|TDQUEUE|MAPSET|TSMODEL)\s*\(/im.test(body)) return 'online-config';
  if (/\b(PSBGEN|DBDGEN)\b/.test(body)) return 'ims-def';
  if (/\bDFHMSD\b/.test(body)) return 'screen-def';
  if (/EXEC\s+SQL\s+DECLARE\s+\S+\s+TABLE/i.test(body)) return 'copybook';
  if (/\bCREATE\s+(UNIQUE\s+)?(TABLE|INDEX|TABLESPACE|VIEW|DATABASE|STOGROUP)\b/i.test(body)) return 'db-def';
  if (/^\S*\s+(CSECT|DSECT|MACRO)\b/m.test(body) || ext === '.asm' || ext === '.mac') return 'external-source';
  if (lower.includes('/data/') || ['.ps', '.dat', '.vsam', '.ebc'].includes(ext)) return 'data';
  if (ext === '.ctl') return 'control';
  if (['.cpy', '.copy'].includes(ext) || /^.{6}\s+\d{2}\s+[A-Z0-9-]+(\s|\.)/m.test(body)) return 'copybook';
  if (['.sh', '.awk', '.py', '.bat', '.cmd', '.ps1', '.zip', '.tar', '.gz'].includes(ext) || text.trim() === '') return 'tooling';
  if (['.md', '.txt', '.gitkeep', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.drawio', '.html'].includes(ext)
    || /^(readme|license|notice|contributing|code_of_conduct|changelog)/.test(basename(lower)) || basename(lower).startsWith('.git')) return 'doc';
  return 'unknown';
}

export function readRepo(root: string): SourceFile[] {
  const paths: string[] = [];
  walk(root, paths);
  return paths.map((full) => {
    const buf = readFileSync(full);
    const ebcdic = looksEbcdic(buf);
    const text = ebcdic ? decodeEbcdic(buf) : buf.toString('utf8');
    const path = relative(root, full).split('\\').join('/');
    const name = basename(path).replace(/\.[^.]+$/, '').toUpperCase();
    return { path, name, kind: classify(path, text), text, ebcdic };
  });
}

/** Keeps the code area of fixed-format COBOL (columns 8-72), drops comment lines, uppercases. */
export function normalizeLines(text: string): Line[] {
  const out: Line[] = [];
  const raws = text.split(/\r?\n/);
  const nonEmpty = raws.filter((r) => r.trim() !== '');
  // Fixed format when nearly every line has an indicator-column character in column 7.
  const fixed = nonEmpty.filter((r) => r.length > 6 && ' *-/Dd'.includes(r[6])).length >= nonEmpty.length * 0.8;
  raws.forEach((raw, i) => {
    let code: string;
    if (fixed && raw.length > 6) {
      const indicator = raw[6];
      if (indicator === '*' || indicator === '/') return;
      code = raw.slice(7, 72);
    } else {
      code = raw;
    }
    const inline = code.indexOf('*>');
    if (inline >= 0) code = code.slice(0, inline);
    if (code.trim() === '') return;
    out.push({ no: i + 1, text: code.toUpperCase() });
  });
  return out;
}

export function normalizeProgram(file: SourceFile): NormalizedProgram {
  const lines = normalizeLines(file.text);
  const starts: number[] = [];
  let joined = '';
  for (const l of lines) {
    starts.push(joined.length);
    joined += l.text + ' ';
  }
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lines[lo]?.no ?? 1;
  };
  const idMatch = /PROGRAM-ID\.?\s+['"]?([A-Z0-9#@$-]+)/.exec(joined);
  return {
    name: idMatch?.[1] ?? file.name,
    path: file.path,
    lines,
    joined,
    lineAt,
    online: /EXEC\s+CICS\b/.test(joined),
    totalLines: file.text.split(/\r?\n/).length,
  };
}
