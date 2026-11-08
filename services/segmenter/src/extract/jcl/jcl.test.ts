import { describe, expect, it } from 'vitest';
import { parseCsd } from './csd';
import { canonicalDataset, keywords, parseJcl, substitute } from './jcl';
import { parsePsb } from './psb';

const jcl = (...lines: string[]) => lines.join('\n');

describe('parseJcl', () => {
  it('reads steps, DDs, generations and write dispositions; skips load libraries', () => {
    const { jobs } = parseJcl(
      [
        {
          path: 'j.jcl',
          text: jcl(
            '//INTCALC JOB (ACCT),CLASS=A',
            '//STEP15 EXEC PGM=CBACT04C',
            '//STEPLIB  DD DISP=SHR,DSN=AWS.LOADLIB',
            '//ACCTFILE DD DISP=SHR,',
            '//         DSN=AWS.ACCTDATA.VSAM.KSDS',
            '//TRANSACT DD DISP=(NEW,CATLG,DELETE),',
            '//         DSN=AWS.SYSTRAN(+1)',
            '//TEMP     DD DSN=&&TEMP,DISP=(NEW,PASS)',
          ),
        },
      ],
      new Map(),
    );
    expect(jobs).toHaveLength(1);
    const step = jobs[0].steps[0];
    expect(step.program).toBe('CBACT04C');
    expect(Object.fromEntries(step.dds)).toEqual({ ACCTFILE: ['AWS.ACCTDATA.VSAM.KSDS'], TRANSACT: ['AWS.SYSTRAN'] });
    expect([...step.ddWrites]).toEqual(['TRANSACT']);
  });

  it('turns IDCAMS DEFINE AIX/PATH into aliases of the base cluster', () => {
    const { aliases } = parseJcl(
      [
        {
          path: 'x.jcl',
          text: jcl(
            '//XREF JOB',
            '//STEP1 EXEC PGM=IDCAMS',
            '//SYSIN DD *',
            '   DEFINE ALTERNATEINDEX (NAME(AWS.XREF.AIX)-',
            '   RELATE(AWS.XREF.KSDS)                    -',
            '   KEYS(11 25))',
            '  DEFINE PATH                               -',
            '   (NAME(AWS.XREF.AIX.PATH)                 -',
            '    PATHENTRY(AWS.XREF.AIX))',
            '/*',
          ),
        },
      ],
      new Map(),
    );
    expect(canonicalDataset('AWS.XREF.AIX.PATH', aliases)).toBe('AWS.XREF.KSDS');
  });

  it('expands procs with symbol overrides and procstep DD overrides', () => {
    const procs = new Map([
      [
        'REPROC',
        jcl(
          '//REPROC PROC',
          '//PRC001 EXEC PGM=IDCAMS',
          '//FILEIN  DD DISP=SHR,DSN=NULLFILE',
          '//FILEOUT DD DISP=SHR,DSN=NULLFILE',
          '//SYSIN   DD DISP=SHR,DSN=&CNTLLIB(REPROCT)',
          '// PEND',
        ),
      ],
    ]);
    const { jobs } = parseJcl(
      [
        {
          path: 'b.jcl',
          text: jcl(
            '//TRANBKP JOB',
            '//   SET HLQ=AWS.M2',
            '//STEP05R EXEC PROC=REPROC,',
            '// CNTLLIB=AWS.CNTL',
            '//PRC001.FILEIN  DD DISP=SHR,DSN=&HLQ..TRANSACT.KSDS',
            '//PRC001.FILEOUT DD DISP=(NEW,CATLG),DSN=&HLQ..TRANSACT.BKUP(+1)',
          ),
        },
      ],
      procs,
    );
    const step = jobs[0].steps[0];
    expect(step.name).toBe('PRC001');
    expect(Object.fromEntries(step.dds)).toEqual({
      FILEIN: ['AWS.M2.TRANSACT.KSDS'],
      FILEOUT: ['AWS.M2.TRANSACT.BKUP'],
      SYSIN: ['AWS.CNTL'],
    });
    expect([...step.ddWrites]).toEqual(['FILEOUT']);
  });

  it('sees the real program behind IMS and DB2 batch wrappers', () => {
    const { jobs } = parseJcl(
      [
        {
          path: 'i.jcl',
          text: jcl(
            '//IMSJOB JOB',
            '//STEP01  EXEC PGM=DFSRRC00,',
            "//             PARM='BMP,PAUDBLOD,PSBPAUTB'",
            '//DB2STEP EXEC PGM=IKJEFT01',
            '//SYSTSIN DD *',
            '  DSN SYSTEM(DAZ1)',
            '  RUN PROGRAM(COBTUPDT) PLAN(CARDDEMO)',
            '/*',
          ),
        },
      ],
      new Map(),
    );
    expect(jobs[0].steps.map((s) => [s.program, s.psb])).toEqual([
      ['PAUDBLOD', 'PSBPAUTB'],
      ['COBTUPDT', ''],
    ]);
  });
});

describe('jcl helpers', () => {
  it('parses keywords and substitutes symbols', () => {
    expect(keywords("PROC=REPROC,CNTLLIB=A.B,PARM='X,Y',COND=(0,NE)")).toEqual([
      ['PROC', 'REPROC'],
      ['CNTLLIB', 'A.B'],
      ['PARM', 'X,Y'],
      ['COND', '(0,NE)'],
    ]);
    expect(substitute('&HLQ..FILE.&X', new Map([['HLQ', 'A.B']]))).toBe('A.B.FILE.&X');
  });
});

describe('parseCsd', () => {
  it('reads transactions and files', () => {
    const csd = parseCsd([
      [
        'DEFINE TRANSACTION(CAUP) GROUP(CARDDEMO) PROGRAM(COACTUPC)',
        '       DESCRIPTION(CREDIT CARD DEMO ACCOUNT UPDATE)',
        'DEFINE FILE(ACCTDAT) GROUP(CARDDEMO) DSNAME(AWS.ACCTDATA.VSAM.KSDS)',
        'DEFINE TRANSACTION(CAUP) GROUP(OTHER) PROGRAM(DUP)',
      ].join('\n'),
    ]);
    expect(csd.transactions).toEqual([{ id: 'CAUP', program: 'COACTUPC', description: 'CREDIT CARD DEMO ACCOUNT UPDATE' }]);
    expect(Object.fromEntries(csd.files)).toEqual({ ACCTDAT: 'AWS.ACCTDATA.VSAM.KSDS' });
  });
});

describe('parsePsb', () => {
  it('reads sensitive segments and GSAM PCBs with update intent', () => {
    const { name, facts } = parsePsb(
      [
        'PAUTBPCB PCB   TYPE=DB,DBDNAME=DBPAUTP0,PROCOPT=GOTP,KEYLEN=14',
        '         SENSEG  NAME=PAUTSUM0,PARENT=0',
        '         PCB   TYPE=GSAM,DBDNAME=PASFLDBD,PROCOPT=LS',
        '         PSBGEN  LANG=COBOL,PSBNAME=DLIGSAMP,CMPAT=NO',
      ].join('\n'),
      'FILE',
    );
    expect(name).toBe('DLIGSAMP');
    expect(facts).toEqual({ segments: [{ name: 'PAUTSUM0', write: false }], gsam: [{ dbd: 'PASFLDBD', write: true }] });
  });
});
