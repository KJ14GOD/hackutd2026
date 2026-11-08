// CICS System Definition (CSD) reader: transactions -> programs and files -> datasets. Pure.

export interface CsdFacts {
  transactions: { id: string; program: string; description: string }[];
  files: Map<string, string>; // CICS file name -> DSNAME
}

/** Splits `KEY(VALUE)` pairs, allowing nested parentheses and spaces inside values. */
export function attributes(def: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([A-Z][A-Z0-9]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(def))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < def.length && depth > 0; i++) {
      if (def[i] === '(') depth++;
      else if (def[i] === ')') depth--;
    }
    if (!out.has(m[1])) out.set(m[1], def.slice(re.lastIndex, i - 1).trim());
    re.lastIndex = i;
  }
  return out;
}

export function parseCsd(texts: string[]): CsdFacts {
  const facts: CsdFacts = { transactions: [], files: new Map() };
  for (const text of texts) {
    const body = text.replace(/\r\n?/g, '\n').toUpperCase();
    for (const chunk of body.split(/\bDEFINE\s+/).slice(1)) {
      const kind = chunk.match(/^(\w+)\s*\(/)?.[1];
      const attrs = attributes(chunk.replace(/\s+/g, ' '));
      const name = kind ? attrs.get(kind) : undefined;
      if (!kind || !name) continue;
      if (kind === 'TRANSACTION' && attrs.get('PROGRAM')) {
        facts.transactions.push({ id: name, program: attrs.get('PROGRAM')!, description: attrs.get('DESCRIPTION') ?? '' });
      } else if (kind === 'FILE' && attrs.get('DSNAME')) {
        facts.files.set(name, attrs.get('DSNAME')!);
      }
    }
  }
  const seen = new Set<string>();
  facts.transactions = facts.transactions
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .sort((a, b) => a.id.localeCompare(b.id));
  return facts;
}
