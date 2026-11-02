import { describe, expect, it } from 'vitest'
import {
  frequencyReadout,
  hzReadout,
  stereoEdgeReadout,
  stereoPosition,
  stereoReadout,
} from './isolateReadout'
import { STEREO_CENTER, STEREO_LEFT, STEREO_RIGHT_OF_CENTER } from './practiceCopy'

describe('stereoReadout', () => {
  it.each([
    [-100, 100, 'Everything'],
    [-40, -10, 'Left of center, medium'],
    [-5, 5, 'Center, narrow'],
    [60, 100, 'Right, medium'],
    [-100, 0, 'Left of center, wide'],
  ])('reads %i to %i as %s', (start, end, text) => {
    expect(stereoReadout(start, end)).toBe(text)
  })
})

describe('stereoPosition', () => {
  it.each([
    [0, STEREO_CENTER],
    [9, STEREO_CENTER],
    [10, STEREO_RIGHT_OF_CENTER],
    [-60, STEREO_LEFT],
  ])('reads %i as %s', (pan, text) => {
    expect(stereoPosition(pan)).toBe(text)
  })
})

describe('frequencyReadout', () => {
  it('reads Hz under a kilohertz and kHz to a tenth above it', () => {
    expect(frequencyReadout(200, 4100)).toBe('200 Hz to 4.1 kHz')
    expect(frequencyReadout(40, 16000)).toBe('40 Hz to 16 kHz')
  })

  it('drops a zero tenth', () => {
    expect(hzReadout(1000)).toBe('1 kHz')
    expect(hzReadout(999)).toBe('999 Hz')
  })

  it('rounds a half tenth up, so every client reads the same', () => {
    expect(hzReadout(1150)).toBe('1.2 kHz')
    expect(hzReadout(4050)).toBe('4.1 kHz')
    expect(hzReadout(9950)).toBe('10 kHz')
    expect(hzReadout(15950)).toBe('16 kHz')
  })
})

describe('stereoEdgeReadout', () => {
  it.each([
    [-35, 'Left of center, 35 left'],
    [35, 'Right of center, 35 right'],
    [0, 'Center'],
    [-100, 'Left, 100 left'],
    [5, 'Center, 5 right'],
  ])('reads an edge at %i as %s', (pan, text) => {
    expect(stereoEdgeReadout(pan)).toBe(text)
  })
})
