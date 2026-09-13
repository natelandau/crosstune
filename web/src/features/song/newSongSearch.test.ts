import { describe, expect, it } from 'vitest'
import { SONG_LIMITS } from './limits'
import { parseNewSongSearch } from './newSongSearch'

describe('parseNewSongSearch', () => {
  it('keeps a trimmed title', () => {
    expect(parseNewSongSearch({ title: '  Soldier  ' })).toEqual({ title: 'Soldier' })
  })

  it('caps the title at the form limit', () => {
    const long = 'a'.repeat(SONG_LIMITS.title + 20)
    expect(parseNewSongSearch({ title: long })).toEqual({ title: 'a'.repeat(SONG_LIMITS.title) })
  })

  it('drops a blank or non-string title', () => {
    expect(parseNewSongSearch({ title: '   ' })).toEqual({})
    expect(parseNewSongSearch({ title: 42 })).toEqual({})
    expect(parseNewSongSearch({})).toEqual({})
  })
})
