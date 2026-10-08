import { describe, expect, it } from 'vitest'
import { PITCH_BADGE } from './transportCopy'

describe('PITCH_BADGE', () => {
  it('formats semitones, with one decimal only off a whole semitone', () => {
    expect(PITCH_BADGE(200)).toBe('+2')
    expect(PITCH_BADGE(-100)).toBe('−1')
    expect(PITCH_BADGE(230)).toBe('+2.3')
    expect(PITCH_BADGE(-150)).toBe('−1.5')
  })

  it('rounds the fractional semitone from integer cents, not the raw float', () => {
    expect(PITCH_BADGE(201)).toBe('+2.0')
    expect(PITCH_BADGE(205)).toBe('+2.1')
    expect(PITCH_BADGE(-250)).toBe('−2.5')
    expect(PITCH_BADGE(100)).toBe('+1')
    expect(PITCH_BADGE(-1200)).toBe('−12')
  })

  it('rounds a negative magnitude the same as its positive counterpart, sign aside', () => {
    expect(PITCH_BADGE(-205)).toBe('−2.1')
  })

  it('never rounds a non-zero pitch away to a bare 0.0', () => {
    expect(PITCH_BADGE(1)).toBe('+0.1')
    expect(PITCH_BADGE(-1)).toBe('−0.1')
    expect(PITCH_BADGE(-4)).toBe('−0.1')
  })
})
