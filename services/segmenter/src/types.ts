// Shapes for Part 1 (static map). Extends docs/GRAPH_SCHEMA.md; see docs/SPEC_DEPENDENCY_PASSES.md §1.4.

export type System =
  | 'programs' | 'layouts' | 'files' | 'db' | 'ims' | 'mq' | 'cics-queue' | 'screen'
  | 'network' | 'identity' | 'time' | 'batch' | 'scheduler' | 'external';

export const SYSTEMS: System[] = [
  'programs', 'layouts', 'files', 'db', 'ims', 'mq', 'cics-queue', 'screen',
  'network', 'identity', 'time', 'batch', 'scheduler', 'external',
];

export type Confidence = 'extracted' | 'inferred' | 'unknown';

export interface Node {
  id: string;
  kind: string;
  file?: string;
  mode?: 'online' | 'batch';
  lines?: number;
}

/** `system` is our addition: which scanner produced the edge, so totals can be counted two ways. */
export interface Edge {
  from: string;
  to: string;
  rel: string;
  evidence: string;
  via?: string;
  confidence: Confidence;
  system: System;
}

export interface Unresolved {
  program: string;
  system: System;
  what: string;
  token: string;
  at: string;
  candidates?: string[];
}

export interface Touch {
  program: string;
  system: System;
  evidence: string;
}

export interface Pass1 {
  version: 1;
  commit: string;
  inventory: { programs: string[]; copybooks: string[]; jobs: string[]; unknown: string[] };
  missingInputs: string[];
  nodes: Node[];
  edges: Edge[];
  unresolved: Unresolved[];
  touches: Touch[];
}

/** A source line in the code area, uppercased, with its line number in the original file. */
export interface Line {
  no: number;
  text: string;
}

export interface NormalizedProgram {
  name: string;
  path: string;
  lines: Line[];
  /** All code lines joined with single spaces; `lineAt` maps an offset back to a file line. */
  joined: string;
  lineAt(offset: number): number;
  online: boolean;
  totalLines: number;
}

export interface JclStep {
  job: string;
  step: string;
  /** Program run by the step, after expanding procedures and utility wrappers (IKJEFT01, DFSRRC00). */
  program: string;
  utility: boolean;
  parm?: string;
  cond?: string;
  evidence: string;
  dds: JclDd[];
}

export interface JclDd {
  name: string;
  dsn?: string;
  /** Generation offset for generation datasets, e.g. "+1". */
  generation?: string;
  disp?: string;
  instream?: string[];
  sysout?: boolean;
  evidence: string;
}

export interface Lookups {
  /** Online file nickname -> dataset name (online config). */
  fileAlias: Map<string, string>;
  /** "PROGRAM|DDNAME" -> datasets the job steps give that label. */
  stepFiles: Map<string, { dsn: string; disp?: string; evidence: string }[]>;
  /** Transaction id -> program. */
  tranProgram: Map<string, { program: string; evidence: string }>;
  /** Transient-data queue -> transaction or dataset it feeds. */
  tdQueues: Map<string, { trigger?: string; dsn?: string; evidence: string }>;
  /** BMS map name -> number of named fields. */
  mapFields: Map<string, number>;
  /** PSB name -> IMS databases it can reach. */
  psbDatabases: Map<string, string[]>;
  /** Every DD name seen in any job, with the datasets it was bound to. */
  ddAnywhere: Map<string, Set<string>>;
  programs: Set<string>;
  copybooks: Map<string, string>;
  /** Assembler / C sources by member name: call targets with source outside COBOL. */
  externalSources: Map<string, string>;
  steps: JclStep[];
  jobTriggers: { from: string; to: string; evidence: string }[];
}
