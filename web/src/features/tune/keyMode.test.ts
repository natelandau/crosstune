import { describe, expect, it } from 'vitest'
import { keyModeLabel } from './keyMode'

describe('keyModeLabel', () => {
  it.each([
    ['D', 'major', '', 'D major'],
    ['D', 'minor', 'm', 'D minor'],
    ['E', 'dorian', ' dor', 'E dorian'],
    ['A', 'mixolydian', ' mix', 'A mixolydian'],
    ['G', 'modal', ' modal', 'G modal'],
    ['C', 'other', '', 'C'],
    ['C', 'lydian', '', 'C'],
    ['F#', undefined, '', 'F#'],
  ] as const)('%s %s shows %j and reads %j', (key, mode, suffix, spoken) => {
    expect(keyModeLabel(key, mode)).toEqual({ suffix, spoken })
  })
})
