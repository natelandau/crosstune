import { expect, it } from 'vitest'
import { recordingRow } from '../../../test/rows'
import { latestPlaced, searchHint } from './searchHint'

const HERE = { place_lat: 40.67, place_lon: -73.96 }
const DEVICE = { lat: 36.66, lon: -80.92 }
const EARLIER = recordingRow('r2', { place_lat: 35.6, place_lon: -82.55, added_at: '2026-01-01' })

it('ranks near the stored point first', () => {
  const stored = { lat: 40.67, lon: -73.96 }
  expect(searchHint({ stored, device: DEVICE, latestPlaced: EARLIER })).toEqual(stored)
})

it('ranks near the device for a recording with no place', () => {
  expect(searchHint({ stored: null, device: DEVICE, latestPlaced: EARLIER })).toEqual(DEVICE)
})

it('ranks near the latest recording with a place, with no device location', () => {
  expect(searchHint({ stored: null, device: null, latestPlaced: EARLIER })).toEqual({
    lat: 35.6,
    lon: -82.55,
  })
})

it('leaves the ranking to the account country with none of them', () => {
  expect(searchHint({ stored: null, device: null, latestPlaced: null })).toBeNull()
})

it('finds the latest live recording with a place', () => {
  const newer = recordingRow('r3', { ...HERE, added_at: '2026-03-01' })
  const deleted = recordingRow('r4', {
    ...HERE,
    added_at: '2026-04-01',
    deleted_at: '2026-04-02',
  })
  const unplaced = recordingRow('r5', { added_at: '2026-05-01' })
  expect(latestPlaced([EARLIER, newer, deleted, unplaced])?.id).toBe('r3')
  expect(latestPlaced([unplaced])).toBeNull()
})
