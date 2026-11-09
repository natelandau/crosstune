import { describe, expect, it } from 'vitest'
import { playedTunings } from '../../domain/instruments'
import { spokenRow } from './spokenRow'

describe('spokenRow', () => {
  it('says each part of a row apart, title first', () => {
    expect(spokenRow('Bonaparte', 'A dorian', 'Learning', ['Cross A (AEAE)'])).toBe(
      'Bonaparte, Key A dorian, Learning, Cross A (AEAE)',
    )
  })

  it('leaves out a missing key and an empty detail', () => {
    expect(spokenRow('Bonaparte', null, 'Known', ['', 'Archived'])).toBe(
      'Bonaparte, Known, Archived',
    )
  })

  it('says the tunings of the instruments played only', () => {
    const tunings = {
      violin: { tuning: 'Cross A (AEAE)' },
      guitar: { tuning: 'Drop D (DADGBE)' },
    }
    expect(
      spokenRow('Bonaparte', null, 'Known', [playedTunings(tunings, new Set(['violin']))]),
    ).toBe('Bonaparte, Known, Cross A (AEAE)')
  })
})
