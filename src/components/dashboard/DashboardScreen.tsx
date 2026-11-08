import { selectComponent, useStore } from '@/store/useStore'
import { Panel } from '@/components/ui/primitives'
import { MatchRateHero } from './MatchRateHero'
import { MatchChart } from './MatchChart'
import { MismatchBreakdown } from './MismatchBreakdown'
import { CutoverControl } from './CutoverControl'

/** The hero shadow-diff dashboard. */
export default function DashboardScreen() {
  const component = useStore(selectComponent)

  return (
    <div className="grid h-full grid-cols-3 grid-rows-[auto_1fr] gap-4 p-4">
      {/* hero number spans two cols */}
      <div className="col-span-2 h-52">
        <MatchRateHero />
      </div>

      {/* cutover + why-picked */}
      <Panel title="Cutover" className="row-span-1">
        <div className="flex h-full flex-col justify-between gap-4">
          <CutoverControl />
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5 text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
            <span className="font-medium text-[var(--color-fg)]">Why {component.id}: </span>
            {component.whyPicked}
          </div>
        </div>
      </Panel>

      {/* chart spans two cols */}
      <Panel title="Match % over time" className="col-span-2">
        <div className="h-full min-h-[220px]">
          <MatchChart />
        </div>
      </Panel>

      {/* breakdown */}
      <Panel title="Mismatches">
        <MismatchBreakdown />
      </Panel>
    </div>
  )
}
