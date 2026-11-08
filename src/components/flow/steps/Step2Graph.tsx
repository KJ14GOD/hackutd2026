import GraphScreen from '@/components/graph/GraphScreen'
import { StepHeader, Rise } from '../chrome'

export default function Step2Graph() {
  return (
    <div className="flex h-full flex-col justify-center">
      <StepHeader n="02" eyebrow="Find where it's safe to cut" title="Map what calls what" />
      <Rise delay={0.1} className="min-h-0 flex-1">
        <div className="h-[min(62vh,620px)] overflow-hidden rounded-2xl border border-[var(--color-line)]">
          <GraphScreen />
        </div>
      </Rise>
      <Rise delay={0.2}>
        <p className="mt-4 max-w-[60ch] text-[14px] text-[var(--color-muted)]">
          The graph comes from static analysis and git history — never an LLM. We start with the most
          isolated component, where a rewrite is least likely to break something downstream. Select
          components to trace what a change would touch.
        </p>
      </Rise>
    </div>
  )
}
