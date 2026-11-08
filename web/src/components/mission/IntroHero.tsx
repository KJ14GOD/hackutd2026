import { useEffect } from 'react'
import { ArrowRight } from 'lucide-react'

/* Norrvik-style opening: one huge headline over a diagonal point-cloud band,
 * a cream CTA. Click / Enter / Esc to engage and reveal the mission control. */

const HUD = 'var(--font-mono)'

export function IntroHero({ onEnter }: { onEnter: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') onEnter()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onEnter])

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black" style={{ fontFamily: 'var(--font-sans)' }}>
      {/* diagonal point-cloud scan band */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.55) 0.7px, transparent 0.8px)',
          backgroundSize: '7px 7px',
          maskImage: 'linear-gradient(118deg, transparent 18%, black 40%, black 60%, transparent 82%)',
          WebkitMaskImage: 'linear-gradient(118deg, transparent 18%, black 40%, black 60%, transparent 82%)',
          opacity: 0.22,
        }}
      />
      {/* periwinkle haze along the band */}
      <div
        className="absolute inset-0 opacity-[0.10]"
        style={{ background: 'linear-gradient(118deg, transparent 38%, #7FB2FF 50%, transparent 62%)' }}
      />

      {/* HUD corners */}
      <div className="absolute left-5 top-4 text-[10px] uppercase text-[#83838d]" style={{ fontFamily: HUD, letterSpacing: '0.18em' }}>
        FIG. 00 / SHADOW DIFF / LEGACY TWIN
      </div>
      <div className="absolute right-5 top-4 text-right text-[10px] uppercase leading-[1.6] text-[#83838d]" style={{ fontFamily: HUD, letterSpacing: '0.18em' }}>
        YAW 003 / PITCH 64
        <br />
        SCAN 00 / 000%
      </div>
      <div className="absolute bottom-4 right-5 text-[10px] uppercase text-[#54545d]" style={{ fontFamily: HUD, letterSpacing: '0.16em' }}>
        Click / Enter to engage
      </div>

      {/* content */}
      <div className="absolute left-5 top-1/2 max-w-[660px] -translate-y-1/2 md:left-16">
        <div className="text-[11px] uppercase text-[var(--color-accent)]" style={{ fontFamily: HUD, letterSpacing: '0.2em' }}>
          (01) Capture · Shadow · Ask
        </div>
        <h1 className="mt-5 text-[clamp(38px,7vw,86px)] font-semibold leading-[0.98] tracking-[-0.035em] text-[var(--color-ink)]">
          Modernize legacy code
          <br />
          <span className="text-[#8a8f99]">without losing what it knows.</span>
        </h1>
        <p className="mt-6 max-w-[460px] text-[15px] leading-relaxed text-[#9aa0ab]">
          Shadow Diff rewrites a legacy codebase one component at a time, runs old and new side by side, and asks the
          right person when it can’t tell a bug from a rule. Every answer becomes a test.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-5">
          <button
            onClick={onEnter}
            className="group inline-flex items-center gap-5 bg-[#ece9e2] py-3 pl-5 pr-2 text-[12.5px] font-medium uppercase tracking-[0.14em] text-[#0b0b0e] transition hover:bg-white"
          >
            Enter the twin
            <span className="grid size-8 place-items-center bg-[var(--color-accent)] text-black transition group-hover:translate-x-0.5">
              <ArrowRight className="size-4" />
            </span>
          </button>
          <button
            onClick={onEnter}
            className="text-[11px] uppercase text-[#83838d] underline-offset-4 transition hover:text-[var(--color-ink)] hover:underline"
            style={{ fontFamily: HUD, letterSpacing: '0.16em' }}
          >
            Explore a live model ↗
          </button>
        </div>
      </div>
    </div>
  )
}
