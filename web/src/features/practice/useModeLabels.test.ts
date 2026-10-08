import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PITCH_BADGE, SPEED_BADGE } from '../player/transportCopy'
import { PITCH } from './PitchPanel'
import { SPEED } from './SpeedPanel'
import { LOOPS_LABEL, SEGMENT_LABEL } from './practiceCopy'
import { useModeLabels } from './useModeLabels'

describe('useModeLabels', () => {
  it('names each mode plainly at the defaults', () => {
    const { result } = renderHook(() => useModeLabels(100, 0))
    expect(result.current).toEqual({ loops: LOOPS_LABEL, speed: SPEED, pitch: PITCH })
  })

  it('adds the value to Speed and Pitch once each is off its default', () => {
    const { result } = renderHook(() => useModeLabels(75, -200))
    expect(result.current).toEqual({
      loops: LOOPS_LABEL,
      speed: SEGMENT_LABEL(SPEED, SPEED_BADGE(75)),
      pitch: SEGMENT_LABEL(PITCH, PITCH_BADGE(-200)),
    })
  })
})
