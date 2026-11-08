// The common shape every people source produces (docs/REQUIREMENTS_ANALYSIS.md §5.3), plus what the
// later steps add: identity matches, authority scores and the approver list.

export interface Person { id: string; emails: string[]; name: string; title?: string; team?: string; active: boolean; source: string }
export interface Team { id: string; name: string; parentTeamId?: string; source: string }
export interface ReportsTo { personId: string; managerId: string; source: string }

/** Which kind of evidence an ownership link is. Weights live in theseus.config.json, keyed by these names. */
export type Signal =
  | 'namedCodeOwner'      // CODEOWNERS names the person
  | 'teamCodeOwner'       // CODEOWNERS names their team (counted for the team's manager)
  | 'policyOwner'         // owns a policy or controls page about the scope
  | 'managerOfOwningTeam' // manages the team that owns the scope's code
  | 'commits'             // committed to the scope; decays with age
  | 'ticketReporter'      // reported a ticket about the scope
  | 'ticketAssignee'      // assigned a ticket about the scope
  | 'specAuthor'          // owns a spec, runbook or data dictionary page about the scope
  | 'chatParticipant';    // posted in a thread about the scope

export interface Owns {
  /** A source-local person key (email when known, else a name) until identity resolution maps it. */
  personId: string;
  /** A Part 1 node id, e.g. prog:CBACT04C. */
  target: string;
  kind: 'code' | 'rule' | 'data' | 'app' | 'job' | 'policy';
  signal: Signal;
  weight: number;
  source: string;
  evidence: string;
  observedAt: string;
}

export interface SourceResult { source: string; people: Person[]; teams: Team[]; reportsTo: ReportsTo[]; owns: Owns[]; live: boolean }

export type Category = 'business-rule' | 'behavior' | 'data' | 'style';

/** A possible same-person pair that shares no email: never merged automatically (§5.4). */
export interface IdentityMatch { a: string; b: string; reason: string; sources: string[] }

export interface Score { personId: string; target: string; category: Category; score: number; evidence: string[] }

export interface Approver { personId: string; name: string; target: string; category: Category; score: number; evidence: string[] }

/** An inactive owner's work, suggested to someone active; needs confirmation. */
export interface Successor { from: string; to: string; target: string; reason: string }

export interface Org {
  version: 1;
  generatedAt: string;
  sources: { source: string; live: boolean; people: number; owns: number }[];
  people: Person[];
  teams: Team[];
  reportsTo: ReportsTo[];
  owns: Owns[];
  identityMatches: IdentityMatch[];
  successors: Successor[];
  scores: Score[];
  approvers: Approver[];
}
