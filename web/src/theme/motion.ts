import { createElement, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'

export const SPRING = { type: 'spring', stiffness: 400, damping: 36 } as const
export const EASE = [0.32, 0.72, 0, 1] as const
export const DURATION = { short: 0.15, base: 0.25, long: 0.35 } as const

/**
 * The spring as a CSS `linear()` easing over `DURATION.long`, for a transition CSS runs rather
 * than Motion. Sampled from the damped spring's step response, with mass 1 as Motion assumes.
 */
export function springEasing(steps = 24): string {
  const omega = Math.sqrt(SPRING.stiffness)
  const zeta = SPRING.damping / (2 * omega)
  const damped = omega * Math.sqrt(1 - zeta * zeta)
  const points: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * DURATION.long
    const decay = Math.exp(-zeta * omega * t)
    const x =
      i === steps
        ? 1
        : 1 - decay * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t))
    points.push(x.toFixed(4))
  }
  return `linear(${points.join(', ')})`
}

/** Applies the spring by default and turns transform animation off under reduced motion. */
export function AppMotion({ children }: { children: ReactNode }) {
  return createElement(MotionConfig, { reducedMotion: 'user', transition: SPRING }, children)
}
