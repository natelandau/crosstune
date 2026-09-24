import { describe, expect, it } from 'vitest'
import { tuneRow, userTuneRow } from '../../test/rows'
import { emptyValues, inputsFromValues, valuesFromRows } from './tuneFormValues'

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
      mode: 'major',
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
    expect(values).toMatchObject({ mode: '', time_signature: '', status: 'want_to_learn' })
  })

  it('saves an unrecognized stored time signature and mode as not set', () => {
    const tune = tuneRow('t1', 'Odd', { modes: ['lydian'], time_signature: '7/8' })
    const { tune: out } = inputsFromValues(valuesFromRows(tune, userTuneRow('u1', 't1')))
    expect(out.time_signature).toBeNull()
    expect(out.modes).toEqual([])
  })

  it('reads the first part mode and the type into the form', () => {
    const tune = tuneRow('t1', "Cooley's", { modes: ['dorian', 'minor'], tune_type: 'Reel' })
    const values = valuesFromRows(tune, userTuneRow('u1', 't1'))
    expect(values).toMatchObject({ mode: 'dorian', tune_type: 'Reel' })
  })

  it('saves the mode as a one-part list and a blank mode as none', () => {
    const values = { ...emptyValues(), title: 'Sally Ann', mode: 'major' as const }
    expect(inputsFromValues(values).tune.modes).toEqual(['major'])
    expect(inputsFromValues({ ...values, mode: '' }).tune.modes).toEqual([])
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
