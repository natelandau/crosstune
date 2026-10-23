// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { FLAT, hintLabel, referenceLabel, SHARP, spokenReading } from './tunerCopy'

describe('referenceLabel', () => {
  it('says nothing at 440', () => {
    expect(referenceLabel(440)).toBeNull()
  })

  it('names any other reference pitch', () => {
    expect(referenceLabel(442)).toBe('A4 = 442 Hz')
  })
})

describe('spokenReading', () => {
  it.each([
    [-3.4, 'A4, 3 cents flat'],
    [0.4, 'A4, in tune'],
    [-3, 'A4, in tune'],
    [3.04, 'A4, in tune'],
    [3.05, 'A4, 3 cents sharp'],
    [7.6, 'A4, 8 cents sharp'],
  ])('reads %s cents as %s', (cents, spoken) => {
    expect(spokenReading({ name: 'A', octave: 4, cents })).toBe(spoken)
  })
})

describe('hintLabel', () => {
  it.each([
    [-4, FLAT],
    [4, SHARP],
    [3, null],
    [3.04, null],
    [3.05, SHARP],
  ])('%s cents hints %s', (cents, label) => {
    expect(hintLabel(cents)).toBe(label)
  })
})
