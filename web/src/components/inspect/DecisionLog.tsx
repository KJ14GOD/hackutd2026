import { motion } from 'motion/react'
import { selectDecisions, selectMismatches, useStore } from '@/store/useStore'

/** The decision log — every answer becomes a record + a test (the "docs that never existed"). */
export function DecisionLog() {
  const decisions = useStore(selectDecisions)
  const mismatches = useStore(selectMismatches)

  // open unmade-decisions with no decision yet → "could not decide" pending rows
  const openGroups = new Set(
    mismatches
      .filter((m) => m.classification === 'unmade-decision' && m.status !== 'test_generated')
      .map((m) => m.rootCauseGroup),
  )
  decisions.forEach((d) => openGroups.delete(d.groupId))

  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
            <th className="py-1.5 pr-2 font-medium">Question</th>
            <th className="py-1.5 pr-2 font-medium">Answer</th>
            <th className="py-1.5 pr-2 font-medium">Who</th>
            <th className="py-1.5 pr-2 font-medium">Test</th>
            <th className="py-1.5 pr-2 font-medium">Resolves</th>
            <th className="py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((d) => (
            <motion.tr
              key={d.id}
              initial={{ opacity: 0, backgroundColor: 'rgba(52,211,153,0.15)' }}
              animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }}
              transition={{ duration: 1 }}
              className="border-t border-[var(--color-border)] align-top"
            >
              <td className="max-w-[260px] py-2 pr-2 text-[var(--color-fg)]">{d.question}</td>
              <td className="py-2 pr-2">
                <span className="rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 font-mono text-[11px] uppercase text-[var(--color-fg-muted)]">
                  {d.answer}
                </span>
              </td>
              <td className="py-2 pr-2 font-mono text-[var(--color-accent)]">{d.answeredBy}</td>
              <td className="py-2 pr-2 font-mono text-[var(--color-fg-muted)]">{d.testId}</td>
              <td className="py-2 pr-2">
                <span className="font-mono text-[var(--color-good)]">{d.resolvedCount}</span>
                <span className="text-[var(--color-fg-dim)]"> mismatches</span>
              </td>
              <td className="py-2">
                <StatusChip accepted={!!d.testId} />
              </td>
            </motion.tr>
          ))}

          {[...openGroups].map((g) => (
            <tr key={g} className="border-t border-dashed border-[var(--color-border)] align-top">
              <td className="py-2 pr-2 italic text-[var(--color-fg-muted)]">
                Could not decide → ask the owner
              </td>
              <td className="py-2 pr-2 text-[var(--color-fg-dim)]">—</td>
              <td className="py-2 pr-2 font-mono text-[var(--color-warn)]">@owner</td>
              <td className="py-2 pr-2 text-[var(--color-fg-dim)]">—</td>
              <td className="py-2 pr-2 font-mono text-[var(--color-fg-dim)]">group {g}</td>
              <td className="py-2">
                <span className="rounded bg-[var(--color-warn)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-warn)]">
                  Proposed
                </span>
              </td>
            </tr>
          ))}

          {decisions.length === 0 && openGroups.size === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-[var(--color-fg-dim)]">
                No decisions yet — click “Simulate Slack Answer”.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function StatusChip({ accepted }: { accepted: boolean }) {
  return accepted ? (
    <span className="rounded bg-[var(--color-good)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-good)]">
      Accepted
    </span>
  ) : (
    <span className="rounded bg-[var(--color-warn)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-warn)]">
      Proposed
    </span>
  )
}
