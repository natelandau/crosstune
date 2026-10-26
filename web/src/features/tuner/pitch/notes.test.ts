// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { inTuneFraction, isInTune, noteFor, tenths, tuneHint, tuneStep } from './notes'

describe('noteFor', () => {
  it('names A4 at 440 Hz', () => {
    expect(noteFor(440, 440)).toEqual({ name: 'A', octave: 4, cents: 0 })
  })

  it('names the low E of a bass', () => {
    const note = noteFor(41.2034, 440)!
    expect(note.name).toBe('E')
    expect(note.octave).toBe(1)
    expect(Math.abs(note.cents)).toBeLessThan(0.01)
  })

  it('spells accidentals as sharps', () => {
    expect(noteFor(277.18, 440)?.name).toBe('C♯')
  })

  it('reads against the reference pitch', () => {
    expect(noteFor(442, 442)).toEqual({ name: 'A', octave: 4, cents: 0 })
    expect(noteFor(440, 442)?.cents).toBeCloseTo(-7.85, 2)
  })

  it.each([0, -440, Number.NaN, Number.POSITIVE_INFINITY])('names no note at %s Hz', (hz) => {
    expect(noteFor(hz, 440)).toBeNull()
  })
})

describe('tuneStep', () => {
  it.each([
    [0, 'zone'],
    [10, 'zone'],
    [-10, 'zone'],
    [10.1, 'close'],
    [-10.1, 'close'],
    [15, 'close'],
    [-15, 'close'],
    [15.1, 'far'],
    [-40, 'far'],
  ] as const)('%s cents is %s', (cents, step) => {
    expect(tuneStep(cents)).toBe(step)
  })
})

describe('inTuneFraction', () => {
  it.each([
    [0, 1],
    [3, 1],
    [-3, 1],
    [6.5, 0.5],
    [-6.5, 0.5],
    [10, 0],
    [-10, 0],
    [20, 0],
    [-20, 0],
  ])('%s cents is %s in tune', (cents, fraction) => {
    expect(inTuneFraction(cents)).toBeCloseTo(fraction, 10)
  })
})

describe('isInTune', () => {
  it.each([
    [0, true],
    [3, true],
    [-3, true],
    [3.1, false],
    [-3.1, false],
  ])('%s cents is in tune: %s', (cents, inTune) => {
    expect(isInTune(cents)).toBe(inTune)
  })
})

describe('tuneHint', () => {
  it.each([
    [-3.1, 'flat'],
    [3.1, 'sharp'],
    [0, null],
    [-3, null],
    [3, null],
  ] as const)('%s cents hints %s', (cents, hint) => {
    expect(tuneHint(cents)).toBe(hint)
  })
})

describe('tenths', () => {
  it.each([
    [3.04, 3],
    [3.05, 3.1],
    [-3.05, -3],
    [-3.06, -3.1],
    [7.66, 7.7],
  ])('rounds %s cents to %s', (cents, rounded) => {
    expect(tenths(cents)).toBeCloseTo(rounded, 10)
  })
})

// Each check judges the cents as shown, to a tenth.
describe('judging the shown tenth', () => {
  it('counts 3.04 cents as in tune', () => {
    expect(isInTune(3.04)).toBe(true)
    expect(tuneHint(3.04)).toBeNull()
    expect(inTuneFraction(3.04)).toBe(1)
  })

  it('counts 3.05 cents, shown as 3.1, as sharp', () => {
    expect(isInTune(3.05)).toBe(false)
    expect(tuneHint(3.05)).toBe('sharp')
    expect(inTuneFraction(3.05)).toBeLessThan(1)
  })

  it('counts -3.05 cents, shown as 3.0 flat, as in tune', () => {
    expect(isInTune(-3.05)).toBe(true)
    expect(tuneHint(-3.05)).toBeNull()
  })

  it('steps 10.04 cents inside the zone and 15.04 as close', () => {
    expect(tuneStep(10.04)).toBe('zone')
    expect(tuneStep(15.04)).toBe('close')
  })
})
