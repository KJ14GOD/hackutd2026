/* Ambient background: faint accent "wires" slowly drifting — the legacy
 * system running underneath. Deterministic so it never jumps on re-render. */

function seg(seed: number) {
  // cheap deterministic pseudo-random
  const r = (n: number) => {
    const x = Math.sin(seed * 999 + n * 37.13) * 43758.5453
    return x - Math.floor(x)
  }
  const x = r(1) * 100
  const y = r(2) * 100
  const len = 2 + r(3) * 6
  const ang = (r(4) - 0.5) * 70 + 35 // mostly diagonal
  const dx = Math.cos((ang * Math.PI) / 180) * len
  const dy = Math.sin((ang * Math.PI) / 180) * len
  const op = 0.1 + r(5) * 0.5
  return { x, y, dx, dy, op }
}

function Layer({ count, seedBase, speed, opacity }: { count: number; seedBase: number; speed: number; opacity: number }) {
  const segs = Array.from({ length: count }, (_, i) => seg(seedBase + i))
  return (
    <g style={{ animation: `drift ${speed}s linear infinite alternate`, opacity }}>
      {segs.map((s, i) => (
        <line
          key={i}
          x1={`${s.x}%`}
          y1={`${s.y}%`}
          x2={`${s.x + s.dx}%`}
          y2={`${s.y + s.dy}%`}
          stroke="var(--color-accent)"
          strokeWidth={1}
          strokeLinecap="round"
          opacity={s.op}
        />
      ))}
    </g>
  )
}

export function WireField() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* top green vignette, like the reference */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 70% at 50% -10%, rgba(118,185,0,0.1), transparent 55%)' }}
      />
      <svg className="absolute inset-0 h-full w-full">
        <Layer count={46} seedBase={1} speed={38} opacity={0.5} />
        <Layer count={28} seedBase={100} speed={26} opacity={0.3} />
      </svg>
      {/* bottom fade to seat content */}
      <div
        className="absolute inset-x-0 bottom-0 h-40"
        style={{ background: 'linear-gradient(to top, var(--color-bg), transparent)' }}
      />
    </div>
  )
}
