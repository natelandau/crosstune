import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ISOLATE } from '../player/isolate/isolateSetting'
import { PITCH_BADGE, SPEED_BADGE } from '../player/transportCopy'
import { PITCH } from './PitchPanel'
import { SPEED } from './SpeedPanel'
import { ISOLATE_LABEL, LOOPS_LABEL, MUTE, SEGMENT_LABEL, SOLO } from './practiceCopy'
import { useModeLabels } from './useModeLabels'

describe('useModeLabels', () => {
  it('names each mode plainly at the defaults', () => {
    const { result } = renderHook(() => useModeLabels(100, 0, DEFAULT_ISOLATE))
    expect(result.current).toEqual({
      loops: LOOPS_LABEL,
      speed: SPEED,
      pitch: PITCH,
      isolate: ISOLATE_LABEL,
    })
  })

  it('adds the value to Speed, Pitch, and Isolate once each is off its default', () => {
    const { result } = renderHook(() =>
      useModeLabels(75, -200, { ...DEFAULT_ISOLATE, effect: 'mute' }),
    )
    expect(result.current).toEqual({
      loops: LOOPS_LABEL,
      speed: SEGMENT_LABEL(SPEED, SPEED_BADGE(75)),
      pitch: SEGMENT_LABEL(PITCH, PITCH_BADGE(-200)),
      isolate: SEGMENT_LABEL(ISOLATE_LABEL, MUTE),
    })
  })

  it('names Solo once a soloed range is narrowed', () => {
    const { result } = renderHook(() => useModeLabels(100, 0, { ...DEFAULT_ISOLATE, lowHz: 200 }))
    expect(result.current.isolate).toBe(SEGMENT_LABEL(ISOLATE_LABEL, SOLO))
  })
})
