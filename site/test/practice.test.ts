import { describe, expect, it } from 'vitest'
import {
  compensatedSemitones,
  formatTime,
  handleCaption,
  loopCaption,
  moveHandle,
  pitchCaption,
  speedCaption,
  wrapTime,
} from '../src/demos/practice'

describe('moveHandle', () => {
  const loop = { a: 8, b: 14 }

  it('keeps A at least a second before B', () => {
    expect(moveHandle(loop, 'a', 13.8, 30)).toEqual({ a: 13, b: 14 })
  })

  it('keeps B at least a second after A', () => {
    expect(moveHandle(loop, 'b', 2, 30)).toEqual({ a: 8, b: 9 })
  })

  it('keeps both handles inside the clip', () => {
    expect(moveHandle(loop, 'a', -3, 30)).toEqual({ a: 0, b: 14 })
    expect(moveHandle(loop, 'b', 45, 30)).toEqual({ a: 8, b: 30 })
  })
})

describe('wrapTime', () => {
  const loop = { a: 8, b: 14 }

  it('returns to A on reaching B while looping', () => {
    expect(wrapTime(14.02, loop, true)).toBe(8)
  })

  it('plays straight through with the loop off', () => {
    expect(wrapTime(14.02, loop, false)).toBe(14.02)
  })

  it('leaves a time inside the loop alone', () => {
    expect(wrapTime(10, loop, true)).toBe(10)
  })
})

describe('compensatedSemitones', () => {
  it('cancels the octave a doubled rate adds', () => {
    expect(compensatedSemitones(0, 200)).toBe(-12)
  })

  it('passes the shift through at normal speed', () => {
    expect(compensatedSemitones(3, 100)).toBe(3)
  })
})

describe('captions', () => {
  it('describes speed', () => {
    expect(speedCaption(75)).toBe('75%: slower, same pitch.')
    expect(speedCaption(120)).toBe('120%: faster, same pitch.')
    expect(speedCaption(100)).toBe('100%: the speed it was played.')
  })

  it('describes pitch', () => {
    expect(pitchCaption(1)).toBe('Up a semitone, same speed.')
    expect(pitchCaption(-3)).toBe('Down 3 semitones, same speed.')
    expect(pitchCaption(0)).toBe('Original pitch.')
  })

  it('describes the loop', () => {
    expect(loopCaption({ a: 8, b: 14.5 }, true)).toBe('Looping 0:08 to 0:14.')
    expect(loopCaption({ a: 8, b: 14 }, false)).toBe('Loop off: it plays straight through.')
  })

  it('tells a visitor how to hear a loop they set with Loop off', () => {
    expect(handleCaption({ a: 8, b: 14 }, false)).toBe(
      'Loop set to 0:08 to 0:14. Turn on Loop to repeat it.',
    )
    expect(handleCaption({ a: 8, b: 14 }, true)).toBe('Looping 0:08 to 0:14.')
  })

  it('formats minutes and seconds', () => {
    expect(formatTime(75.9)).toBe('1:15')
    expect(formatTime(-1)).toBe('0:00')
  })
})
