import type { Mismatch } from '@/types'

/** Jev-selected evidence widget. One lightweight visual per widget kind. */
export function EvidenceWidget({ mismatch }: { mismatch: Mismatch }) {
  switch (mismatch.evidenceWidget) {
    case 'numberLine':
      return <NumberLine mismatch={mismatch} />
    case 'charDiff':
      return <CharDiff mismatch={mismatch} />
    case 'branchTrace':
      return <BranchTrace mismatch={mismatch} />
    default:
      return <TableDiff mismatch={mismatch} />
  }
}

function firstNumeric(obj: Record<string, unknown>): number | null {
  for (const v of Object.values(obj)) if (typeof v === 'number') return v
  return null
}
function firstString(obj: Record<string, unknown>): string | null {
  for (const v of Object.values(obj)) if (typeof v === 'string') return v
  return null
}

/** rounding → two points on a line */
function NumberLine({ mismatch }: { mismatch: Mismatch }) {
  const o = firstNumeric(mismatch.oldOut)
  const n = firstNumeric(mismatch.newOut)
  if (o == null || n == null) return <TableDiff mismatch={mismatch} />
  const lo = Math.min(o, n)
  const hi = Math.max(o, n)
  const span = hi - lo || 1
  const pos = (v: number) => 12 + ((v - lo) / span) * 76
  return (
    <div className="py-3">
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-5 h-px bg-[var(--color-border-strong)]" />
        <Marker left={pos(o)} value={o} label="old" color="var(--color-accent)" />
        <Marker left={pos(n)} value={n} label="new" color="var(--color-good)" />
      </div>
      <div className="mt-1 text-center font-mono text-[11px] text-[var(--color-fg-dim)]">
        Δ {Math.abs(o - n).toPrecision(2)}
      </div>
    </div>
  )
}
function Marker({ left, value, label, color }: { left: number; value: number; label: string; color: string }) {
  return (
    <div className="absolute -translate-x-1/2 text-center" style={{ left: `${left}%`, top: 0 }}>
      <div className="font-mono text-[11px]" style={{ color }}>
        {value}
      </div>
      <div className="mx-auto mt-1 size-2 rounded-full" style={{ background: color }} />
      <div className="mt-0.5 text-[9px] text-[var(--color-fg-dim)]">{label}</div>
    </div>
  )
}

/** formatting → char-level string compare */
function CharDiff({ mismatch }: { mismatch: Mismatch }) {
  const o = firstString(mismatch.oldOut) ?? JSON.stringify(firstNumeric(mismatch.oldOut))
  const n = firstString(mismatch.newOut) ?? JSON.stringify(firstNumeric(mismatch.newOut))
  return (
    <div className="space-y-1.5 py-2">
      <CharRow label="old" text={o} other={n} color="var(--color-accent)" />
      <CharRow label="new" text={n} other={o} color="var(--color-good)" />
    </div>
  )
}
function CharRow({ label, text, other, color }: { label: string; text: string; other: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 text-[10px] text-[var(--color-fg-dim)]">{label}</span>
      <div className="font-mono text-[13px]">
        {text.split('').map((ch, i) => (
          <span
            key={i}
            className="rounded-sm px-px"
            style={other[i] !== ch ? { background: `${color}`, color: '#06281d', opacity: 0.95 } : undefined}
          >
            {ch}
          </span>
        ))}
      </div>
    </div>
  )
}

/** logic → which branch each version took */
function BranchTrace({ mismatch }: { mismatch: Mismatch }) {
  return (
    <div className="grid grid-cols-2 gap-2 py-2">
      <BranchCard label="old path" out={mismatch.oldOut} color="var(--color-accent)" />
      <BranchCard label="new path" out={mismatch.newOut} color="var(--color-good)" />
    </div>
  )
}
function BranchCard({ label, out, color }: { label: string; out: Record<string, unknown>; color: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide" style={{ color }}>
        {label}
      </div>
      <div className="font-mono text-[11px] text-[var(--color-fg)]">
        {Object.entries(out).map(([k, v]) => (
          <div key={k}>
            {k}: {String(v)}
          </div>
        ))}
      </div>
    </div>
  )
}

/** fallback → field-by-field table */
function TableDiff({ mismatch }: { mismatch: Mismatch }) {
  const keys = Array.from(new Set([...Object.keys(mismatch.oldOut), ...Object.keys(mismatch.newOut)]))
  return (
    <table className="w-full py-2 font-mono text-[11px]">
      <tbody>
        {keys.map((k) => {
          const o = mismatch.oldOut[k]
          const n = mismatch.newOut[k]
          const diff = JSON.stringify(o) !== JSON.stringify(n)
          return (
            <tr key={k} className={diff ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-dim)]'}>
              <td className="py-0.5 pr-2 text-[var(--color-fg-muted)]">{k}</td>
              <td className="py-0.5 pr-2" style={{ color: diff ? 'var(--color-accent)' : undefined }}>
                {String(o ?? '—')}
              </td>
              <td className="py-0.5" style={{ color: diff ? 'var(--color-good)' : undefined }}>
                {String(n ?? '—')}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
