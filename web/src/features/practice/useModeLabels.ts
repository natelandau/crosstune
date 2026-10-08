import { useMemo } from 'react'
import { PITCH_BADGE, SPEED_BADGE } from '../player/transportCopy'
import { PITCH } from './PitchPanel'
import { SPEED } from './SpeedPanel'
import { LOOPS_LABEL, SEGMENT_LABEL } from './practiceCopy'
import type { Mode } from './usePracticeMode'

/** Each mode's name, with Speed and Pitch carrying their value once it is off default. */
export function useModeLabels(speedPercent: number, pitchCents: number): Record<Mode, string> {
  return useMemo(
    () => ({
      loops: LOOPS_LABEL,
      speed: SEGMENT_LABEL(SPEED, speedPercent !== 100 ? SPEED_BADGE(speedPercent) : null),
      pitch: SEGMENT_LABEL(PITCH, pitchCents !== 0 ? PITCH_BADGE(pitchCents) : null),
    }),
    [speedPercent, pitchCents],
  )
}
