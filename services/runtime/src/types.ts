// Shapes for the Runtime witness (docs/SPEC_DEPENDENCY_PASSES.md §2): what each run did, and how
// that compares with Part 1's static map.

export type Mark = 'confirmed' | 'never-fired' | 'added';

export interface ScenarioResult {
  name: string;
  label: string;
  /** What this scenario changes compared with a normal run. */
  setup: string;
  returnCode: number;
  /** Return code 4 is the mainframe's "finished with warnings"; abend, error and timeout mean it stopped early. */
  outcome: 'ok' | 'warning' | 'abend' | 'error' | 'timeout';
  ms: number;
  /** What the program printed, minus our own markers. First lines only. */
  messages: string[];
  paragraphsRun: string[];
  /** Paragraphs this scenario reached that the normal run didn't. */
  newParagraphs: string[];
  statementsRun: number;
  /** For DB2 programs: table rows added (+) and removed (-) by the run. */
  dbChanges?: string[];
}

export interface ProgramRun {
  program: string;
  file: string;
  status: 'ran' | 'skipped' | 'failed';
  /** Why it was skipped or failed. */
  reason?: string;
  job?: string;
  parm?: string;
  scenarios: ScenarioResult[];
  paragraphs: { total: string[]; neverRan: string[] };
  /** Inputs the job names that have no sample data, so the run starts without them. */
  missingData: string[];
  /** Inputs Theseus built from the record layout because no sample exists. */
  synthesized: string[];
  /** DB2 tables recreated in the sandbox's PostgreSQL, when the program uses SQL. */
  tables?: string[];
}

export interface EdgeMark {
  from: string;
  to: string;
  rel: string;
  evidence: string;
  mark: Mark;
  /** Scenarios where the evidence line ran (confirmed) or where the run did it (added). */
  scenarios: string[];
}

export interface Runtime {
  version: 1;
  image: string;
  programs: ProgramRun[];
  edges: EdgeMark[];
  summary: { ran: number; skipped: number; failed: number; confirmed: number; neverFired: number; added: number };
}

export type RuntimeEvent =
  | { type: 'stage'; message: string }
  /** One line of sandbox output: the image build, compiles, and each scenario as it runs. */
  | { type: 'log'; program?: string; line: string }
  | { type: 'program'; program: string; status: 'running' | 'ran' | 'skipped' | 'failed'; reason?: string }
  | { type: 'scenario'; program: string; scenario: ScenarioResult }
  | { type: 'done'; runtime: Runtime }
  | { type: 'error'; message: string };
