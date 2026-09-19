import { describe, expect, it } from 'vitest'
import { pitchClass } from './keyColor'

describe('pitchClass', () => {
  it('reads each natural', () => {
    expect(['C', 'D', 'E', 'F', 'G', 'A', 'B'].map(pitchClass)).toEqual([0, 2, 4, 5, 7, 9, 11])
  })

  it('reads sharps and flats, ascii and unicode', () => {
    expect(pitchClass('C#')).toBe(1)
    expect(pitchClass('C♯')).toBe(1)
    expect(pitchClass('Db')).toBe(1)
    expect(pitchClass('D♭')).toBe(1)
  })

  it('gives one enharmonic pair one pitch', () => {
    expect(pitchClass('Bb')).toBe(pitchClass('A#'))
    expect(pitchClass('F#')).toBe(pitchClass('Gb'))
  })

  it('takes the first character as the note, so a lowercase flat still reads', () => {
    expect(pitchClass('bb')).toBe(10)
    expect(pitchClass('b')).toBe(11)
  })

  it('wraps at the edges of the octave', () => {
    expect(pitchClass('Cb')).toBe(11)
    expect(pitchClass('B#')).toBe(0)
  })

  it('trims surrounding space', () => {
    expect(pitchClass('  D  ')).toBe(2)
  })

  it('refuses anything that is not a pitch class', () => {
    for (const value of ['', '   ', 'Am', 'H', 'Dm7', '?', 'open', 'DD', 'D##', '2'])
      expect(pitchClass(value), value).toBeNull()
  })

  // An inherited property name would otherwise come back as a function rather than undefined.
  it('refuses an accidental that names a property of Object', () => {
    expect(pitchClass('Bconstructor')).toBeNull()
    expect(pitchClass('BtoString')).toBeNull()
  })
})
