import { expect, it } from 'vitest'
import { tuneRow, userTuneRow } from '../test/rows'
import { tuneFieldsChanged, tuneFieldsSet, bulkPatchFields } from './tuneFields'

const blank = { title: 'Soldier', time_signature: '4/4' as const }
const user = { status: 'want_to_learn' as const }

it('sets only the fields a new tune carries beyond the blank form', () => {
  expect(tuneFieldsSet(blank, user)).toEqual(['title'])
  expect(
    tuneFieldsSet(
      {
        ...blank,
        key: 'D',
        modes: ['mixolydian'],
        tunings: { violin: { tuning: 'AEAE', capo: 2 } },
        genre: 'Old-time',
        lyrics: 'words',
      },
      { status: 'learning', notes: 'slow' },
    ),
  ).toEqual(['title', 'status', 'key', 'mode', 'tuning', 'capo', 'genre', 'lyrics', 'notes'])
})

it('leaves out empty values', () => {
  expect(
    tuneFieldsSet(
      { ...blank, key: null, modes: [], composer: null, alternate_titles: [], tunings: {} },
      { ...user, learned_from: null, notes: null },
    ),
  ).toEqual(['title'])
})

it('counts a cleared time signature as set', () => {
  expect(tuneFieldsSet({ ...blank, time_signature: null }, user)).toEqual([
    'title',
    'time_signature',
  ])
})

const before = {
  tune: tuneRow('t1', 'Soldier', { key: 'D', modes: ['mixolydian'], composer: 'Trad' }),
  userTune: userTuneRow('u1', 't1', { status: 'learning', notes: 'old' }),
}

it('reports only changed fields', () => {
  const same = {
    title: 'Soldier',
    key: 'D',
    modes: ['mixolydian' as const],
    composer: 'Trad',
    time_signature: null,
    alternate_titles: [],
    tunings: before.tune.tunings,
    genre: null,
    tune_type: null,
    part_structure: null,
    lyrics: null,
    is_crooked: false,
  }
  expect(tuneFieldsChanged(before, same, { status: 'learning', notes: 'old' })).toEqual([])
  expect(
    tuneFieldsChanged(before, { ...same, key: 'G' }, { status: 'known', notes: 'new' }),
  ).toEqual(['status', 'key', 'notes'])
})

it('maps a bulk patch to the fields it writes', () => {
  expect(bulkPatchFields({ userTune: { status: 'known' } })).toEqual(['status'])
  expect(
    bulkPatchFields({
      tune: { modes: ['dorian'], key: undefined },
      tunings: { violin: 'AEAE' },
    }),
  ).toEqual(['mode', 'tuning'])
})
