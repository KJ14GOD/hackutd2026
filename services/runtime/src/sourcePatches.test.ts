import { describe, expect, it } from 'vitest';
import { patchForGnuCobol } from './sourcePatches';

const col = (s: string) => `       ${s}`;
const program = (fdRecordFollowedBy: string) => [
  col('IDENTIFICATION DIVISION.'),
  col('PROGRAM-ID. DEMO.'),
  col('ENVIRONMENT DIVISION.'),
  col('INPUT-OUTPUT SECTION.'),
  col('FILE-CONTROL.'),
  col('    SELECT OUT-FILE ASSIGN TO OUTF'),
  col('        ORGANIZATION IS INDEXED'),
  col('        ACCESS MODE IS SEQUENTIAL'),
  col('        RECORD KEY IS WS-SEQ'),
  col('        FILE STATUS IS WS-STATUS.'),
  col('DATA DIVISION.'),
  col('FILE SECTION.'),
  col('FD  OUT-FILE.'),
  col('01  OUT-RECORD                  PIC X(20).'),
  fdRecordFollowedBy,
  col('WORKING-STORAGE SECTION.'),
  col('01  WS-RECORD.'),
  col('    05  WS-TYPE                 PIC X(1).'),
  col('    05  WS-SEQ                  PIC 9(9) COMP.'),
  col('    05  WS-REST                 PIC X(15).'),
  col('01  WS-STATUS                   PIC XX.'),
  col('PROCEDURE DIVISION.'),
  col('    GOBACK.'),
].join('\n');

describe('patchForGnuCobol', () => {
  it('moves a working-storage record key into the file record, keeping every line number', () => {
    const text = program('');
    const p = patchForGnuCobol(text, new Map())!;
    const lines = p.text.split('\n');
    expect(lines).toHaveLength(text.split('\n').length);
    expect(lines[8]).toContain('RECORD KEY IS THESEUS-OUTF-KEY');
    expect(lines[13]).toBe(col('01  OUT-RECORD. 05 FILLER PIC X(1).'));
    expect(lines[14]).toBe('           05 THESEUS-OUTF-KEY PIC X(4). 05 FILLER PIC X(15).');
    expect(p.notes[0]).toMatch(/WS-SEQ is in WS-RECORD.*bytes 2-5/);
  });

  it('leaves the source alone when there is no blank line to use', () => {
    expect(patchForGnuCobol(program(col('* no room')), new Map())).toBeNull();
  });

  it('leaves a key that is already in the file record alone', () => {
    const ok = program('').replace('RECORD KEY IS WS-SEQ', 'RECORD KEY IS OUT-RECORD');
    expect(patchForGnuCobol(ok, new Map())).toBeNull();
  });
});
