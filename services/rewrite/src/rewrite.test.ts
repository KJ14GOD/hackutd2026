// The diff behind every match rate: alignment, classification, and what counts as the program's own output.
import { expect, it } from 'vitest';
import { classify, cleanCobolOutput, diffLines, groupMismatches, onlySignOrLastDigit, overpunchCount } from './diff';
import { extractJava } from './prompt';

it('aligns around a missing line instead of failing every line after it', () => {
  const d = diffLines('normal', ['a', 'b', 'c', 'd'], ['a', 'c', 'd']);
  expect(d).toMatchObject({ matched: 3, total: 4 });
  expect(d.mismatches).toEqual([{ scenario: 'normal', line: 2, old: 'b', new: '', category: 'logic' }]);
});

it('classifies by code: spacing and zero padding are formatting, a cent is rounding, timestamps are noise', () => {
  expect(classify('TOTAL :  0042', 'TOTAL : 42')).toBe('formatting');
  expect(classify('INTEREST 1255', 'INTEREST 1256')).toBe('rounding');
  expect(classify('RUN 2022-07-18-01.00.00.000000 OK', 'RUN 2026-11-08-09.12.44.123456 OK')).toBe('noise');
  expect(classify('ACCOUNT NOT FOUND', 'ACCOUNT UPDATED')).toBe('logic');
});

it('drops runtime lines that are not the program output', () => {
  expect(cleanCobolOutput('START\nTHESEUS-STUB CEE3ABD\nlibcob: warning: implicit CLOSE\nEND\n')).toEqual(['START', 'END']);
});

it('pulls the Java file out of a fenced reply, even one cut off before the closing fence', () => {
  expect(extractJava('Here:\n```java\npublic class Main {}\n```\nthanks')).toBe('public class Main {}\n');
  expect(extractJava('```java\npublic class Main {')).toBe('public class Main {\n');
});

it('groups a block and its exit-code mismatch as one cause, even with several exit-code mismatches', () => {
  const g = groupMismatches([
    { scenario: 'a', line: 0, old: 'exit 16', new: 'exit 4', category: 'logic' },
    { scenario: 'a', line: 3, old: 'ERROR', new: 'OK', category: 'logic' },
    { scenario: 'a', line: 4, old: 'X', new: 'Y', category: 'logic' },
    { scenario: 'b', line: 0, old: 'exit 16', new: 'exit 4', category: 'logic' },
  ]);
  expect(g.map((x) => x.lines)).toEqual([3, 1]);
  expect(g[0].scenarios).toEqual(['a']);
});

it('recognizes the lines a different sign-overpunch reading produces, and nothing else', () => {
  expect(onlySignOrLastDigit('ACCT-CURR-BAL :000000012550+', 'ACCT-CURR-BAL :000000012550-')).toBe(true);
  expect(onlySignOrLastDigit('CREDIT :999999999990+', 'CREDIT :999999999999+')).toBe(true);
  expect(onlySignOrLastDigit('CREDIT :999999999990+', 'CREDIT :999999999890+')).toBe(false);
  expect(onlySignOrLastDigit('ACCOUNT NOT FOUND', 'ACCOUNT NOT FOUNT')).toBe(false);
  expect(overpunchCount('00000001940{ 0000001255} 000099I')).toBe(2);
});
