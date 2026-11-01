import { describe, expect, it } from 'vitest'
import { tuningKey } from '../../domain/instruments'
import { breakdownGroups, valueFilter } from './breakdowns'
import type { Breakdowns } from './types'

const value = (name: string) => [{ value: name, count: 1 }]

const breakdowns: Breakdowns = {
  key: [],
  tune_type: value('Reel'),
  genre: value('Irish'),
  time_signature: value('7/8'),
  composer: value('Ed Haley'),
  learned_from: value('Kevin'),
  tunings: [
    { instrument: 'violin', values: value('GDAE') },
    { instrument: 'theremin', values: value('Any') },
  ],
}

describe('breakdownGroups', () => {
  it('orders the groups and maps each instrument to its tuning filter', () => {
    expect(breakdownGroups(breakdowns).map(({ facet }) => facet)).toEqual([
      'tune_type',
      tuningKey('violin'),
      'genre',
      'time_signature',
      'composer',
      'learned_from',
    ])
  })
})

describe('valueFilter', () => {
  it('sets only the facet, and nothing where the value cannot filter', () => {
    expect(valueFilter('genre', 'Irish')).toEqual({ genre: 'Irish' })
    expect(valueFilter('genre', 'All')).toBeNull()
    expect(valueFilter('time_signature', '7/8')).toEqual({ time_signature: '7/8' })
  })
})
