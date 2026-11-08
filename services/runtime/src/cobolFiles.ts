// Reads a program's own file definitions (SELECT + FD) so the sandbox can build data files whose
// keys and record layouts match the program exactly, and generates a loader for each input file.
import { normalizeLines } from '../../segmenter/src/inventory';

export interface FileDef {
  /** COBOL file name, e.g. TCATBAL-FILE. */
  file: string;
  /** The DD name it is assigned to, e.g. TCATBALF. */
  dd: string;
  organization: 'indexed' | 'sequential' | 'line-sequential' | 'relative';
  /** The SELECT clause as written (without FILE STATUS), for reuse in a loader. */
  select: string;
  /** The FD entry with its record description, as written. */
  fd: string;
  /** The first 01 record under the FD. */
  record: string;
  isSort: boolean;
}

/** Source lines in the code area (columns 8-72), comments dropped, kept in order. */
function codeLines(text: string): string[] {
  return normalizeLines(text).map((l) => l.text.trimEnd());
}

export function fileDefs(programText: string): FileDef[] {
  const lines = codeLines(programText);
  const joined = lines.join('\n');
  const selects = [...joined.matchAll(/\bSELECT\s+(?:OPTIONAL\s+)?([A-Z0-9-]+)\s+ASSIGN\s+(?:TO\s+)?['"]?([A-Z0-9#@$-]+)['"]?([\s\S]*?)\./g)];
  const fileSection = /\bFILE\s+SECTION\.([\s\S]*?)(?=\b(?:WORKING-STORAGE|LOCAL-STORAGE|LINKAGE)\s+SECTION\.|\bPROCEDURE\s+DIVISION)/.exec(joined)?.[1] ?? '';
  const fdBlocks = new Map<string, { text: string; sort: boolean }>();
  for (const m of fileSection.matchAll(/\b(FD|SD)\s+([A-Z0-9-]+)([\s\S]*?)(?=\b(?:FD|SD)\s+[A-Z0-9-]+|$)/g)) {
    fdBlocks.set(m[2], { text: `${m[1]} ${m[2]}${m[3]}`.trim(), sort: m[1] === 'SD' });
  }
  return selects.map((m) => {
    const [, file, assign, rest] = m;
    const org = /ORGANIZATION\s+(?:IS\s+)?(LINE\s+SEQUENTIAL|INDEXED|RELATIVE|SEQUENTIAL)/.exec(rest)?.[1] ?? 'SEQUENTIAL';
    const fd = fdBlocks.get(file);
    return {
      file,
      dd: assign.split('-').pop() ?? assign,
      organization: org.startsWith('LINE') ? 'line-sequential' : (org.toLowerCase() as FileDef['organization']),
      select: `SELECT ${file} ASSIGN TO ${assign}${rest.replace(/\bFILE\s+STATUS\s+(?:IS\s+)?[A-Z0-9-]+/g, '').replace(/\s+/g, ' ')}.`,
      fd: fd?.text ?? '',
      record: /\b01\s+([A-Z0-9-]+)/.exec(fd?.text ?? '')?.[1] ?? '',
      isSort: fd?.sort ?? false,
    };
  });
}

/** Wraps free text into fixed-format COBOL lines (code area columns 8-72). */
function fixed(text: string): string {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    while (line.length > 64) {
      const cut = line.lastIndexOf(' ', 64);
      out.push('       ' + line.slice(0, cut > 0 ? cut : 64));
      line = '    ' + line.slice(cut > 0 ? cut + 1 : 64);
    }
    out.push('       ' + line);
  }
  return out.join('\n') + '\n';
}

/**
 * A loader that reads a text file (one record per line, as CardDemo ships its sample data)
 * and writes the program's file with the program's own record layout and keys.
 */
export function loaderSource(def: FileDef, programId: string): string {
  // Indexed files load by key in any order; sequential ones are written front to back.
  const indexed = def.organization === 'indexed';
  const select = indexed ? def.select.replace(/ACCESS\s+MODE\s+(?:IS\s+)?(SEQUENTIAL|RANDOM|DYNAMIC)/, 'ACCESS MODE IS RANDOM') : def.select;
  return fixed([
    'IDENTIFICATION DIVISION.',
    `PROGRAM-ID. ${programId}.`,
    'ENVIRONMENT DIVISION.',
    'INPUT-OUTPUT SECTION.',
    'FILE-CONTROL.',
    'SELECT LOAD-IN ASSIGN TO LOADIN ORGANIZATION IS LINE SEQUENTIAL.',
    select,
    'DATA DIVISION.',
    'FILE SECTION.',
    'FD LOAD-IN.',
    '01 LOAD-IN-REC PIC X(2000).',
    def.fd,
    'WORKING-STORAGE SECTION.',
    "01 WS-EOF PIC X VALUE 'N'.",
    '01 WS-LOADED PIC 9(9) VALUE 0.',
    '01 WS-DUPS PIC 9(9) VALUE 0.',
    'PROCEDURE DIVISION.',
    `OPEN INPUT LOAD-IN OUTPUT ${def.file}.`,
    "PERFORM UNTIL WS-EOF = 'Y'",
    "READ LOAD-IN AT END MOVE 'Y' TO WS-EOF",
    'NOT AT END',
    `MOVE LOAD-IN-REC TO ${def.record}`,
    ...(indexed
      ? [`WRITE ${def.record}`, 'INVALID KEY ADD 1 TO WS-DUPS', 'NOT INVALID KEY ADD 1 TO WS-LOADED', 'END-WRITE']
      : [`WRITE ${def.record}`, 'ADD 1 TO WS-LOADED']),
    'END-READ',
    'END-PERFORM.',
    `CLOSE LOAD-IN ${def.file}.`,
    `DISPLAY 'THESEUS-LOAD ${def.dd} ' WS-LOADED ' ' WS-DUPS.`,
    'STOP RUN.',
  ].join('\n'));
}

/** How the program opens each file (INPUT, OUTPUT, I-O, EXTEND), from its OPEN statements. */
export function openModes(programText: string): Map<string, string> {
  const joined = normalizeLines(programText).map((l) => l.text).join(' ');
  const modes = new Map<string, string>();
  for (const m of joined.matchAll(/\bOPEN\s+((?:(?:INPUT|OUTPUT|I-O|EXTEND)\s+(?:[A-Z0-9-]+\s*)+)+)/g)) {
    let mode = '';
    for (const word of m[1].split(/\s+/)) {
      if (['INPUT', 'OUTPUT', 'I-O', 'EXTEND'].includes(word)) mode = word;
      else if (word && mode && !modes.has(word)) modes.set(word, mode);
    }
  }
  return modes;
}
