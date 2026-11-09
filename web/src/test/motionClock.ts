import { frameData, MotionGlobalConfig, processFrame } from 'motion/react'
import { onTestFinished } from 'vitest'

/**
 * Holds Motion's clock for the rest of the test. Motion runs its own frame loop, which fake
 * timers cannot reach, so only `motionFrames` moves its animations on.
 */
export function holdMotionClock(): void {
  MotionGlobalConfig.useManualTiming = true
  onTestFinished(() => void (MotionGlobalConfig.useManualTiming = false))
}

/** Moves a held Motion clock on by `ms`, a 16ms frame at a time. */
export function motionFrames(ms: number): void {
  for (let t = 0; t < ms; t += 16) processFrame(frameData.timestamp + Math.min(16, ms - t))
}
