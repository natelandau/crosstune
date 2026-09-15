import { describe, expect, it } from 'vitest'
import { serverSong } from '../test/fakeApi'
import { liveSong } from './songs'

describe('liveSong', () => {
  it('returns the song when it is present and not deleted', () => {
    const song = serverSong({ id: 's1' })
    expect(liveSong(song)).toBe(song)
  })

  it('returns null for a tombstoned song', () => {
    const song = serverSong({ id: 's1', deleted_at: '2026-09-14T00:00:00Z' })
    expect(liveSong(song)).toBeNull()
  })

  it('returns null when there is no song', () => {
    expect(liveSong(null)).toBeNull()
    expect(liveSong(undefined)).toBeNull()
  })
})
