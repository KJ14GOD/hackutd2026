import { describe, expect, it } from 'vitest';
import { expandCopybooks } from './expand';
import { extractCobol, resolveRef } from './extract';
import { cleanSource, countLoc } from './source';

/** Fixed-format line: 6-column sequence area, indicator, code from column 8. */
const L = (code: string, indicator = ' ') => `000100${indicator}${code}`;
const program = (...body: string[]) =>
  [L('IDENTIFICATION DIVISION.'), L('PROGRAM-ID. TESTPGM.'), L('DATA DIVISION.'), ...body].join('\n');

describe('cleanSource', () => {
  it('drops sequence areas, comments and columns past 72', () => {
    const src = [L('MOVE A TO B.'), L('THIS IS A COMMENT', '*'), L('PAGE', '/'), `000300 DISPLAY 'X'.${' '.repeat(53)}SEQ00003`].join('\n');
    expect(cleanSource(src).map((l) => l.text)).toEqual(['MOVE A TO B.', "DISPLAY 'X'."]);
    expect(countLoc(src)).toBe(2);
  });

  it('joins continuation lines inside literals', () => {
    const src = [L("    MOVE 'ABC"), L("    'DEF' TO X.", '-')].join('\n');
    expect(cleanSource(src)[0].text).toContain("'ABCDEF' TO X.");
  });

  it('handles free format', () => {
    const src = '>>SOURCE FORMAT FREE\nmove a to b. *> note\n*> whole comment\n';
    expect(cleanSource(src).map((l) => l.text)).toEqual(['MOVE A TO B.']);
  });
});

describe('extractCobol', () => {
  it('finds static CALLs but not text that only looks like one', () => {
    const f = extractCobol(
      program(
        L("01 WS-MSG PIC X(30) VALUE 'DLI CALL FAILED'."),
        L('PROCEDURE DIVISION.'),
        L("    CALL 'SUBPGM' USING X."),
        L('    PERFORM 1000-CALL THRU 1000-EXIT.'),
        L("    DISPLAY '<p style=\"x\">' 'CALL NOWHERE'."),
        L("    CALL 'OTHER'."),
      ),
    );
    expect(f.programId).toBe('TESTPGM');
    expect(f.invocations).toEqual([
      { kind: 'call', ref: { literal: 'SUBPGM' } },
      { kind: 'call', ref: { literal: 'OTHER' } },
    ]);
  });

  it('resolves a dynamic XCTL through MOVE chains', () => {
    const f = extractCobol(
      program(
        L("01 LIT-MENUPGM PIC X(8) VALUE 'COMEN01C'."),
        L('01 TO-PROGRAM PIC X(8).'),
        L('PROCEDURE DIVISION.'),
        L('    MOVE LIT-MENUPGM TO TO-PROGRAM.'),
        L('    EXEC CICS XCTL PROGRAM(TO-PROGRAM) END-EXEC.'),
      ),
    );
    expect(f.invocations).toEqual([{ kind: 'xctl', ref: { variable: 'TO-PROGRAM' } }]);
    const known = new Set(['COMEN01C', 'COSGN00C']);
    expect(resolveRef(f.invocations[0].ref, f, (n) => known.has(n))).toEqual({ values: ['COMEN01C'], confidence: 'resolved' });
  });

  it('falls back to known names among the literals (menu tables), or gives up', () => {
    const f = extractCobol(
      program(
        L("01 FILLER PIC X(8) VALUE 'COACTVWC'."),
        L("01 FILLER PIC X(8) VALUE 'COCRDLIC'."),
        L('PROCEDURE DIVISION.'),
        L('    MOVE OPT-PGM(IDX) TO NEXT-PGM.'),
        L('    EXEC CICS XCTL PROGRAM(NEXT-PGM) END-EXEC.'),
      ),
    );
    const known = new Set(['COACTVWC', 'COCRDLIC']);
    expect(resolveRef(f.invocations[0].ref, f, (n) => known.has(n))).toEqual({ values: ['COACTVWC', 'COCRDLIC'], confidence: 'heuristic' });
    expect(resolveRef(f.invocations[0].ref, f, (n) => known.has(n), false).confidence).toBe('unresolved');
  });

  it('reads CICS file access with modes', () => {
    const f = extractCobol(
      program(
        L("01 WS-ACCTDAT-FILE PIC X(8) VALUE 'ACCTDAT '."),
        L('PROCEDURE DIVISION.'),
        L('    EXEC CICS READ DATASET(WS-ACCTDAT-FILE) INTO(REC)'),
        L('         RIDFLD(KEY) END-EXEC.'),
        L("    EXEC CICS REWRITE FILE('CARDDAT') FROM(REC) END-EXEC."),
        L("    EXEC CICS SEND MAP('COACTVW') MAPSET('COACTVW') END-EXEC."),
      ),
    );
    expect(f.cicsFiles).toEqual([
      { ref: { variable: 'WS-ACCTDAT-FILE' }, mode: 'read' },
      { ref: { literal: 'CARDDAT' }, mode: 'write' },
    ]);
    expect(resolveRef(f.cicsFiles[0].ref, f, () => true).values).toEqual(['ACCTDAT']);
    expect(f.maps).toEqual([{ literal: 'COACTVW' }]);
  });

  it('maps SELECT/ASSIGN to DD names with OPEN modes', () => {
    const f = extractCobol(
      program(
        L('FILE-CONTROL.'),
        L('    SELECT ACCT-FILE ASSIGN TO ACCTFILE.'),
        L('    SELECT OUT-FILE ASSIGN TO UT-S-REPORT.'),
        L('PROCEDURE DIVISION.'),
        L('    OPEN INPUT ACCT-FILE OUTPUT OUT-FILE.'),
      ),
    );
    expect(f.ddFiles).toEqual([
      { fd: 'ACCT-FILE', ddName: 'ACCTFILE', mode: 'read' },
      { fd: 'OUT-FILE', ddName: 'REPORT', mode: 'write' },
    ]);
  });

  it('reads DB2 tables (not host variables) and SQL includes', () => {
    const f = extractCobol(
      program(
        L('    EXEC SQL INCLUDE SQLCA END-EXEC.'),
        L('    EXEC SQL INCLUDE DCLTRTYP END-EXEC.'),
        L('PROCEDURE DIVISION.'),
        L('    EXEC SQL SELECT TR_DESC INTO :WS-DESC'),
        L('      FROM CARDDEMO.TRANSACTION_TYPE WHERE TR_TYPE = :K END-EXEC.'),
        L('    EXEC SQL UPDATE CARDDEMO.TRANSACTION_TYPE'),
        L('      SET TR_DESC = :D END-EXEC.'),
      ),
    );
    expect([...f.copybooks.keys()]).toEqual(['DCLTRTYP']);
    expect(f.sql).toEqual([
      { table: 'CARDDEMO.TRANSACTION_TYPE', mode: 'read' },
      { table: 'CARDDEMO.TRANSACTION_TYPE', mode: 'write' },
    ]);
  });

  it('reads IMS segments and MQ queues', () => {
    const f = extractCobol(
      program(
        L('PROCEDURE DIVISION.'),
        L("    EXEC DLI GU USING PCB(1) SEGMENT('PAUTSUM0') INTO(X) END-EXEC."),
        L('    EXEC DLI ISRT USING PCB(1) SEGMENT(PAUTDTL1) FROM(Y) END-EXEC.'),
        L("    MOVE 'CARD.DEMO.REPLY' TO MQOD-OBJECTNAME OF MQM-OD."),
        L("    CALL 'MQPUT1' USING H."),
      ),
    );
    expect(f.segments).toEqual([
      { name: 'PAUTSUM0', mode: 'read' },
      { name: 'PAUTDTL1', mode: 'write' },
    ]);
    expect(f.queues).toEqual([{ ref: { literal: 'CARD.DEMO.REPLY' }, mode: 'write' }]);
  });
});

describe('expandCopybooks', () => {
  it('inlines members recursively and survives cycles', () => {
    const books: Record<string, string> = { A: L("01 X PIC X VALUE 'FROM-A'.") + '\n' + L('COPY B.'), B: L('COPY A.') };
    const out = expandCopybooks(program(L('COPY A.')), (n) => books[n]);
    expect(out).toContain("VALUE 'FROM-A'");
    expect(extractCobol(out).copybooks).toEqual(new Map([['A', 2], ['B', 1]]));
  });
});
