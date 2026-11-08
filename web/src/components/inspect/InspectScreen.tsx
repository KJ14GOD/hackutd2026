import { useEffect, useMemo, useState } from 'react'
import type { Mismatch } from '@/types'
import { selectMismatches, useStore } from '@/store/useStore'
import { Panel } from '@/components/ui/primitives'
import { MismatchList } from './MismatchList'
import { MismatchDetail } from './MismatchDetail'
import { DecisionLog } from './DecisionLog'
import { AgentPanels } from './AgentPanels'

export default function InspectScreen() {
  const mismatches = useStore(selectMismatches)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // default selection = first unmade-decision
  const defaultId = useMemo(
    () =>
      mismatches.find((m) => m.classification === 'unmade-decision')?.id ?? mismatches[0]?.id ?? null,
    [mismatches],
  )
  useEffect(() => {
    if (!selectedId || !mismatches.some((m) => m.id === selectedId)) setSelectedId(defaultId)
  }, [defaultId, selectedId, mismatches])

  const selected = mismatches.find((m) => m.id === selectedId) ?? null

  return (
    <div className="grid h-full grid-cols-[260px_1fr_340px] grid-rows-2 gap-4 p-4">
      {/* left: list spans both rows */}
      <Panel title="Mismatches" className="row-span-2" bodyClassName="p-3 overflow-hidden flex flex-col">
        <MismatchList selectedId={selectedId} onSelect={(m: Mismatch) => setSelectedId(m.id)} />
      </Panel>

      {/* center top: detail */}
      <Panel title="Mismatch detail" className="row-span-1">
        <MismatchDetail mismatch={selected} />
      </Panel>

      {/* right: agents span both rows */}
      <Panel title="Agents" className="row-span-2" bodyClassName="p-0 overflow-hidden flex flex-col">
        <AgentPanels />
      </Panel>

      {/* center bottom: decision log */}
      <Panel title="Decision log" className="row-span-1">
        <DecisionLog />
      </Panel>
    </div>
  )
}
