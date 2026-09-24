import { describe, expect, it } from 'vitest'
import type { Instrument } from '../../api/vocabulary'
import { instrumentsFrom, visibleTunings } from './instruments'

const played = (...instruments: Instrument[]) => new Set<Instrument>(instruments)

const row = {
  id: 's',
  created_at: 't',
  updated_at: 't',
  deleted_at: null,
  server_seq: 0,
  instruments: ['five_string_banjo', 'kazoo'],
  audio_quality: 'standard',
}

describe('instrumentsFrom', () => {
  it('is empty when there is no row or the row is tombstoned', () => {
    expect(instrumentsFrom(undefined)).toEqual(played())
    expect(instrumentsFrom(null)).toEqual(played())
    expect(instrumentsFrom({ ...row, deleted_at: 't' })).toEqual(played())
  })

  it('keeps only instruments this client knows', () => {
    expect([...instrumentsFrom(row)]).toEqual(['five_string_banjo'])
  })

  it('is empty when instruments is not an array', () => {
    expect(instrumentsFrom({ ...row, instruments: 'violin' } as never)).toEqual(played())
  })
})

describe('visibleTunings', () => {
  it('shows a tuning for each played instrument', () => {
    expect(visibleTunings(played('violin'), null)).toEqual(['violin_tuning'])
    expect(visibleTunings(played('five_string_banjo', 'violin'), null)).toEqual([
      'violin_tuning',
      'banjo_tuning',
    ])
    expect(visibleTunings(played(), null)).toEqual([])
  })

  it('also shows a tuning the song already carries', () => {
    expect(
      visibleTunings(played('violin'), { violin_tuning: null, banjo_tuning: 'gDGBD' }),
    ).toEqual(['violin_tuning', 'banjo_tuning'])
    expect(visibleTunings(played(), { violin_tuning: null, banjo_tuning: null })).toEqual([])
  })
})
