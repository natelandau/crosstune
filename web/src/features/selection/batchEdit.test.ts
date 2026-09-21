import { describe, expect, it } from 'vitest'
import type { Instrument } from '../../db/types'
import { songRow, userSongRow } from '../../test/rows'
import { isUnchanged, summarize, toPatch, visibleEditFields } from './batchEdit'

const a = {
  song: songRow('s1', 'Say Old Man', {
    key: 'A',
    violin_tuning: 'Standard (GDAE)',
    is_crooked: false,
  }),
  userSong: userSongRow('u1', 's1', { status: 'known' }),
}
const b = {
  song: songRow('s2', 'Lost Indian', {
    key: 'A',
    violin_tuning: 'Cross A (AEAE)',
    is_crooked: false,
  }),
  userSong: userSongRow('u2', 's2', { status: 'learning' }),
}

describe('summarize', () => {
  it('reports shared, mixed, and empty fields', () => {
    const summary = summarize([a, b])
    expect(summary.key).toEqual({ kind: 'shared', value: 'A' })
    expect(summary.violin_tuning).toEqual({ kind: 'mixed' })
    expect(summary.genre).toEqual({ kind: 'empty' })
    expect(summary.status).toEqual({ kind: 'mixed' })
    expect(summary.is_crooked).toEqual({ kind: 'shared', value: false })
  })

  it('treats a mode this client does not know as no value', () => {
    const lydian1 = { ...a, song: { ...a.song, mode: 'lydian' } }
    const lydian2 = { ...b, song: { ...b.song, mode: 'lydian' } }
    expect(summarize([lydian1, lydian2]).mode).toEqual({ kind: 'empty' })

    const major = { ...b, song: { ...b.song, mode: 'major' } }
    expect(summarize([lydian1, major]).mode).toEqual({ kind: 'mixed' })
  })

  it('treats an unknown status as no value', () => {
    const unknown = { ...a, userSong: { ...a.userSong, status: 'retired' } }
    expect(summarize([unknown]).status).toEqual({ kind: 'empty' })
  })
})

describe('visibleEditFields', () => {
  const violin = new Set<Instrument>(['violin'])

  it('shows a tuning for a played instrument', () => {
    expect(visibleEditFields([a, b], violin)).toContain('violin_tuning')
    expect(visibleEditFields([a, b], violin)).not.toContain('banjo_tuning')
  })

  it('shows a tuning any selected song already has', () => {
    const banjo = { ...b, song: { ...b.song, banjo_tuning: 'Double C (gCGCD)' } }
    expect(visibleEditFields([a, banjo], violin)).toContain('banjo_tuning')
  })

  it('does not treat an undefined tuning as a value', () => {
    const undefinedTuning = { ...b, song: { ...b.song, banjo_tuning: undefined } }
    expect(visibleEditFields([a, undefinedTuning], violin)).not.toContain('banjo_tuning')
  })
})

describe('touched fields', () => {
  it('treats a value equal to the shared one, or a blank over empty, as unchanged', () => {
    expect(isUnchanged({ kind: 'shared', value: 'A' }, 'A')).toBe(true)
    expect(isUnchanged({ kind: 'shared', value: 'A' }, ' A ')).toBe(false)
    expect(isUnchanged({ kind: 'shared', value: 'A' }, 'D')).toBe(false)
    expect(isUnchanged({ kind: 'empty' }, '')).toBe(true)
    expect(isUnchanged({ kind: 'mixed' }, '')).toBe(false)
  })
})

describe('toPatch', () => {
  it('splits touched fields between song and user song, trimming and clearing', () => {
    expect(
      toPatch({
        violin_tuning: ' Cross A (AEAE) ',
        genre: '',
        mode: null,
        is_crooked: true,
        status: 'known',
        learned_from: 'Bruce Molsky',
      }),
    ).toEqual({
      song: { violin_tuning: 'Cross A (AEAE)', genre: null, mode: null, is_crooked: true },
      userSong: { status: 'known', learned_from: 'Bruce Molsky' },
    })
  })

  it('never clears status', () => {
    expect(toPatch({ status: null })).toEqual({ song: {}, userSong: {} })
  })
})
