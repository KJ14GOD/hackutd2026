import type { MismatchCategory, MismatchClassification } from '@/types'

export const LOW_CONFIDENCE = 0.7

export const CATEGORY_COLOR: Record<MismatchCategory, string> = {
  formatting: 'var(--color-cat-formatting)',
  rounding: 'var(--color-cat-rounding)',
  logic: 'var(--color-cat-logic)',
  noise: 'var(--color-cat-noise)',
}

/** The three triage buckets, in the order we show them. */
export const CLASSIFICATION_META: Record<
  MismatchClassification,
  { title: string; badge: string; hint: string; color: string }
> = {
  'unmade-decision': {
    title: 'Unmade decisions',
    badge: 'needs human · asked on Slack',
    hint: 'No answer exists anywhere — only these interrupt a person.',
    color: 'var(--color-warn)',
  },
  defect: {
    title: 'Defects',
    badge: 'agent auto-fixed',
    hint: 'Contradicts an agreed invariant — fixed silently, no one asked.',
    color: 'var(--color-good)',
  },
  noise: {
    title: 'Noise',
    badge: 'filtered',
    hint: 'Nondeterminism (timestamps, ids) — removed from the diff.',
    color: 'var(--color-noise)',
  },
}

export const CLASSIFICATION_ORDER: MismatchClassification[] = ['unmade-decision', 'defect', 'noise']

export const WIDGET_LABEL: Record<string, string> = {
  numberLine: 'number line',
  charDiff: 'char diff',
  branchTrace: 'branch trace',
  tableDiff: 'table diff',
}
