import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { selectHistory, selectThreshold, useStore } from '@/store/useStore'

/** Live match-% over time. Steps up each time an answer lands. */
export function MatchChart() {
  const history = useStore(selectHistory)
  const threshold = useStore(selectThreshold)

  const data = history.map((p, i) => ({ i, pct: +(p.rate * 100).toFixed(2), label: p.label }))
  const min = Math.max(0, Math.min(...data.map((d) => d.pct)) - 6)

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
          <defs>
            <linearGradient id="matchLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--color-accent)" />
              <stop offset="100%" stopColor="var(--color-good)" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="i" hide />
          <YAxis
            domain={[min, 100]}
            tick={{ fill: 'var(--color-fg-dim)', fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <ReferenceLine
            y={threshold * 100}
            stroke="var(--color-good)"
            strokeDasharray="4 4"
            label={{
              value: `cutover ${(threshold * 100).toFixed(0)}%`,
              fill: 'var(--color-good)',
              fontSize: 10,
              position: 'insideTopRight',
            }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--color-fg)',
            }}
            labelFormatter={() => ''}
            formatter={((v: unknown, _n: unknown, p: { payload?: { label?: string } }) => [
              `${v}%`,
              p?.payload?.label ?? '',
            ]) as never}
          />
          <Line
            type="monotone"
            dataKey="pct"
            stroke="url(#matchLine)"
            strokeWidth={2.5}
            dot={{ r: 2.5, fill: 'var(--color-good)' }}
            activeDot={{ r: 5 }}
            isAnimationActive
            animationDuration={600}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
