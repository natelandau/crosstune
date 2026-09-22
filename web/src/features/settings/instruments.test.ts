import { describe, expect, it } from 'vitest'
import type { Instrument } from '../../api/vocabulary'
import { DEFAULT_INSTRUMENTS } from '../../constants'
import { instrumentsFrom, visibleTunings } from './instruments'

const played = (...instruments: Instrument[]) => new Set<Instrument>(instruments)

const row = {
  id: 's',
  created_at: 't',
  updated_at: 't',
  deleted_at: null,
  server_seq: 0,
  instruments: ['banjo', 'kazoo'],
  audio_quality: 'standard',
}

describe('instrumentsFrom', () => {
  it('defaults to violin when there is no row or the row is tombstoned', () => {
    expect(instrumentsFrom(undefined)).toEqual(DEFAULT_INSTRUMENTS)
    expect(instrumentsFrom(null)).toEqual(DEFAULT_INSTRUMENTS)
    expect(instrumentsFrom({ ...row, deleted_at: 't' })).toEqual(DEFAULT_INSTRUMENTS)
  })

  it('keeps only instruments this client knows', () => {
    expect([...instrumentsFrom(row)]).toEqual(['banjo'])
  })

  it('defaults when instruments is not an array', () => {
    expect(instrumentsFrom({ ...row, instruments: 'violin' } as never)).toEqual(DEFAULT_INSTRUMENTS)
  })
})

describe('visibleTunings', () => {
  it('shows a tuning for each played instrument', () => {
    expect(visibleTunings(played('violin'), null)).toEqual(['violin_tuning'])
    expect(visibleTunings(played('banjo', 'violin'), null)).toEqual([
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
