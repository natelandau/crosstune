import { describe, expect, it } from 'vitest'
import { FACET_LABELS } from '../catalog/filters'
import { tuningKey, tuningLabel } from '../settings/instruments'
import { DETAIL_LABELS } from '../tune/detailFields'
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
    expect(breakdownGroups(breakdowns).map(({ header, facet }) => [header, facet])).toEqual([
      [FACET_LABELS.tune_type, 'tune_type'],
      [tuningLabel('violin'), tuningKey('violin')],
      [FACET_LABELS.genre, 'genre'],
      [DETAIL_LABELS.time_signature, null],
      [FACET_LABELS.composer, 'composer'],
      [FACET_LABELS.learned_from, 'learned_from'],
    ])
  })
})

describe('valueFilter', () => {
  it('sets only the facet, and nothing where the value cannot filter', () => {
    expect(valueFilter('genre', 'Irish')).toEqual({ genre: 'Irish' })
    expect(valueFilter('genre', 'All')).toBeNull()
    expect(valueFilter(null, '7/8')).toBeNull()
  })
})
