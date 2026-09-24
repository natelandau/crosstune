import { describe, expect, it } from 'vitest'
import type { Instrument } from '../../api/vocabulary'
import {
  capoLabel,
  instrumentsFrom,
  setTuning,
  tuningDisplay,
  tuningEntry,
  tuningInstruments,
  tuningLabel,
  tuningSummary,
  visibleTunings,
} from './instruments'

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

  it('reads a stored banjo as the five-string banjo', () => {
    expect([...instrumentsFrom({ ...row, instruments: ['banjo'] })]).toEqual(['five_string_banjo'])
    expect([...instrumentsFrom({ ...row, instruments: ['banjo', 'five_string_banjo'] })]).toEqual([
      'five_string_banjo',
    ])
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

  it('also shows a tuning the tune already carries', () => {
    expect(
      visibleTunings(played('violin'), { violin_tuning: null, banjo_tuning: 'gDGBD' }),
    ).toEqual(['violin_tuning', 'banjo_tuning'])
    expect(visibleTunings(played(), { violin_tuning: null, banjo_tuning: null })).toEqual([])
  })
})

describe('tuningInstruments', () => {
  it('lists played instruments in vocabulary order', () => {
    expect(tuningInstruments(played('guitar', 'violin'), null)).toEqual(['violin', 'guitar'])
    expect(tuningInstruments(played(), null)).toEqual([])
  })

  it('also lists an instrument the tune holds a tuning or a capo for', () => {
    const tune = { tunings: { bouzouki: { tuning: 'GDAD' }, guitar: { capo: 3 } } }
    expect(tuningInstruments(played('violin'), tune)).toEqual(['violin', 'guitar', 'bouzouki'])
  })

  it('ignores an instrument key this client does not know', () => {
    expect(tuningInstruments(played(), { tunings: { hardanger: { tuning: 'x' } } })).toEqual([])
  })
})

describe('tuningEntry', () => {
  it('reads a missing or malformed entry as empty', () => {
    expect(tuningEntry(undefined, 'violin')).toEqual({ tuning: null, capo: null })
    expect(tuningEntry({ violin: 'AEAE' }, 'violin')).toEqual({ tuning: null, capo: null })
    expect(tuningEntry({ guitar: { tuning: 'DADGAD', capo: 2 } }, 'guitar')).toEqual({
      tuning: 'DADGAD',
      capo: 2,
    })
  })
})

describe('setTuning', () => {
  it('sets one instrument compactly and keeps every other key, known or not', () => {
    const before = { hardanger: { tuning: 'x' }, guitar: { tuning: 'DADGAD', capo: 2 } }
    expect(setTuning(before, 'violin', { tuning: 'Cross A (AEAE)' })).toEqual({
      hardanger: { tuning: 'x' },
      guitar: { tuning: 'DADGAD', capo: 2 },
      violin: { tuning: 'Cross A (AEAE)' },
    })
  })

  it('keeps the capo when only the tuning changes, and the tuning when only the capo does', () => {
    const before = { guitar: { tuning: 'DADGAD', capo: 2 } }
    expect(setTuning(before, 'guitar', { tuning: 'Drop D (DADGBE)' })).toEqual({
      guitar: { tuning: 'Drop D (DADGBE)', capo: 2 },
    })
    expect(setTuning(before, 'guitar', { capo: null })).toEqual({ guitar: { tuning: 'DADGAD' } })
  })

  it('keeps a capo with no tuning', () => {
    expect(setTuning({}, 'guitar', { capo: 3 })).toEqual({ guitar: { capo: 3 } })
  })

  it('drops an entry left with no tuning and no capo', () => {
    expect(setTuning({ violin: { tuning: 'AEAE' } }, 'violin', { tuning: null })).toEqual({})
  })

  it('never writes a capo key for an instrument without one', () => {
    expect(setTuning({}, 'violin', { tuning: 'AEAE', capo: 2 })).toEqual({
      violin: { tuning: 'AEAE' },
    })
    expect(setTuning({}, 'violin', { capo: 2 })).toEqual({})
  })

  it('does not change its input', () => {
    const before = { violin: { tuning: 'AEAE' } }
    setTuning(before, 'violin', { tuning: null })
    expect(before).toEqual({ violin: { tuning: 'AEAE' } })
  })
})

describe('tuningSummary', () => {
  it('leaves a standard tuning with no capo unsaid', () => {
    expect(tuningSummary('violin', { violin: { tuning: 'Standard (GDAE)' } })).toBeNull()
    expect(
      tuningSummary('five_string_banjo', { five_string_banjo: { tuning: 'Open G (gDGBD)' } }),
    ).toBeNull()
  })

  it('shows a standard tuning with a capo', () => {
    expect(
      tuningSummary('five_string_banjo', {
        five_string_banjo: { tuning: 'Open G (gDGBD)', capo: 2 },
      }),
    ).toBe('Open G (gDGBD), capo 2')
  })

  it('shows a capo alone', () => {
    expect(tuningSummary('guitar', { guitar: { capo: 3 } })).toBe('Capo 3')
  })

  it('always shows a tuning for an instrument with no standard', () => {
    expect(tuningSummary('tenor_banjo', { tenor_banjo: { tuning: 'Irish (GDAE)' } })).toBe(
      'Irish (GDAE)',
    )
  })

  it('shows nothing for an instrument with no entry', () => {
    expect(tuningSummary('guitar', {})).toBeNull()
  })

  it('adds the instrument label only when asked, for a row with more than one instrument', () => {
    const tunings = { guitar: { tuning: 'DADGAD' } }
    expect(tuningSummary('guitar', tunings, { withInstrument: true })).toBe('Guitar: DADGAD')
    expect(tuningSummary('guitar', tunings)).toBe('DADGAD')
  })
})

describe('tuningDisplay', () => {
  it('shows a standard tuning on the tune screen', () => {
    expect(tuningDisplay('violin', { violin: { tuning: 'Standard (GDAE)' } })).toBe(
      'Standard (GDAE)',
    )
  })

  it('labels the tuning with its instrument when asked, as the tune screen always does', () => {
    expect(
      tuningDisplay('violin', { violin: { tuning: 'Standard (GDAE)' } }, { withInstrument: true }),
    ).toBe('Violin: Standard (GDAE)')
  })
})

it('names each tuning and capo after its instrument', () => {
  expect(tuningLabel('five_string_banjo')).toBe('5-string banjo tuning')
  expect(capoLabel('guitar')).toBe('Guitar capo')
})
