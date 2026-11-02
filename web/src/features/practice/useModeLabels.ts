import { useMemo } from 'react'
import { isDefaultIsolate, type IsolateSetting } from '../player/isolate/isolateSetting'
import { PITCH_BADGE, SPEED_BADGE } from '../player/transportCopy'
import { PITCH } from './PitchPanel'
import { SPEED } from './SpeedPanel'
import { ISOLATE_LABEL, LOOPS_LABEL, MUTE, SEGMENT_LABEL, SOLO } from './practiceCopy'
import type { Mode } from './usePracticeMode'

/** Each mode's plain name, which a segment shows when a value would not fit. */
export const MODE_NAMES: Record<Mode, string> = {
  loops: LOOPS_LABEL,
  speed: SPEED,
  pitch: PITCH,
  isolate: ISOLATE_LABEL,
}

/** Each mode's name, with Speed, Pitch, and Isolate carrying their value once it is off default. */
export function useModeLabels(
  speedPercent: number,
  pitchCents: number,
  isolate: IsolateSetting,
): Record<Mode, string> {
  const isolateValue = isDefaultIsolate(isolate) ? null : isolate.effect === 'mute' ? MUTE : SOLO
  return useMemo(
    () => ({
      loops: LOOPS_LABEL,
      speed: SEGMENT_LABEL(SPEED, speedPercent !== 100 ? SPEED_BADGE(speedPercent) : null),
      pitch: SEGMENT_LABEL(PITCH, pitchCents !== 0 ? PITCH_BADGE(pitchCents) : null),
      isolate: SEGMENT_LABEL(ISOLATE_LABEL, isolateValue),
    }),
    [speedPercent, pitchCents, isolateValue],
  )
}
