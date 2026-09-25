import { describe, expect, it } from 'vitest'
import type { Mode } from '../../api/vocabulary'
import { tuneRow, userTuneRow } from '../../test/rows'
import { emptyValues, inputsFromValues, typeChanged, valuesFromRows } from './tuneFormValues'

describe('tuneFormValues', () => {
  it('starts a new tune as want to learn in 4/4', () => {
    expect(emptyValues()).toMatchObject({
      status: 'want_to_learn',
      time_signature: '4/4',
      title: '',
    })
  })

  it('round-trips a tune and trims, splits, and nulls blanks on the way out', () => {
    const tune = tuneRow('s1', "Soldier's Joy", {
      key: 'D',
      alternate_titles: ['Joy'],
      modes: ['major'],
    })
    const userTune = userTuneRow('u1', 's1', { status: 'known', notes: '  ' })
    const values = valuesFromRows(tune, userTune)
    expect(values).toMatchObject({
      title: "Soldier's Joy",
      key: 'D',
      alternate_titles: 'Joy',
      modes: ['major'],
      status: 'known',
    })
    const { tune: out, userTune: outUser } = inputsFromValues({
      ...values,
      alternate_titles: ' Joy , Soldier ,',
      genre: '  ',
    })
    expect(out.alternate_titles).toEqual(['Joy', 'Soldier'])
    expect(out.genre).toBeNull()
    expect(outUser.notes).toBeNull()
  })

  it('falls back when a stored mode or time signature is unknown', () => {
    const tune = tuneRow('s1', 'Odd', { modes: ['lydian'], time_signature: '7/8' })
    const values = valuesFromRows(tune, userTuneRow('u1', 's1', { status: 'bogus' }))
    expect(values).toMatchObject({ modes: [], time_signature: '', status: 'want_to_learn' })
  })

  it('saves an unrecognized stored time signature and mode as not set', () => {
    const tune = tuneRow('t1', 'Odd', { modes: ['lydian'], time_signature: '7/8' })
    const { tune: out } = inputsFromValues(valuesFromRows(tune, userTuneRow('u1', 't1')))
    expect(out.time_signature).toBeNull()
    expect(out.modes).toEqual([])
  })

  it('saves part modes in order with no gaps', () => {
    const modes: (Mode | '')[] = ['', 'dorian', '']
    const values = { ...emptyValues(), title: 'The Kesh', modes }
    expect(inputsFromValues(values).tune.modes).toEqual(['dorian'])
  })

  it('reads a stored tune into one mode row per part', () => {
    const values = valuesFromRows(
      tuneRow('t1', "Cooley's", { modes: ['major', 'minor'] }),
      userTuneRow('u1', 't1'),
    )
    expect(values.modes).toEqual(['major', 'minor'])
  })

  it('keeps every part mode through a save that never touches them', () => {
    const tune = tuneRow('t1', "Cooley's", { modes: ['major', 'dorian'] })
    const { tune: out } = inputsFromValues(valuesFromRows(tune, userTuneRow('u1', 't1')))
    expect(out.modes).toEqual(['major', 'dorian'])
  })

  it('drops a stored mode this client does not know', () => {
    const values = valuesFromRows(
      tuneRow('t1', "Cooley's", { modes: ['major', 'lydian'] }),
      userTuneRow('u1', 't1'),
    )
    expect(values.modes).toEqual(['major'])
  })

  it('carries the composer through and nulls a blank one', () => {
    const values = valuesFromRows(
      tuneRow('t1', 'Lucy Farr', { composer: 'Ed Reavy' }),
      userTuneRow('u1', 't1'),
    )
    expect(values.composer).toBe('Ed Reavy')
    expect(inputsFromValues({ ...values, composer: '  ' }).tune.composer).toBeNull()
  })

  describe('typeChanged', () => {
    it("sets a new tune's untouched default time signature", () => {
      const next = typeChanged({ ...emptyValues(), time_signature: '4/4' }, 'Jig', true, false)
      expect(next).toMatchObject({ tune_type: 'Jig', time_signature: '6/8' })
    })

    it('keeps a time signature the player chose on a new tune', () => {
      const next = typeChanged({ ...emptyValues(), time_signature: '4/4' }, 'Jig', true, true)
      expect(next.time_signature).toBe('4/4')
    })

    it("keeps an edited tune's stored time signature", () => {
      const next = typeChanged({ ...emptyValues(), time_signature: '4/4' }, 'Jig', false, false)
      expect(next.time_signature).toBe('4/4')
    })

    it("fills an edited tune's empty time signature", () => {
      const next = typeChanged({ ...emptyValues(), time_signature: '' }, 'Slide', false, false)
      expect(next.time_signature).toBe('12/8')
    })

    it('leaves the time signature for a type without one', () => {
      const next = typeChanged({ ...emptyValues(), time_signature: '' }, 'Air', false, false)
      expect(next.time_signature).toBe('')
    })
  })

  it('carries lyrics through and nulls a whitespace-only body', () => {
    const tune = tuneRow('s1', 'Uncle Joe', { lyrics: 'Did you ever go to meeting' })
    const values = valuesFromRows(tune, userTuneRow('u1', 's1'))
    expect(values.lyrics).toBe('Did you ever go to meeting')
    expect(inputsFromValues(values).tune.lyrics).toBe('Did you ever go to meeting')
    expect(inputsFromValues({ ...values, lyrics: '  \n\n  ' }).tune.lyrics).toBeNull()
  })

  it('reads each tuning and capo into the form and writes back a compact map', () => {
    const tunings = {
      hardanger: { tuning: 'x' },
      guitar: { tuning: 'DADGAD', capo: 2 },
      bouzouki: { capo: 3 },
    }
    const tune = tuneRow('s1', 'Sally Ann', { tunings })
    const values = valuesFromRows(tune, userTuneRow('u1', 's1'))
    expect(values.tunings.guitar).toEqual({ tuning: 'DADGAD', capo: '2' })
    expect(values.tunings.bouzouki).toEqual({ tuning: '', capo: '3' })
    expect(values.tunings.violin).toEqual({ tuning: '', capo: '' })
    values.tunings.violin = { tuning: ' Cross A (AEAE) ', capo: '' }
    values.tunings.guitar = { tuning: '', capo: '' }
    expect(inputsFromValues(values, tunings).tune.tunings).toEqual({
      hardanger: { tuning: 'x' },
      bouzouki: { capo: 3 },
      violin: { tuning: 'Cross A (AEAE)' },
    })
  })

  it('writes only the instruments the form touched for a new tune', () => {
    const values = emptyValues()
    values.tunings.guitar = { tuning: '', capo: '2' }
    expect(inputsFromValues(values).tune.tunings).toEqual({ guitar: { capo: 2 } })
  })
})
