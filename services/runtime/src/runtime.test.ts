// Fast checks that need no Docker: file definitions, record layouts, scenarios, SQL source prep,
// and mapping translated lines back. The sandbox run itself is exercised by `pnpm runtime` and the UI.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fileDefs, loaderSource, openModes } from './cobolFiles';
import { expandCopies, layoutOf, recordReadFrom, testedValues, zoned } from './layout';
import { buildScenarios, dateFromParm, synthesize } from './scenarios';
import { sqlCopybook, sqlProgram } from './sqlSource';
import { alignLines } from './witness';

const app = 'legacy/carddemo/app';
const interest = readFileSync(`${app}/cbl/CBACT04C.cbl`, 'utf8');
const db2 = readFileSync(`${app}/app-transaction-type-db2/cbl/COBTUPDT.cbl`, 'utf8');
const copybooks = new Map([['CVTRA01Y', readFileSync(`${app}/cpy/CVTRA01Y.cpy`, 'utf8')]]);

it('reads every file the interest program declares and how it opens them', () => {
  const defs = fileDefs(interest);
  expect(defs.map((d) => [d.dd, d.organization])).toEqual([
    ['TCATBALF', 'indexed'], ['XREFFILE', 'indexed'], ['ACCTFILE', 'indexed'], ['DISCGRP', 'indexed'], ['TRANSACT', 'sequential'],
  ]);
  const modes = openModes(interest);
  expect(modes.get('TCATBAL-FILE')).toBe('INPUT');
  expect(modes.get('ACCOUNT-FILE')).toBe('I-O');
  expect(modes.get('TRANSACT-FILE')).toBe('OUTPUT');
});

it('loads indexed files by key and sequential files front to back', () => {
  const [tcatbal, , , , transact] = fileDefs(interest);
  expect(loaderSource(tcatbal, 'L1')).toMatch(/ACCESS MODE IS RANDOM[\s\S]*INVALID KEY/);
  expect(loaderSource(transact, 'L2')).not.toMatch(/INVALID KEY/);
});

it('lays out the category-balance record from its copybook, money field included', () => {
  const lines = expandCopies(interest, copybooks);
  const record = recordReadFrom(lines, 'TCATBAL-FILE', 'FD-TRAN-CAT-BAL-RECORD');
  expect(record).toBe('TRAN-CAT-BAL-RECORD');
  const bal = layoutOf(lines, record).find((f) => f.name === 'TRAN-CAT-BAL')!;
  expect(bal).toMatchObject({ offset: 17, length: 11, kind: 'num', scale: 2, signed: true });
  expect(zoned(bal, -125.5)).toBe('0000001255}');
  expect(zoned(bal, 0)).toBe('0000000000{');
});

it('builds input for the DB2 program from the values its EVALUATE tests', () => {
  const lines = expandCopies(db2, new Map());
  const fields = layoutOf(lines, recordReadFrom(lines, 'TR-RECORD', 'WS-INPUT-VARS'));
  const tested = testedValues(lines, fields);
  expect(tested.get('INPUT-REC-TYPE')).toEqual(['A', 'U', 'D', '*']);
  expect(synthesize(fields, tested).split('\n').filter(Boolean).map((r) => r[0])).toEqual(['A', 'U', 'D', '*']);
});

it('derives scenarios from the program: branches, money edges, failed lookups, order', () => {
  const lines = expandCopies(db2, new Map());
  const fields = layoutOf(lines, 'WS-INPUT-REC');
  const tested = testedValues(lines, fields);
  const names = buildScenarios({
    driving: { dd: 'IN', text: synthesize(fields, tested), sequential: true, fields, tested, synthesized: true },
    others: [{ dd: 'LOOK', text: 'x\n', lookup: true }],
  }).map((s) => s.name);
  expect(names).toEqual(['normal', 'empty', 'branches', 'no-match-look', 'duplicates', 'out-of-order', 'bad-records']);
  expect(dateFromParm('2022071800')).toBe('2022/07/18');
});

it('prepares DB2 source for the translator without moving any line', () => {
  const out = sqlProgram(db2);
  expect(out.split('\n').length).toBe(db2.split(/\r?\n/).length + 1);
  expect(out).toMatch(/EXEC SQL INCLUDE SQLCA END-EXEC\./);
  expect(out).not.toMatch(/STOP RUN/);
  const dcl = sqlCopybook(readFileSync(`${app}/app-transaction-type-db2/dcl/DCLTRTYP.dcl`, 'utf8'));
  expect(dcl).not.toMatch(/DECLARE/);
});

it('maps translated lines back to the original, ignoring inlined copybook comments', () => {
  const original = ['       PROCEDURE DIVISION.', '      * a comment', '           EXEC SQL', '             DELETE FROM T', '           END-EXEC.', '           GOBACK.'].join('\n');
  const translated = ['       PROCEDURE DIVISION.', 'OCESQL*  GOBACK.', 'OCESQL*    EXEC SQL', 'OCESQL*      DELETE FROM T', 'OCESQL*    END-EXEC.', 'OCESQL     CALL "OCESQLExec"', '           GOBACK.'].join('\n');
  expect(alignLines(original, translated)).toEqual([1, 1, 3, 4, 5, 5, 6]);
});
