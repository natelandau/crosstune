import { describe, expect, it } from 'vitest'
import type { LocalSong, LocalUserSong } from '../../db/types'
import {
  catalogEntries,
  DEFAULT_FILTERS,
  facetValues,
  filterCatalog,
  normalizeFilters,
} from './filters'

function song(id: string, title: string, extra: Partial<LocalSong> = {}): LocalSong {
  return {
    id,
    created_at: 't',
    updated_at: 't',
    deleted_at: null,
    server_seq: 0,
    title,
    alternate_titles: [],
    genre: null,
    feel: null,
    has_lyrics: null,
    key: null,
    mode: null,
    tuning: null,
    part_structure: null,
    time_signature: null,
    is_crooked: false,
    ...extra,
  }
}

function userSong(id: string, songId: string, extra: Partial<LocalUserSong> = {}): LocalUserSong {
  return {
    id,
    created_at: 't',
    updated_at: 't',
    deleted_at: null,
    server_seq: 0,
    song_id: songId,
    status: 'known',
    learned_from: null,
    learned_on: null,
    notes: null,
    archived_at: null,
    ...extra,
  }
}

const songs = [
  song('s1', "soldier's joy", { key: 'D', mode: 'major', tuning: 'ADAE', genre: 'Old-time' }),
  song('s2', 'Cluck Old Hen', { key: 'A', mode: 'mixolydian', alternate_titles: ['Cluck'] }),
  song('s3', 'Deleted', { deleted_at: 't' }),
  song('s4', 'Angeline the Baker', { key: 'D' }),
  song('s5', 'Orphan', { key: 'G' }),
]
const userSongs = [
  userSong('u1', 's1'),
  userSong('u2', 's2', { status: 'learning' }),
  userSong('u3', 's3'),
  userSong('u4', 's4', { status: 'want_to_learn', archived_at: 't' }),
]

describe('catalogEntries', () => {
  it('joins active pairs and sorts by title ignoring case', () => {
    const entries = catalogEntries(songs, userSongs)
    expect(entries.map((e) => e.song.id)).toEqual(['s4', 's2', 's1'])
  })
})

describe('filterCatalog', () => {
  const entries = catalogEntries(songs, userSongs)

  it('hides archived songs unless asked', () => {
    expect(filterCatalog(entries, DEFAULT_FILTERS).map((e) => e.song.id)).toEqual(['s2', 's1'])
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, archived: true }).map((e) => e.song.id),
    ).toEqual(['s4', 's2', 's1'])
  })

  it('matches the query against titles and alternate titles', () => {
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, query: 'SOLD' }).map((e) => e.song.id),
    ).toEqual(['s1'])
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, query: 'cluck' }).map((e) => e.song.id),
    ).toEqual(['s2'])
  })

  it('filters by status and facets', () => {
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, status: 'learning' }).map((e) => e.song.id),
    ).toEqual(['s2'])
    expect(filterCatalog(entries, { ...DEFAULT_FILTERS, key: 'D' }).map((e) => e.song.id)).toEqual([
      's1',
    ])
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, mode: 'mixolydian', tuning: 'all' }).map(
        (e) => e.song.id,
      ),
    ).toEqual(['s2'])
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, genre: 'Old-time' }).map((e) => e.song.id),
    ).toEqual(['s1'])
  })
})

describe('facetValues', () => {
  it('lists distinct sorted values across all entries, archived included', () => {
    const facets = facetValues(catalogEntries(songs, userSongs))
    expect(facets.keys).toEqual(['A', 'D'])
    expect(facets.modes).toEqual(['major', 'mixolydian'])
    expect(facets.tunings).toEqual(['ADAE'])
    expect(facets.genres).toEqual(['Old-time'])
  })

  it('folds spellings that differ only by case into one option', () => {
    const entries = catalogEntries(
      [
        song('s1', 'A', { key: 'D', genre: 'old-time' }),
        song('s2', 'B', { key: 'd', genre: 'Old-Time' }),
      ],
      [userSong('u1', 's1'), userSong('u2', 's2')],
    )
    const facets = facetValues(entries)
    expect(facets.keys).toEqual(['D'])
    expect(facets.genres).toEqual(['old-time'])
    expect(filterCatalog(entries, { ...DEFAULT_FILTERS, key: 'D' })).toHaveLength(2)
  })
})

describe('normalizeFilters', () => {
  it('fills defaults for missing or malformed stored values', () => {
    expect(normalizeFilters(null)).toEqual(DEFAULT_FILTERS)
    expect(normalizeFilters({ query: 'x', status: 'bogus', archived: 'yes' })).toEqual({
      ...DEFAULT_FILTERS,
      query: 'x',
    })
    expect(normalizeFilters({ key: 'A', archived: true }).key).toBe('A')
  })
})
