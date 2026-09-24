import { describe, expect, it } from 'vitest'
import { songRow, userSongRow } from '../../test/rows'
import { emptyValues, inputsFromValues, valuesFromRows } from './songFormValues'

describe('songFormValues', () => {
  it('starts a new song as want to learn in 4/4', () => {
    expect(emptyValues()).toMatchObject({
      status: 'want_to_learn',
      time_signature: '4/4',
      title: '',
    })
  })

  it('round-trips a song and trims, splits, and nulls blanks on the way out', () => {
    const song = songRow('s1', "Soldier's Joy", {
      key: 'D',
      alternate_titles: ['Joy'],
      mode: 'major',
    })
    const userSong = userSongRow('u1', 's1', { status: 'known', notes: '  ' })
    const values = valuesFromRows(song, userSong)
    expect(values).toMatchObject({
      title: "Soldier's Joy",
      key: 'D',
      alternate_titles: 'Joy',
      mode: 'major',
      status: 'known',
    })
    const { song: out, userSong: outUser } = inputsFromValues({
      ...values,
      alternate_titles: ' Joy , Soldier ,',
      genre: '  ',
    })
    expect(out.alternate_titles).toEqual(['Joy', 'Soldier'])
    expect(out.genre).toBeNull()
    expect(outUser.notes).toBeNull()
  })

  it('falls back when a stored mode or time signature is unknown', () => {
    const song = songRow('s1', 'Odd', { mode: 'lydian', time_signature: '7/8' })
    const values = valuesFromRows(song, userSongRow('u1', 's1', { status: 'bogus' }))
    expect(values).toMatchObject({ mode: '', time_signature: '', status: 'want_to_learn' })
  })

  it('keeps an unrecognized time signature on save when the field is left alone', () => {
    const song = songRow('s1', 'Odd', { time_signature: '7/8' })
    const values = valuesFromRows(song, userSongRow('u1', 's1'))
    const { song: out } = inputsFromValues(values)
    expect(out.time_signature).toBe('7/8')
  })

  it('clears an unrecognized time signature once the player picks a value', () => {
    const song = songRow('s1', 'Odd', { time_signature: '7/8' })
    const values = valuesFromRows(song, userSongRow('u1', 's1'))
    const { song: out } = inputsFromValues({
      ...values,
      time_signature: '3/4',
      time_signature_raw: null,
    })
    expect(out.time_signature).toBe('3/4')
  })

  it('has no raw time signature to fall back to for a new song', () => {
    const { song: out } = inputsFromValues(emptyValues())
    expect(out.time_signature).toBe('4/4')
  })

  it('carries lyrics through and nulls a whitespace-only body', () => {
    const song = songRow('s1', 'Uncle Joe', { lyrics: 'Did you ever go to meeting' })
    const values = valuesFromRows(song, userSongRow('u1', 's1'))
    expect(values.lyrics).toBe('Did you ever go to meeting')
    expect(inputsFromValues(values).song.lyrics).toBe('Did you ever go to meeting')
    expect(inputsFromValues({ ...values, lyrics: '  \n\n  ' }).song.lyrics).toBeNull()
  })
})
