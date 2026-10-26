import { describe, expect, it } from 'vitest'
import { placeRow, recordingRow } from '../../test/rows'
import { recentPlaces, recordingPlace, recordingPlayers, shownPlaceName } from './place'

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

describe('shownPlaceName', () => {
  const places = new Map([
    ['p1', placeRow('p1', 'The Barn')],
    ['p2', placeRow('p2', 'Old Hall', { deleted_at: '2026-02-01T00:00:00.000Z' })],
  ])

  it('uses the live saved place, even when the recording has no name of its own', () => {
    expect(shownPlaceName(recordingRow('r1', { place_id: 'p1', place_name: null }), places)).toBe(
      'The Barn',
    )
    expect(
      shownPlaceName(recordingRow('r1', { place_id: 'p1', place_name: 'Galax, VA' }), places),
    ).toBe('The Barn')
  })

  it("falls back to the recording's own name when the place is deleted or unknown", () => {
    expect(
      shownPlaceName(recordingRow('r1', { place_id: 'p2', place_name: 'Galax, VA' }), places),
    ).toBe('Galax, VA')
    expect(
      shownPlaceName(recordingRow('r1', { place_id: 'p9', place_name: 'Galax, VA' }), places),
    ).toBe('Galax, VA')
    expect(shownPlaceName(recordingRow('r1', { place_id: 'p2' }), places)).toBeNull()
  })

  it("is the recording's own name when it is not linked", () => {
    expect(shownPlaceName(recordingRow('r1', { place_name: 'Galax, VA' }), places)).toBe(
      'Galax, VA',
    )
  })
})
