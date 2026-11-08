// Shapes for Phase 4 (docs/REQUIREMENTS_ANALYSIS.md §17 Phase 4): documents gathered from the company's
// tools, search hits, and what each Part 2 question resolves to.

/** One searchable document: a Jira ticket with its comments, a Notion page, or a Slack thread. */
export interface Doc {
  id: string;
  source: 'jira' | 'notion' | 'slack';
  url: string;
  title: string;
  /** Sentences, so a quote can be checked to come from the document word for word. */
  sentences: string[];
  author: string;
  date: string;
  /** Program ids (prog:X) the document mentions. */
  programs: string[];
}

export interface Hit { doc: Doc; score: number; why: string }

export type Verdict = 'answered' | 'conflict' | 'known-issue' | 'not-found';

/** A sentence quoted from a document, checked to exist there. */
export interface Quote { docId: string; source: Doc['source']; url: string; title: string; text: string; date: string }

export interface Resolution {
  questionId: string;
  program: string;
  question: string;
  verdict: Verdict;
  /** What the documents say, in one or two sentences (empty when not found). */
  answer: string;
  quotes: Quote[];
  confidence: 'high' | 'medium' | 'low';
  /** Who to ask (not-found, conflict) or who confirms (low-confidence answers). */
  route?: { to: string; name: string; category: string; why: string };
  /** Documents searched, best first, for the audit trail. */
  searched: { docId: string; score: number }[];
  /** Why a verdict was downgraded (a quote that isn't in its document). */
  note?: string;
}

export interface ContextRun { version: 1; generatedAt: string; model: string; docs: number; resolutions: Resolution[] }
