import { useEffect, useRef, useState } from 'react'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Animate a set of named numbers toward their targets. Re-renders per frame
 * only while something is moving. */
export function useTweenMap(targets: Record<string, number>, ms = 650): Record<string, number> {
  const [values, setValues] = useState(targets)
  const from = useRef(targets)
  const cur = useRef(targets)
  const raf = useRef(0)
  const key = JSON.stringify(targets)

  useEffect(() => {
    cancelAnimationFrame(raf.current)
    if (reduced() || ms <= 0) {
      cur.current = targets
      setValues(targets)
      return
    }
    from.current = { ...cur.current }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const e = easeInOut(t)
      const next: Record<string, number> = {}
      for (const k of Object.keys(targets)) {
        const a = from.current[k] ?? targets[k]
        next[k] = a + (targets[k] - a) * e
      }
      cur.current = next
      setValues(next)
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms])

  return values
}
