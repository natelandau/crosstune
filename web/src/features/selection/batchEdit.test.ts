import { describe, expect, it } from 'vitest'
import type { Instrument } from '../../api/vocabulary'
import { tuneRow, userTuneRow } from '../../test/rows'
import { isUnchanged, summarize, toPatch, visibleEditFields } from './batchEdit'

const a = {
  tune: tuneRow('s1', 'Say Old Man', {
    key: 'A',
    tunings: { violin: { tuning: 'Standard (GDAE)' } },
    is_crooked: false,
  }),
  userTune: userTuneRow('u1', 's1', { status: 'known' }),
}
const b = {
  tune: tuneRow('s2', 'Lost Indian', {
    key: 'A',
    tunings: { violin: { tuning: 'Cross A (AEAE)' } },
    is_crooked: false,
  }),
  userTune: userTuneRow('u2', 's2', { status: 'learning' }),
}

describe('summarize', () => {
  it('reports shared, mixed, and empty fields', () => {
    const summary = summarize([a, b])
    expect(summary.key).toEqual({ kind: 'shared', value: 'A' })
    expect(summary['tuning:violin']).toEqual({ kind: 'mixed' })
    expect(summary.genre).toEqual({ kind: 'empty' })
    expect(summary.status).toEqual({ kind: 'mixed' })
    expect(summary.is_crooked).toEqual({ kind: 'shared', value: false })
  })

  it('treats a mode this client does not know as no value', () => {
    const lydian1 = { ...a, tune: { ...a.tune, modes: ['lydian'] } }
    const lydian2 = { ...b, tune: { ...b.tune, modes: ['lydian'] } }
    expect(summarize([lydian1, lydian2]).mode).toEqual({ kind: 'empty' })

    const major = { ...b, tune: { ...b.tune, modes: ['major'] } }
    expect(summarize([lydian1, major]).mode).toEqual({ kind: 'mixed' })
  })

  it('summarizes part modes as one shared value when every tune agrees', () => {
    const kesh1 = { ...a, tune: { ...a.tune, modes: ['major', 'minor'] } }
    const kesh2 = { ...b, tune: { ...b.tune, modes: ['major', 'minor'] } }
    expect(summarize([kesh1, kesh2]).mode).toEqual({ kind: 'shared', value: 'major, minor' })
  })

  it('treats an unknown status as no value', () => {
    const unknown = { ...a, userTune: { ...a.userTune, status: 'retired' } }
    expect(summarize([unknown]).status).toEqual({ kind: 'empty' })
  })
})

describe('visibleEditFields', () => {
  const violin = new Set<Instrument>(['violin'])

  it('shows a tuning for a played instrument or one a selected tune holds', () => {
    const plain = { ...a, tune: { ...a.tune, tunings: {} } }
    const bouzouki = { ...b, tune: { ...b.tune, tunings: { bouzouki: { tuning: 'GDAD' } } } }
    const fields = visibleEditFields([plain, bouzouki], violin)
    expect(fields).toContain('tuning:violin')
    expect(fields).toContain('tuning:bouzouki')
    expect(fields).not.toContain('tuning:guitar')
  })

  it('does not show a tuning field for a capo alone', () => {
    const capo = { ...b, tune: { ...b.tune, tunings: { guitar: { capo: 2 } } } }
    expect(visibleEditFields([a, capo], violin)).not.toContain('tuning:guitar')
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
  it('splits touched fields between tune and user tune, trimming and clearing', () => {
    expect(
      toPatch({
        'tuning:violin': ' Cross A (AEAE) ',
        genre: '',
        mode: null,
        is_crooked: true,
        status: 'known',
        learned_from: 'Bruce Molsky',
      }),
    ).toEqual({
      tune: { genre: null, modes: [], is_crooked: true },
      userTune: { status: 'known', learned_from: 'Bruce Molsky' },
      tunings: { violin: 'Cross A (AEAE)' },
    })
  })

  it('clears a tuning left blank', () => {
    expect(toPatch({ 'tuning:guitar': '  ' })).toEqual({
      tune: {},
      userTune: {},
      tunings: { guitar: null },
    })
  })

  it('writes a picked mode as the whole list', () => {
    expect(toPatch({ mode: 'dorian' }).tune).toEqual({ modes: ['dorian'] })
    expect(toPatch({ mode: null }).tune).toEqual({ modes: [] })
  })

  it('edits the type', () => {
    expect(toPatch({ tune_type: 'Reel' }).tune).toEqual({ tune_type: 'Reel' })
  })

  it('never clears status', () => {
    expect(toPatch({ status: null })).toEqual({ tune: {}, userTune: {} })
  })
})
