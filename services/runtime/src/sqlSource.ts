// Prepares a DB2 program and its DCLGEN copybooks for the Open-COBOL-ESQL translator. Line count
// never changes (consumed lines become blank), so traces still point at the original lines.

const code = (l: string) => l.slice(0, 72);
const blank = '';

/** The program as the translator accepts it. */
export function sqlProgram(text: string): string {
  const lines = text.split(/\r?\n/).map(code);
  let inProcedure = false;
  for (let i = 0; i < lines.length; i++) {
    if (/\bPROCEDURE\s+DIVISION\b/i.test(lines[i].slice(6))) inProcedure = true;
    // DB2 ends the step's unit of work at STOP RUN; GOBACK lets our driver commit instead.
    lines[i] = lines[i].replace(/\bSTOP RUN\b/, 'GOBACK  ');
    // The translator only reads EXEC SQL INCLUDE written on one line, ending with a period.
    if (/^\s*EXEC\s+SQL\s*$/i.test(lines[i].slice(7)) && /^\s*INCLUDE\s+\S+\s*$/i.test(lines[i + 1]?.slice(7) ?? '') && /^\s*END-EXEC\.?\s*$/i.test(lines[i + 2]?.slice(7) ?? '')) {
      const name = lines[i + 1].trim().split(/\s+/)[1];
      lines[i] = `           EXEC SQL INCLUDE ${name} END-EXEC.`;
      lines[i + 1] = blank;
      lines[i + 2] = blank;
    } else if (!inProcedure && /^\s*EXEC\s+SQL\s+INCLUDE\s+\S+\s+END-EXEC\s*$/i.test(lines[i].slice(7))) {
      lines[i] = `${lines[i].trimEnd()}.`;
    }
  }
  return lines.join('\n') + '\n';
}

/** A DCLGEN copybook without its DECLARE TABLE block, which only documents the table for DB2. */
export function sqlCopybook(text: string): string {
  const lines = text.split(/\r?\n/).map(code);
  let skipping = false;
  return lines.map((l) => {
    if (/EXEC\s+SQL\s+DECLARE\s+\S+\s+TABLE/i.test(l)) skipping = true;
    const out = skipping ? blank : l;
    if (skipping && /END-EXEC/i.test(l)) skipping = false;
    return out;
  }).join('\n') + '\n';
}
