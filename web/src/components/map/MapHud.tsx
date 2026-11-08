import { CALLS, IO, POCKETS, PROGRAMS, STORES } from '@/data/carddemo'

/* Minimal instrument chrome over the map: just a figure caption and a scan
 * readout in the top corners. Pure chrome — pointer-events none, monochrome,
 * monospace, low opacity. Counts live in the StatStrip footer, not here, so the
 * map stays uncluttered. */

const HUD = 'var(--font-mono)'

export function MapHud({ progress, insetRight = 0 }: { progress: number; insetRight?: number }) {
  const label = 'text-[10px] uppercase leading-[1.5] text-[#83838d]'
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" style={{ fontFamily: HUD, letterSpacing: '0.18em' }}>
      {/* top-left: figure caption */}
      <div className={`absolute left-3 top-2.5 ${label}`} style={{ fontFamily: HUD }}>
        FIG. 01 / CARDDEMO / DEPENDENCY MAP
      </div>

      {/* top-right: scan readout */}
      <div className={`absolute top-2.5 text-right ${label}`} style={{ right: 12 + insetRight, fontFamily: HUD }}>
        SCAN 01 / {Math.round(progress * 100)}% ON JAVA
      </div>
    </div>
  )
}

/* full-width instrument footer */
const PHASES = ['Map', 'Shadow', 'Ask', 'Cut over']
export function StatStrip({ progress }: { progress: number }) {
  const links = CALLS.length + IO.length
  return (
    <footer
      className="flex h-7 shrink-0 items-center gap-6 border-t border-[var(--color-line)] bg-black px-4 text-[10px] uppercase"
      style={{ fontFamily: HUD, letterSpacing: '0.14em' }}
    >
      <Metric k="Programs" v={PROGRAMS.length} />
      <Metric k="Pockets" v={POCKETS.length} />
      <Metric k="Stores" v={STORES.length} />
      <Metric k="Links" v={links} />
      <Metric k="On Java" v={`${Math.round(progress * 100)}%`} accent />
      <div className="ml-auto hidden items-center gap-5 md:flex">
        {PHASES.map((p, i) => (
          <span key={p} className="text-[#4d4d55]">
            <span className="text-[#6a6a73]">{`0${i + 1}`}</span> {p}
          </span>
        ))}
      </div>
    </footer>
  )
}

function Metric({ k, v, accent }: { k: string; v: number | string; accent?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[#45454e]">{k}</span>
      <span className="tnum" style={{ color: accent ? 'var(--color-accent)' : '#a9afba' }}>{v}</span>
    </span>
  )
}
