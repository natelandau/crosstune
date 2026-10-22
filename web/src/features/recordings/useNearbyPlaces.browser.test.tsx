import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import type { MapKit } from '../../platform/mapkit'
import { MapKitContext } from '../../platform/useMapKit'
import { fakeMapKit, fakePlace, type FakeMapKitOptions } from '../../test/fakeMapKit'
import { useNearbyPlaces } from './useNearbyPlaces'

const CENTER = { lat: 36.66, lon: -80.92 }
const M_PER_DEGREE = 111_320

/** A venue `meters` due north of the center. */
const north = (name: string, meters: number) =>
  fakePlace(name, CENTER.lat + meters / M_PER_DEGREE, CENTER.lon)

function setup(coordinate: typeof CENTER | null, options: FakeMapKitOptions = {}) {
  const { mapkit, seen } = fakeMapKit(options)
  const load = vi.fn(async (): Promise<MapKit | null> => mapkit)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MapKitContext.Provider value={load}>{children}</MapKitContext.Provider>
  )
  const hook = renderHook(({ at }) => useNearbyPlaces(at), {
    wrapper,
    initialProps: { at: coordinate },
  })
  return { ...hook, seen, load }
}

it('sorts by distance, nearest first', async () => {
  const { result } = setup(CENTER, {
    places: [north('Far', 120), north('Near', 10), north('Middle', 60)],
  })
  await expect.poll(() => result.current?.map((p) => p.name)).toEqual(['Near', 'Middle', 'Far'])
})

it('caps the list at 10, keeping the nearest, and drops anything past 150 m', async () => {
  const places = [
    ...Array.from({ length: 12 }, (_, i) => north(`P${i + 1}`, (12 - i) * 10)),
    north('Out of reach', 200),
  ]
  const { result } = setup(CENTER, { places })
  await expect.poll(() => result.current?.length).toBe(10)
  expect(result.current?.map((p) => p.name)).toEqual([
    'P12',
    'P11',
    'P10',
    'P9',
    'P8',
    'P7',
    'P6',
    'P5',
    'P4',
    'P3',
  ])
})

it('measures across the antimeridian', async () => {
  const { result } = setup(
    { lat: 10, lon: 179.9999 },
    { places: [fakePlace('Across', 10, -179.9999), fakePlace('Same side', 10, 179.9995)] },
  )
  await expect.poll(() => result.current?.map((p) => p.name)).toEqual(['Across', 'Same side'])
})

it('asks for venues within 150 m of the point', async () => {
  const { result, seen } = setup(CENTER, { places: [north('Hall', 10)] })
  await expect.poll(() => result.current).not.toBeNull()
  expect(seen.searches).toHaveLength(1)
  expect(seen.searches[0]).toMatchObject({
    center: { latitude: CENTER.lat, longitude: CENTER.lon },
    radius: 150,
  })
  expect(JSON.stringify(seen.searches[0]!.filter)).toContain('MusicVenue')
})

it('carries a place as the page lists it', async () => {
  const { result } = setup(CENTER, { places: [north('Hall', 10)] })
  await expect
    .poll(() => result.current)
    .toEqual([
      {
        name: 'Hall',
        address: '1 Main St',
        lat: CENTER.lat + 10 / M_PER_DEGREE,
        lon: CENTER.lon,
        applePlaceId: 'id-Hall',
      },
    ])
})

it('is null while loading, and with no point searches nothing', async () => {
  const { result, seen, load } = setup(null)
  expect(result.current).toBeNull()
  await act(async () => {})
  expect(result.current).toBeNull()
  expect(seen.searches).toEqual([])
  expect(load).not.toHaveBeenCalled()
})

it('is null when the search fails', async () => {
  const { result, seen } = setup(CENTER, { searchFails: true })
  await expect.poll(() => seen.searches.length).toBe(1)
  await act(async () => {})
  expect(result.current).toBeNull()
})

it('is null when MapKit cannot load', async () => {
  const load = vi.fn(async () => null)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MapKitContext.Provider value={load}>{children}</MapKitContext.Provider>
  )
  const { result } = renderHook(() => useNearbyPlaces(CENTER), { wrapper })
  await expect.poll(() => load.mock.calls.length).toBe(1)
  await act(async () => {})
  expect(result.current).toBeNull()
})

it('forgets the old point while the new one is searched', async () => {
  let release: () => void = () => {}
  let holds = 0
  const gate = new Promise<void>((resolve) => (release = resolve))
  const { result, rerender, seen } = setup(CENTER, {
    places: [north('Hall', 10)],
    // Only the second search waits, so the first answers at once.
    holdSearch: () => (++holds === 2 ? gate : Promise.resolve()),
  })
  await expect.poll(() => result.current?.length).toBe(1)

  rerender({ at: { lat: 10, lon: 10 } })
  await expect.poll(() => seen.searches.length).toBe(2)
  expect(result.current).toBeNull()

  release()
  await expect.poll(() => result.current).toEqual([])
})

it('gives each venue a street and town address line, as the Apple app and server do', async () => {
  const base = north('Rex Theater', 10)
  const us = {
    ...base,
    fullThoroughfare: '113 E Grayson St',
    locality: 'Galax',
    administrativeAreaCode: 'VA',
    countryCode: 'US',
    country: 'United States',
  }
  const abroad = {
    ...north('The Cobblestone', 20),
    fullThoroughfare: '77 King St N',
    locality: 'Dublin',
    administrativeAreaCode: 'D',
    countryCode: 'IE',
    country: 'Ireland',
  }
  // A borough the mailing address names is the town, as Apple Maps puts it in the sub-locality.
  const borough = {
    ...north('Jalopy Theatre', 30),
    fullThoroughfare: '315 Columbia St',
    locality: 'New York',
    subLocality: 'Brooklyn',
    formattedAddress: '315 Columbia St, Brooklyn, NY 11231, United States',
    administrativeAreaCode: 'NY',
    countryCode: 'US',
  }
  const noStreet = {
    ...north('Town green', 40),
    fullThoroughfare: null,
    locality: 'Galax',
    administrativeAreaCode: 'VA',
    countryCode: 'US',
  }
  const { result } = setup(CENTER, { places: [us, abroad, borough, noStreet] })
  await expect
    .poll(() => result.current?.map((p) => p.address))
    .toEqual([
      '113 E Grayson St, Galax, VA',
      '77 King St N, Dublin, Ireland',
      '315 Columbia St, Brooklyn, NY',
      'Galax, VA',
    ])
})
