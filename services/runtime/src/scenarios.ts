// Stress scenarios built from each program's own code: its record layout, the values its IF and
// EVALUATE statements test, its money fields, and the files it looks things up in. Each scenario
// is the full set of input files to load, so the run is reproducible.
import { blankRecord, setField, zoned, type Field } from './layout';

export interface Scenario {
  name: string;
  label: string;
  /** What this scenario changes compared with a normal run. */
  setup: string;
  /** DD name -> file text (one record per line) for every input the program reads. */
  files: Record<string, string>;
}

export interface ScenarioInputs {
  /** The input the program reads front to back; most scenarios change this one. */
  driving?: { dd: string; text: string; sequential: boolean; fields: Field[]; tested: Map<string, string[]>; synthesized: boolean };
  /** Every input other than the driving one, by DD name. */
  others: { dd: string; text: string; lookup: boolean }[];
}

const lines = (text: string) => text.split('\n').filter((l) => l.trim() !== '');
const join = (rows: string[]) => (rows.length ? `${rows.join('\n')}\n` : '');
/** A value no IF or WHEN in the program expects. */
const UNEXPECTED = '#';

/** Records built from the values the code tests, plus one it doesn't expect. Used when no sample exists. */
export function synthesize(fields: Field[], tested: Map<string, string[]>): string {
  const base = blankRecord(fields);
  const rows: string[] = [];
  for (const [name, values] of tested) {
    const f = fields.find((x) => x.name === name)!;
    for (const v of values) rows.push(setField(base, f, v));
  }
  return join(rows.length ? rows : [base]);
}

export function buildScenarios(inp: ScenarioInputs): Scenario[] {
  const d = inp.driving;
  const files = (driving?: string, override: Record<string, string> = {}) => {
    const out: Record<string, string> = {};
    for (const o of inp.others) out[o.dd] = o.text;
    if (d) out[d.dd] = driving ?? d.text;
    return { ...out, ...override };
  };
  const list: Scenario[] = [{ name: 'normal', label: 'Normal run', setup: d?.synthesized ? 'No sample input exists, so Theseus built one record for each value the code tests' : 'Sample data as shipped', files: files() }];
  if (!d) return list;
  const rows = lines(d.text);
  const first = rows[0] ?? blankRecord(d.fields);

  list.push({ name: 'empty', label: 'Empty input', setup: `${d.dd} has no records`, files: files('') });

  // Branches: every value an IF or WHEN tests on the input record, plus one nobody handles.
  if (d.tested.size) {
    const out: string[] = [];
    const parts: string[] = [];
    for (const [name, values] of d.tested) {
      const f = d.fields.find((x) => x.name === name)!;
      for (const v of [...values, UNEXPECTED]) out.push(setField(first, f, v));
      parts.push(`${name} = ${values.map((v) => `'${v}'`).join(', ')}`);
    }
    list.push({ name: 'branches', label: 'Every branch', setup: `Records with ${parts.join('; ')}, then a value the code doesn't expect`, files: files(join(out)) });
  }

  // Money: numeric fields with decimals, set to zero, a negative amount, and the largest the field holds.
  const money = d.fields.filter((f) => f.kind === 'num' && f.scale > 0);
  if (money.length && rows.length) {
    const apply = (value: (f: Field) => number) => join(rows.map((r) => money.reduce((rec, f) => setField(rec, f, zoned(f, value(f))), r)));
    const names = money.map((f) => f.name).join(', ');
    list.push({ name: 'money-zero', label: 'Zero amounts', setup: `${names} set to 0`, files: files(apply(() => 0)) });
    if (money.some((f) => f.signed)) list.push({ name: 'money-negative', label: 'Negative amounts', setup: `${names} set to -125.50`, files: files(apply((f) => (f.signed ? -125.5 : 125.5))) });
    list.push({ name: 'money-max', label: 'Largest amounts', setup: `${names} set to the largest value each field holds`, files: files(apply((f) => (10 ** (f.digits - f.scale)) - 10 ** -f.scale)) });
  }

  // Lookups that miss: each file the program looks records up in, emptied.
  for (const o of inp.others.filter((x) => x.lookup)) {
    list.push({ name: `no-match-${o.dd.toLowerCase()}`, label: `No match in ${o.dd}`, setup: `${o.dd} is empty, so every lookup in it fails`, files: files(undefined, { [o.dd]: '' }) });
  }

  if (d.sequential && rows.length > 1) {
    list.push({ name: 'duplicates', label: 'Duplicate records', setup: `Every ${d.dd} record appears twice`, files: files(join(rows.flatMap((r) => [r, r]))) });
    list.push({ name: 'out-of-order', label: 'Out of order', setup: `${d.dd} records in reverse order`, files: files(join([...rows].reverse())) });
  }

  if (rows.length) {
    const orphan = first.replace(/\d+/, (n) => '9'.repeat(n.length));
    const garbled = first.slice(0, 11) + first.slice(11).replace(/\d/g, 'X');
    list.push({ name: 'bad-records', label: 'Bad records', setup: 'Adds a record whose key matches nothing and one with letters in number fields', files: files(join([...rows, orphan, garbled])) });
  }
  return list;
}

/** Reads a date out of a JCL PARM like '2022071800' or '2022-07-18'; falls back to a fixed day. */
export function dateFromParm(parm = ''): string {
  const m = /(\d{4})-?(\d{2})-?(\d{2})/.exec(parm);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31) return `${m[1]}/${m[2]}/${m[3]}`;
  return '2022/07/18';
}
