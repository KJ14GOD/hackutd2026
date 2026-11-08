import { useEffect, useRef, useState } from 'react'
import { animate } from 'motion/react'

/** Smoothly counts from the previous value to the next whenever `value` changes. */
export function AnimatedNumber({
  value,
  decimals = 1,
  suffix = '',
  className,
}: {
  value: number
  decimals?: number
  suffix?: string
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)

  useEffect(() => {
    const controls = animate(prev.current, value, {
      duration: 0.8,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    })
    prev.current = value
    return () => controls.stop()
  }, [value])

  return (
    <span className={className}>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  )
}
