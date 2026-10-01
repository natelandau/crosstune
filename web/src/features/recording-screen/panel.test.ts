import { describe, expect, it } from 'vitest'
import { SPEED_STEP, stepSpeed } from './panel'

describe('stepSpeed', () => {
  it.each([
    [70, -SPEED_STEP, 65],
    [70, SPEED_STEP, 75],
    [72, -SPEED_STEP, 70],
    [72, SPEED_STEP, 75],
    [73, -SPEED_STEP, 70],
    [73, SPEED_STEP, 75],
    [72, -2 * SPEED_STEP, 65],
    [52, -SPEED_STEP, 50],
    [148, SPEED_STEP, 150],
    [50, -SPEED_STEP, 50],
    [150, SPEED_STEP, 150],
  ])('moves %i by %i to %i, never skipping a grid step', (percent, by, expected) => {
    expect(stepSpeed(percent, by)).toBe(expected)
  })
})
