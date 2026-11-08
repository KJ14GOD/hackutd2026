// What Nemotron is given to write the Java, and the fix prompts. The contract is concrete because the Java is
// judged by running it: same inputs, same printed lines, same return code as the COBOL.
import type { ChatMessage } from '../../../packages/llm/src/index';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mismatch } from './types';

/** Tested helpers for zoned decimals and DISPLAY formatting (java/Cobol.java, checked by java/CobolTest.java). */
const HELPERS = readFileSync(join(import.meta.dirname, '../java/Cobol.java'), 'utf8');

export const SYSTEM = `You translate one legacy COBOL batch program into one self-contained Java 21 file.
The Java is run on the same inputs as the COBOL and its output is compared line by line, so match behavior exactly,
including odd behavior and bugs: do not fix or improve anything. Reply with the complete file in one \`\`\`java block and nothing else.`;

export interface PromptInput {
  program: string;
  source: string;
  copybooks: { name: string; text: string }[];
  /** "ACCOUNT-FILE (DD ACCTFILE, indexed): FD record ... = 300 bytes" lines, computed by code. */
  recordSizes: string[];
  /** File name -> DD and how the program opens it. */
  files: { file: string; dd: string; organization: string; mode: string }[];
  rules: string[];
  parm: string;
  sampleOutput: string[];
  sampleRc: number;
  externalCalls: string[];
  /** Owner decisions on earlier mismatches ("In <case>, keep the COBOL behavior"). */
  decisions: string[];
  /** The first records of each input file from the normal run, exactly as the Java will read them. */
  inputSamples: { dd: string; records: string[] }[];
}

const contract = (p: PromptInput) => `CONTRACT
- One file, public class Main with a main method, default package, JDK 21 only (no libraries, no frameworks).
- Every file the program uses has an environment variable DD_<DDNAME> holding a path. Input files are text, one record
  per line, fixed width exactly as the COBOL record layout; a short line means trailing spaces. Indexed files are the same
  text format: load them into a map keyed by the record key bytes and read, write and rewrite against that map. For files
  opened OUTPUT, EXTEND or I-O, write the records back to the same path, one record per line, at full record width.
- Print to System.out exactly what each COBOL DISPLAY prints, in the same order, one line each. DISPLAY of an alphanumeric or
  group item prints its raw characters. DISPLAY of an unsigned numeric DISPLAY item prints its digits; a signed one prints
  its digits followed by a trailing sign character (+ or -), like 000000019400+. Signed zoned numbers inside records use the
  mainframe overpunch in the last digit ({ABCDEFGHI for +0..+9, }JKLMNOPQR for -0..-9).
- PARM: the JCL PARM text is in env THESEUS_PARM ("${p.parm}" for the normal run). FUNCTION CURRENT-DATE returns env
  THESEUS_CURRENT_DATE exactly (21 characters, YYYYMMDDHHMMSSss+hhmm).
- RETURN-CODE becomes the exit code: System.exit(rc) at the end, 0 by default.
- External calls: ${p.externalCalls.length ? p.externalCalls.map((c) => (c === 'CEE3ABD' ? 'CEE3ABD (abend): print nothing and System.exit(16) immediately' : `${c}: does nothing and leaves its arguments unchanged`)).join('; ') : 'none'}.
- Use the provided helper class Cobol (below) for every numeric field: Cobol.field to slice a record, Cobol.zoned to read a
  zoned-decimal field, Cobol.toZoned to write one back, Cobol.display for what DISPLAY prints. Copy it into Main.java unchanged
  as a second, non-public top-level class. Never decode the sign overpunch yourself.
- File status codes: model them ('00' ok, '10' end of file, '23' record not found, '22' duplicate key, '35' file missing),
  because the program prints and branches on them.`;

export function writePrompt(p: PromptInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: [
      `PROGRAM ${p.program}`, '', contract(p), '',
      'FILES (how the program opens each one)', ...p.files.map((f) => `${f.file}: DD ${f.dd}, ${f.organization}, opened ${f.mode}`), '',
      'RECORD SIZES (computed from the PICTURE clauses)', ...p.recordSizes, '',
      'INPUT RECORDS (the first lines of each input file in the normal run, exactly as DD_<NAME> will hold them; | marks the line end)',
      ...p.inputSamples.flatMap((s) => [`DD ${s.dd}:`, ...s.records.map((r) => `${r}|  (${r.length} chars)`)]), '',
      'RULES ALREADY FOUND IN THIS PROGRAM', ...(p.rules.length ? p.rules.map((r) => `- ${r}`) : ['- none']), '',
      ...(p.decisions.length ? ['DECISIONS THE PROGRAM OWNER MADE (follow these exactly)', ...p.decisions.map((d) => `- ${d}`), ''] : []),
      `REAL OUTPUT OF THE NORMAL RUN (first ${p.sampleOutput.length} lines, exit code ${p.sampleRc}); your Java must print these identically`,
      ...p.sampleOutput, '',
      'HELPER CLASS (copy unchanged into Main.java)', HELPERS, '',
      'COPYBOOKS', ...p.copybooks.flatMap((c) => [`--- ${c.name}`, c.text]), '',
      `COBOL SOURCE ${p.program}`, p.source,
    ].join('\n') },
  ];
}

export function compileFixPrompt(p: PromptInput, java: string, javacOutput: string): ChatMessage[] {
  return [
    ...writePrompt(p),
    { role: 'assistant', content: '```java\n' + java + '\n```' },
    { role: 'user', content: `javac rejected the file:\n${javacOutput.slice(0, 6000)}\n\nFix every error and reply with the complete corrected file in one \`\`\`java block. Keep the behavior the same.` },
  ];
}

export function diffFixPrompt(p: PromptInput, java: string, mismatches: Mismatch[], crashes: { scenario: string; stderr: string }[] = []): ChatMessage[] {
  const shown = mismatches.slice(0, 25).map((m) => `[${m.scenario} line ${m.line}] COBOL: ${JSON.stringify(m.old)}  JAVA: ${JSON.stringify(m.new)}`);
  const crashed = crashes.slice(0, 2).map((c) => `The Java crashed in ${c.scenario}:\n${c.stderr.slice(0, 1500)}`);
  return [
    ...writePrompt(p),
    { role: 'assistant', content: '```java\n' + java + '\n```' },
    { role: 'user', content: `${crashed.length ? `${crashed.join('\n\n')}\n\n` : ''}The Java ran on the same inputs but printed different lines than the COBOL:\n${shown.join('\n')}\n\nCheck the record offsets against INPUT RECORDS and RECORD SIZES. Change the Java so it prints exactly what the COBOL prints, and reply with the complete file in one \`\`\`java block.` },
  ];
}

/** The Java file out of a reply (a ```java block, or the whole reply if there is none). */
export function extractJava(reply: string): string {
  const m = /```(?:java)?\s*\n([\s\S]*?)(?:```|$)/.exec(reply);
  return (m ? m[1] : reply).trim() + '\n';
}
