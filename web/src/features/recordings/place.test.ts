import { describe, expect, it } from 'vitest'
import { recordingRow } from '../../test/rows'
import { recentPlaces, recordingCredits, recordingPlace, recordingPlayers } from './place'

const placed = (
  id: string,
  name: string | null,
  addedAt: string,
  extra: Parameters<typeof recordingRow>[1] = {},
) =>
  recordingRow(id, {
    place_name: name,
    place_lat: 36.66,
    place_lon: -80.92,
    added_at: addedAt,
    ...extra,
  })

describe('recordingPlace', () => {
  it('is the named place, without accuracy', () => {
    const row = placed('r1', 'Galax, VA', '2026-01-01T00:00:00Z', { place_accuracy_m: 12 })
    expect(recordingPlace(row)).toEqual({ name: 'Galax, VA', lat: 36.66, lon: -80.92 })
  })

  it('is null without a name, even with coordinates', () => {
    expect(recordingPlace(placed('r1', null, '2026-01-01T00:00:00Z'))).toBeNull()
  })
})

describe('recentPlaces', () => {
  it('lists each place once, most recently added first', () => {
    const rows = [
      placed('a', 'Galax, VA', '2026-01-01T00:00:00Z'),
      placed('b', 'Mount Airy, NC', '2026-03-01T00:00:00Z', { place_lat: 36.5, place_lon: -80.6 }),
      placed('c', 'Galax, VA', '2026-02-01T00:00:00Z'),
    ]
    expect(recentPlaces(rows)).toEqual([
      { name: 'Mount Airy, NC', lat: 36.5, lon: -80.6 },
      { name: 'Galax, VA', lat: 36.66, lon: -80.92 },
    ])
  })

  it('keeps one name at two spots apart', () => {
    const rows = [
      placed('a', 'Springfield, IL', '2026-01-01T00:00:00Z', { place_lat: 39.8 }),
      placed('b', 'Springfield, MO', '2026-01-02T00:00:00Z', { place_lat: 37.2 }),
      placed('c', 'Springfield, IL', '2026-01-03T00:00:00Z', { place_lat: 37.2 }),
    ]
    expect(recentPlaces(rows).map((p) => [p.name, p.lat])).toEqual([
      ['Springfield, IL', 37.2],
      ['Springfield, MO', 37.2],
      ['Springfield, IL', 39.8],
    ])
  })

  it('skips unnamed and deleted recordings', () => {
    const rows = [
      placed('a', null, '2026-01-04T00:00:00Z'),
      placed('b', 'Floyd, VA', '2026-01-03T00:00:00Z', { deleted_at: '2026-01-05T00:00:00Z' }),
      placed('c', 'Hillsville, VA', '2026-01-02T00:00:00Z'),
      placed('d', 'Galax, VA', '2026-01-01T00:00:00Z'),
    ]
    expect(recentPlaces(rows).map((p) => p.name)).toEqual(['Hillsville, VA', 'Galax, VA'])
  })
})

describe('recordingPlayers', () => {
  it('folds case, trims, and sorts by name', () => {
    const rows = [
      recordingRow('a', { players: 'kevin' }),
      recordingRow('b', { players: ' Kevin ' }),
      recordingRow('c', { players: 'Kevin' }),
      recordingRow('d', { players: 'Alice and Tom' }),
      recordingRow('e', { players: '  ' }),
      recordingRow('f', { players: null }),
    ]
    expect(recordingPlayers(rows)).toEqual(['Alice and Tom', 'Kevin'])
  })

  it('skips deleted recordings', () => {
    const rows = [recordingRow('a', { players: 'Ruth', deleted_at: '2026-01-05T00:00:00Z' })]
    expect(recordingPlayers(rows)).toEqual([])
  })
})

describe('recordingCredits', () => {
  it('is the players then the named place', () => {
    const row = placed('r1', 'Galax, VA', '2026-01-01T00:00:00Z', { players: 'Kevin and Ed' })
    expect(recordingCredits(row)).toEqual(['Kevin and Ed', 'Galax, VA'])
  })

  it('ignores an unnamed place and empty players', () => {
    expect(recordingCredits(placed('r1', null, '2026-01-01T00:00:00Z'))).toEqual([])
    expect(
      recordingCredits(placed('r1', 'Galax, VA', '2026-01-01T00:00:00Z', { players: '' })),
    ).toEqual(['Galax, VA'])
  })
})
