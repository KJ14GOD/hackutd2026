import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  MIGRATION_META,
  SEGMENTS,
  SEG_EDGES,
  intraEdgesOf,
  segMigration,
  segProgress,
  type FileNode,
  type Migration,
} from '@/data/system'
import { IsoScene, type SceneEdge, type SceneItem } from './IsoScene'

export type Lens = 'nodes' | 'segments' | 'dependencies' | 'metrics'

const SEG_COLOR: Record<string, string> = { tx: '#5E9BEB', ac: '#5CB46E', st: '#B47CC7', sh: '#CDB24A', cu: '#E0A050', se: '#9A9AA2' }

function heat(r: number) {
  if (r <= 0) return '#4c5247'
  return `rgb(${Math.round(40 + r * 40)},${Math.round(90 + r * 95)},${Math.round(20 + r * 20)})`
}

export function SceneMap({
  files,
  lens,
  focus,
  setFocus,
  selected,
  toggleSelect,
  clearSelect,
}: {
  files: FileNode[]
  lens: Lens
  focus: string | null
  setFocus: (id: string | null) => void
  selected: Set<string>
  toggleSelect: (id: string) => void
  clearSelect: () => void
}) {
  // ----- overview: segments as cluster blocks -----
  const system = useMemo(() => {
    const items: SceneItem[] = SEGMENTS.map((s) => {
      const prog = segProgress(s.id)
      const mig = segMigration(s.id)
      const color = lens === 'segments' ? SEG_COLOR[s.id] : lens === 'metrics' ? heat(prog) : MIGRATION_META[mig].color
      return {
        id: s.id,
        wx: s.col * 7,
        wy: s.row * 7,
        foot: 2.7,
        height: 22 + prog * 34,
        color,
        label: s.title,
        sub: `${Math.round(prog * 100)}%`,
        metric: lens === 'metrics' ? `${Math.round(prog * 100)}%` : undefined,
        live: files.some((f) => f.segment === s.id && f.migration === 'shadowing'),
      }
    })
    const edges: SceneEdge[] = SEG_EDGES.map((e) => ({ from: e.a, to: e.b, weight: e.weight }))
    return { items, edges }
  }, [lens, files])

  // ----- segment: files inside the focused cluster -----
  const segment = useMemo(() => {
    if (!focus) return null
    const fs = files.filter((f) => f.segment === focus)
    const items: SceneItem[] = fs.map((f) => {
      const color = lens === 'segments' ? SEG_COLOR[focus] : lens === 'metrics' ? heat(f.matchRate) : MIGRATION_META[f.migration].color
      return {
        id: f.id,
        wx: f.lx * 2,
        wy: f.ly * 2,
        foot: 1.35,
        height: 16 + f.isolation * 26,
        color,
        label: f.id,
        metric: lens === 'metrics' && f.matchRate > 0 ? `${Math.round(f.matchRate * 100)}%` : undefined,
        live: f.migration === 'shadowing',
      }
    })
    const edges: SceneEdge[] = intraEdgesOf(focus)
    return { items, edges }
  }, [focus, lens, files])

  const active = focus ? segment! : system

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={focus ?? 'system'}
        className="absolute inset-0"
        initial={{ opacity: 0, scale: focus ? 0.82 : 1.14 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: focus ? 1.14 : 0.82 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <IsoScene
          items={active.items}
          edges={active.edges}
          selected={focus ? selected : new Set<string>()}
          onItemClick={(id) => {
            if (focus) toggleSelect(id)
            else setFocus(id)
          }}
          onBackground={() => {
            if (focus) {
              if (selected.size) clearSelect()
              else setFocus(null)
            }
          }}
        />
      </motion.div>
    </AnimatePresence>
  )
}

export function statusLegend(): { m: Migration; label: string; color: string }[] {
  return (Object.keys(MIGRATION_META) as Migration[]).map((m) => ({ m, label: MIGRATION_META[m].label, color: MIGRATION_META[m].color }))
}
