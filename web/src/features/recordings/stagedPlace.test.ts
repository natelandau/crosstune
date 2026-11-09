import { expect, it } from 'vitest'
import { placeRow, recordingRow } from '../../test/rows'
import { LocationState, nearbyRows } from './stagedPlace'
import type { NearbyPlace } from './useNearbyPlaces'

const CENTER = { lat: 40, lon: -74 }
const M_PER_DEGREE = 111_320
const north = (meters: number) => ({ lat: CENTER.lat + meters / M_PER_DEGREE, lon: CENTER.lon })

it('lists at most seven nearby places, saved locations and venues by distance', () => {
  const saved = [placeRow('p1', 'The barn', north(15)), placeRow('p2', 'Grange hall', north(45))]
  const venues: NearbyPlace[] = Array.from({ length: 8 }, (_, i) => ({
    name: `Venue ${i + 1}`,
    address: null,
    applePlaceId: `v${i + 1}`,
    ...north(10 * (i + 1)),
  }))
  const rows = nearbyRows(CENTER, saved, venues)
  expect(rows).toHaveLength(7)
  expect(rows.map((row) => (row.kind === 'saved' ? row.place.name : row.venue.name))).toEqual([
    'Venue 1',
    'The barn',
    'Venue 2',
    'Venue 3',
    'Venue 4',
    'Grange hall',
    'Venue 5',
  ])
})

it("gives a recording's stored point as its own, else its saved location's", () => {
  const places = [placeRow('p1', 'The barn', { lat: 36.65, lon: -80.93 })]
  const own = recordingRow('r1', { place_lat: 40.67, place_lon: -73.96, place_id: 'p1' })
  const linkedOnly = recordingRow('r2', { place_lat: null, place_lon: null, place_id: 'p1' })
  const neither = recordingRow('r3', { place_lat: null, place_lon: null, place_id: null })
  expect(new LocationState(null, own, places).storedPoint).toMatchObject({
    lat: 40.67,
    lon: -73.96,
  })
  expect(new LocationState(null, linkedOnly, places).storedPoint).toEqual({
    lat: 36.65,
    lon: -80.93,
    accuracyM: null,
  })
  expect(new LocationState(null, neither, places).storedPoint).toBeNull()
})

it('offers to name a place that is not a saved location, and to rename one that is', () => {
  const places = [placeRow('p1', 'The barn', { lat: 36.65, lon: -80.93 })]
  const precise = { place_lat: 40.67, place_lon: -73.96, place_accuracy_m: 12 }
  const offers = (recording: ReturnType<typeof recordingRow>) => {
    const state = new LocationState(null, recording, places)
    return { canName: state.canName, canRename: state.canRename }
  }
  expect(offers(recordingRow('r1', precise))).toEqual({ canName: true, canRename: false })
  expect(offers(recordingRow('r2', { place_id: 'p1' }))).toEqual({
    canName: false,
    canRename: true,
  })
  expect(offers(recordingRow('r3', { ...precise, place_id: 'p1' }))).toEqual({
    canName: false,
    canRename: true,
  })
})

it('names nothing from a blank name, and trims the name given', () => {
  const state = new LocationState(
    null,
    recordingRow('r1', { place_lat: 40.67, place_lon: -73.96, place_accuracy_m: 12 }),
    [],
  )
  expect(state.namedDraft('  ')).toBeNull()
  expect(state.namedDraft(' Tom’s kitchen ')?.name).toBe('Tom’s kitchen')
})
